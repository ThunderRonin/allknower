import { queryLore } from "../rag/lancedb.ts";
import { buildBrainDumpPrompt, callLLM } from "./prompt.ts";
import { parseBrainDumpResponse } from "./parser.ts";
import {
    createNote,
    setNoteContent,
    updateNote,
    setNoteTemplate,
    tagNote,
    createAttribute,
} from "../etapi/client.ts";
import prisma from "../db/client.ts";
import { env } from "../env.ts";
import { TEMPLATE_ID_MAP } from "../types/lore.ts";
import type { BrainDumpResult } from "../types/lore.ts";
import { suggestRelationsForNote, applyRelations } from "./relations.ts";
import { rootLogger } from "../logger.ts";

// The root note ID in AllCodex where new lore entries are placed.
// This should be the "Lore" root note in the Chronicle.
// Can be overridden via AppConfig in the DB.
const DEFAULT_LORE_ROOT_NOTE_ID = "root";

/**
 * Main brain dump pipeline.
 *
 * 1. Query LanceDB for semantically similar existing lore (RAG context)
 * 2. Build prompt with RAG context injected
 * 3. Call LLM via OpenRouter
 * 4. Parse structured JSON response
 * 5. Create/update notes in AllCodex via ETAPI
 * 6. Auto-relate: suggest + apply high-confidence relationships (if enabled)
 * 7. Persist to BrainDumpHistory
 * 8. Return summary + reindexIds to caller (route schedules background reindex)
 */
export async function runBrainDump(
    rawText: string,
    options: { autoRelate?: boolean } = {}
): Promise<BrainDumpResult & { reindexIds: string[]; relations?: Array<{ noteId: string; applied: number; failed: number }> }> {
    const { autoRelate = true } = options;

    // Idempotency: hash the raw text and check for a recent identical brain dump
    const rawTextHash = Buffer.from(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawText))
    ).toString("hex");

    const existing = await prisma.brainDumpHistory.findFirst({
        where: { rawTextHash },
        orderBy: { createdAt: "desc" },
        select: { id: true, notesCreated: true, notesUpdated: true, parsedJson: true, model: true },
    });
    if (existing) {
        rootLogger.info("Brain dump cache hit — returning existing result", {
            historyId: existing.id,
            rawTextHash,
        });
        const cached = existing.parsedJson as { entities: unknown[]; summary: string };
        return {
            summary: `[cached] ${cached.summary}`,
            created: [],
            updated: [],
            skipped: [],
            reindexIds: [],
        };
    }

    // Step 1: RAG context retrieval
    const ragContext = await queryLore(rawText, 10);

    // Step 2 & 3: Build prompt and call LLM
    const { system, context, user } = buildBrainDumpPrompt(rawText, ragContext);
    const { raw, tokensUsed, model } = await callLLM(system, user, "brain-dump", context);

    // Step 4: Parse response
    const { entities, summary } = parseBrainDumpResponse(raw);

    const created: BrainDumpResult["created"] = [];
    const updated: BrainDumpResult["updated"] = [];
    const skipped: BrainDumpResult["skipped"] = [];

    // Get lore root note ID from config (fallback to root)
    const loreRootConfig = await prisma.appConfig.findUnique({ where: { key: "loreRootNoteId" } });
    const loreRootNoteId = loreRootConfig?.value ?? DEFAULT_LORE_ROOT_NOTE_ID;

    // Step 5: Create/update notes in AllCodex
    const reindexIds: string[] = [];

    for (const entity of entities) {
        try {
            if (entity.action === "update" && entity.existingNoteId) {
                // Update existing note
                await updateNote(entity.existingNoteId, { title: entity.title });
                if (entity.content) {
                    await setNoteContent(entity.existingNoteId, entity.content);
                }
                updated.push({ noteId: entity.existingNoteId, title: entity.title, type: entity.type });
                reindexIds.push(entity.existingNoteId);
            } else {
                // Create new note
                const { note } = await createNote({
                    parentNoteId: loreRootNoteId,
                    title: entity.title,
                    type: "text",
                    content: entity.content ?? "",
                });

                // Link to lore template (best-effort — template may not exist yet)
                const templateId = TEMPLATE_ID_MAP[entity.type];
                try {
                    await setNoteTemplate(note.noteId, templateId);
                } catch {
                    rootLogger.warn("Template not found — skipping template link", {
                        templateId,
                        entityTitle: entity.title,
                    });
                }

                // Tag as lore entry
                await tagNote(note.noteId, "lore");
                await tagNote(note.noteId, "loreType", entity.type);

                // Set promoted attributes
                if (entity.attributes && typeof entity.attributes === "object") {
                    for (const [name, value] of Object.entries(entity.attributes)) {
                        if (value !== undefined && value !== null && value !== "") {
                            const strValue = Array.isArray(value) ? value.join(", ") : String(value);
                            await createAttribute({ noteId: note.noteId, type: "label", name, value: strValue });
                        }
                    }
                }

                // Apply tags
                for (const tag of entity.tags ?? []) {
                    await tagNote(note.noteId, tag);
                }

                created.push({ noteId: note.noteId, title: entity.title, type: entity.type });
                reindexIds.push(note.noteId);
            }
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            const errorCategory =
                msg.includes("401") || msg.includes("403") || msg.includes("auth")
                    ? "auth"
                    : msg.includes("network") || msg.includes("ECONNREFUSED") || msg.includes("fetch")
                    ? "network"
                    : msg.includes("validation") || msg.includes("invalid") || msg.includes("400")
                    ? "validation"
                    : "unknown";

            rootLogger.error("Failed to process entity", {
                entityTitle: entity.title,
                error: msg,
                errorCategory,
            });
            skipped.push({ title: entity.title, reason: msg, errorCategory });
        }
    }

    // Step 6: Auto-relate — suggest + apply high-confidence relationships
    const relationResults: Array<{ noteId: string; applied: number; failed: number }> = [];

    if (autoRelate && created.length > 0) {
        for (const note of created) {
            try {
                // Get the content we just wrote for this note
                const entity = entities.find(e => e.title === note.title);
                const content = entity?.content ?? note.title;

                const suggestions = await suggestRelationsForNote(note.noteId, content);

                // Only auto-apply high-confidence suggestions
                const highConfidence = suggestions.filter(s => s.confidence === "high");

                if (highConfidence.length > 0) {
                    const { applied, failed } = await applyRelations(note.noteId, highConfidence);
                    relationResults.push({
                        noteId: note.noteId,
                        applied: applied.length,
                        failed: failed.length,
                    });
                }
            } catch (error) {
                // Relation failures NEVER break the brain dump
                rootLogger.warn("Auto-relate failed", {
                    entityTitle: note.title,
                    error: error instanceof Error ? error.message : String(error),
                });
                relationResults.push({ noteId: note.noteId, applied: 0, failed: 0 });
            }
        }
    }

    // Step 7: Persist to history
    await prisma.brainDumpHistory.create({
        data: {
            rawText,
            rawTextHash,
            parsedJson: JSON.parse(JSON.stringify({ entities, summary })),
            notesCreated: created.map((n: { noteId: string }) => n.noteId),
            notesUpdated: updated.map((n: { noteId: string }) => n.noteId),
            model,
            tokensUsed,
        },
    });

    return {
        summary,
        created,
        updated,
        skipped,
        reindexIds,
        ...(relationResults.length > 0 ? { relations: relationResults } : {}),
    };
}


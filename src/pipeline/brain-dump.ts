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
    getAllCodexNotes,
    probeAllCodex,
} from "../etapi/client.ts";
import prisma from "../db/client.ts";
import { TEMPLATE_ID_MAP } from "../types/lore.ts";
import type { BrainDumpResult, LoreEntityType } from "../types/lore.ts";
import { suggestRelationsForNote, applyRelations } from "./relations.ts";
import { rootLogger } from "../logger.ts";

const DEFAULT_LORE_ROOT_NOTE_ID = "root";
const DUPLICATE_SIMILARITY_THRESHOLD = 0.88;

type DuplicateMatch = { noteId: string; title: string; score: number };
type DuplicateInfo = { proposedTitle: string; proposedType: string; matches: DuplicateMatch[] };

async function findDuplicates(title: string, type: string): Promise<DuplicateMatch[]> {
    try {
        const results = await queryLore(title, 5);
        return results
            .filter((r) => (r as unknown as { score: number }).score > DUPLICATE_SIMILARITY_THRESHOLD)
            .map((r: unknown) => {
                const entry = r as { noteId: string; title: string; score: number };
                return { noteId: entry.noteId, title: entry.title, score: entry.score };
            });
    } catch {
        return [];
    }
}

export interface ProposedEntity {
    title: string;
    type: string;
    action: "create" | "update";
    content?: string;
    existingNoteId?: string;
    attributes?: Record<string, string>;
    tags?: string[];
}

export interface BrainDumpReviewResult {
    mode: "review";
    summary: string;
    proposedEntities: ProposedEntity[];
    duplicates?: DuplicateInfo[];
}

export interface BrainDumpInboxResult {
    mode: "inbox";
    queued: true;
}

/**
 * Main brain dump pipeline.
 *
 * @param rawText     Raw worldbuilding text to process
 * @param mode        "auto" (default) → write immediately, "review" → propose without writing, "inbox" → skip processing
 * @param options     Additional pipeline options
 */
export async function runBrainDump(
    rawText: string,
    mode: "auto" | "review" | "inbox" = "auto",
    options: { autoRelate?: boolean } = {}
): Promise<
    | (BrainDumpResult & { reindexIds: string[]; relations?: Array<{ noteId: string; applied: number; failed: number }> })
    | BrainDumpReviewResult
    | BrainDumpInboxResult
> {
    const { autoRelate = true } = options;

    // Inbox mode — client-side capture, no LLM call needed
    if (mode === "inbox") {
        return { mode: "inbox", queued: true };
    }

    // Preflight: verify AllCodex is reachable and the ETAPI token is valid before
    // spending LLM tokens on a run that will fail to write anything.
    const allcodexProbe = await probeAllCodex();
    if (!allcodexProbe.ok) {
        throw new Error(`AllCodex is not connected: ${allcodexProbe.error}`);
    }

    // Idempotency: hash the raw text and check for a recent identical brain dump
    const rawTextHash = Buffer.from(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawText))
    ).toString("hex");

    // Only use cache for auto mode (review always re-runs for fresh proposals)
    if (mode === "auto") {
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
    }

    // Step 1: RAG context retrieval — general + statblock-grounded
    let ragContext: Awaited<ReturnType<typeof queryLore>> = [];
    try {
        ragContext = await queryLore(rawText, 10);
    } catch (e: unknown) {
        rootLogger.warn("General RAG retrieval failed, continuing without context", {
            error: e instanceof Error ? e.message : String(e),
        });
    }

    // Statblock-grounded retrieval: fetch statblock noteIds from AllCodex and scope a secondary query to them.
    // This grounds creature/NPC generation against existing homebrew statblocks automatically.
    let statblockContext: typeof ragContext = [];
    try {
        const statblockNotes = await getAllCodexNotes("#statblock");
        const statblockNoteIds = statblockNotes.map((n: { noteId: string }) => n.noteId);
        if (statblockNoteIds.length > 0) {
            statblockContext = await queryLore(rawText, 5, { includeNoteIds: statblockNoteIds });
        }
    } catch (e: unknown) {
        rootLogger.warn("Statblock-grounded RAG failed, continuing without it", {
            error: e instanceof Error ? e.message : String(e),
        });
    }

    // Merge: prioritize statblock hits at top of context if relevant
    const mergedContext = [...statblockContext, ...ragContext.filter(
        (r) => !statblockContext.some((s) => s.noteId === r.noteId)
    )].slice(0, 12);

    // Step 2 & 3: Build prompt and call LLM
    const { system, context, user } = await buildBrainDumpPrompt(rawText, mergedContext);
    const { raw, tokensUsed, model } = await callLLM(system, user, "brain-dump", context);


    // Step 4: Parse response
    const { entities, summary } = parseBrainDumpResponse(raw);

    // Review mode — return proposals without writing
    if (mode === "review") {
        const proposed: ProposedEntity[] = entities.map((e) => ({
            title: e.title,
            type: e.type,
            action: (e.action === "update" && e.existingNoteId ? "update" : "create") as "create" | "update",
            content: e.content,
            existingNoteId: e.existingNoteId,
            attributes: typeof e.attributes === "object" && e.attributes ? e.attributes as Record<string, string> : undefined,
            tags: e.tags,
        }));

        // Run duplicate detection for new entities in review mode
        const duplicates: DuplicateInfo[] = [];
        for (const p of proposed.filter((e) => e.action === "create")) {
            const matches = await findDuplicates(p.title, p.type);
            if (matches.length > 0) {
                duplicates.push({ proposedTitle: p.title, proposedType: p.type, matches });
            }
        }

        return {
            mode: "review",
            summary,
            proposedEntities: proposed,
            ...(duplicates.length > 0 ? { duplicates } : {}),
        };
    }

    // Auto mode — write to AllCodex
    return await _writeEntitiesToAllCodex(rawText, rawTextHash, entities, summary, tokensUsed, model, autoRelate);
}

/**
 * Commit pre-approved entities from a review-mode brain dump.
 * Skips LLM — writes directly to AllCodex.
 */
export async function commitReviewedEntities(
    rawText: string,
    approvedEntities: ProposedEntity[]
): Promise<BrainDumpResult & { reindexIds: string[] }> {
    const allcodexProbe = await probeAllCodex();
    if (!allcodexProbe.ok) {
        throw new Error(`AllCodex is not connected: ${allcodexProbe.error}`);
    }

    const rawTextHash = Buffer.from(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode("commit:" + rawText))
    ).toString("hex");

    // NOTE: entities from review don't have all pipeline-internal fields; adapt shape
    const entities = approvedEntities.map((e) => ({
        title: e.title,
        type: e.type,
        action: e.action === "update" ? "update" as const : "create" as const,
        content: e.content ?? "",
        existingNoteId: e.existingNoteId,
        attributes: e.attributes,
        tags: e.tags,
    }));

    return _writeEntitiesToAllCodex(rawText, rawTextHash, entities, "Committed from review", 0, "review-commit", true);
}

async function _writeEntitiesToAllCodex(
    rawText: string,
    rawTextHash: string,
    entities: Array<{
        title: string;
        type: string;
        action: "create" | "update";
        content?: string;
        existingNoteId?: string;
        attributes?: Record<string, unknown>;
        tags?: string[];
    }>,
    summary: string,
    tokensUsed: number,
    model: string,
    autoRelate: boolean
): Promise<BrainDumpResult & { reindexIds: string[]; relations?: Array<{ noteId: string; applied: number; failed: number }> }> {
    const created: BrainDumpResult["created"] = [];
    const updated: BrainDumpResult["updated"] = [];
    const skipped: BrainDumpResult["skipped"] = [];
    const duplicatesFound: DuplicateInfo[] = [];

    const loreRootConfig = await prisma.appConfig.findUnique({ where: { key: "loreRootNoteId" } });
    const loreRootNoteId = loreRootConfig?.value ?? DEFAULT_LORE_ROOT_NOTE_ID;

    const reindexIds: string[] = [];

    for (const entity of entities) {
        try {
            // Step 13: Duplicate detection for new entities
            if (entity.action === "create" || !entity.existingNoteId) {
                const dupMatches = await findDuplicates(entity.title, entity.type);
                if (dupMatches.length > 0) {
                    duplicatesFound.push({
                        proposedTitle: entity.title,
                        proposedType: entity.type,
                        matches: dupMatches,
                    });
                    // Skip creating if a high-confidence exact-title match exists
                    const exactMatch = dupMatches.find(
                        (d) => d.title.toLowerCase() === entity.title.toLowerCase()
                    );
                    if (exactMatch) {
                        skipped.push({ title: entity.title, reason: `Possible duplicate of "${exactMatch.title}" (${Math.round(exactMatch.score * 100)}% match)` });
                        continue;
                    }
                }
            }

            if (entity.action === "update" && entity.existingNoteId) {
                await updateNote(entity.existingNoteId, { title: entity.title });
                if (entity.content) {
                    await setNoteContent(entity.existingNoteId, entity.content);
                }
                updated.push({ noteId: entity.existingNoteId, title: entity.title, type: entity.type as LoreEntityType });
                reindexIds.push(entity.existingNoteId);
            } else {
                const { note } = await createNote({
                    parentNoteId: loreRootNoteId,
                    title: entity.title,
                    type: "text",
                    content: entity.content ?? "",
                });

                const templateId = TEMPLATE_ID_MAP[entity.type as LoreEntityType];
                try {
                    await setNoteTemplate(note.noteId, templateId);
                } catch {
                    rootLogger.warn("Template not found — skipping template link", {
                        templateId,
                        entityTitle: entity.title,
                    });
                }

                await tagNote(note.noteId, "lore");
                await tagNote(note.noteId, "loreType", entity.type);

                if (entity.attributes && typeof entity.attributes === "object") {
                    for (const [name, value] of Object.entries(entity.attributes)) {
                        if (value !== undefined && value !== null && value !== "") {
                            const strValue = Array.isArray(value) ? value.join(", ") : String(value);
                            await createAttribute({ noteId: note.noteId, type: "label", name, value: strValue });
                        }
                    }
                }

                for (const tag of entity.tags ?? []) {
                    await tagNote(note.noteId, tag);
                }

                created.push({ noteId: note.noteId, title: entity.title, type: entity.type as LoreEntityType });
                reindexIds.push(note.noteId);
            }
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            rootLogger.error("Failed to process entity", { entityTitle: entity.title, error: msg });
            skipped.push({ title: entity.title, reason: msg });
        }
    }

    // Auto-relate
    const relationResults: Array<{ noteId: string; applied: number; failed: number }> = [];
    if (autoRelate && created.length > 0) {
        for (const note of created) {
            try {
                const entity = entities.find(e => e.title === note.title);
                const content = entity?.content ?? note.title;
                const suggestions = await suggestRelationsForNote(note.noteId, content);
                const highConfidence = suggestions.filter(s => s.confidence === "high");
                if (highConfidence.length > 0) {
                    const { applied, failed } = await applyRelations(note.noteId, highConfidence);
                    relationResults.push({ noteId: note.noteId, applied: applied.length, failed: failed.length });
                }
            } catch (error) {
                rootLogger.warn("Auto-relate failed", {
                    entityTitle: note.title,
                    error: error instanceof Error ? error.message : String(error),
                });
                relationResults.push({ noteId: note.noteId, applied: 0, failed: 0 });
            }
        }
    }

    // Persist to history — only cache runs that actually wrote something,
    // so failed runs (e.g. AllCodex down) can be retried with the same text.
    if (created.length > 0 || updated.length > 0) {
        await prisma.brainDumpHistory.create({
            data: {
                rawText,
                rawTextHash,
                parsedJson: JSON.parse(JSON.stringify({ entities, summary })),
                notesCreated: created.map((n) => n.noteId),
                notesUpdated: updated.map((n) => n.noteId),
                model,
                tokensUsed,
            },
        });
    }

    return {
        summary,
        created,
        updated,
        skipped,
        ...(duplicatesFound.length > 0 ? { duplicates: duplicatesFound } : {}),
        reindexIds,
        ...(relationResults.length > 0 ? { relations: relationResults } : {}),
    };
}

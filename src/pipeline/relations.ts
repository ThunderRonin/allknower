/**
 * Shared relationship suggestion + apply pipeline.
 *
 * Extracted from route handler so both `/suggest/relationships` and
 * the brain dump auto-relate feature can reuse the same logic.
 */

import { queryLore } from "../rag/lancedb.ts";
import { compactRagContext } from "../rag/compact-context.ts";
import { callLLM } from "./prompt.ts";
import { getNote, createRelation, type CreateRelationOptions, type EtapiCredentials } from "../etapi/client.ts";
import prisma from "../db/client.ts";
import type { RelationSuggestion } from "../types/lore.ts";
import { SUGGEST_RELATIONS_SYSTEM } from "./prompts/suggest.ts";
import { SUGGEST_RELATIONS_JSON_SCHEMA } from "./schemas/llm-response-schemas.ts";
import { SuggestRelationsResponseSchema } from "./schemas/response-schemas.ts";
import { rootLogger } from "../logger.ts";
import { getCoreRelationName, isCanonicalRelationshipType } from "../relationships/mapping.ts";

/**
 * Ask the LLM to suggest meaningful narrative relationships for a note.
 *
 * @param noteId   The AllCodex note ID for context
 * @param noteContent  The text content to analyze
 * @returns Array of suggested relations with confidence levels
 */
export async function suggestRelationsForNote(
    noteId: string,
    noteContent: string,
    credentials?: EtapiCredentials,
    userId?: string
): Promise<RelationSuggestion[]> {
    const similar = await queryLore(noteContent, 15, { userId });

    if (similar.length === 0) {
        rootLogger.warn("suggestRelationsForNote: queryLore returned 0 results — LanceDB may be empty or all candidates below threshold. Run POST /rag/reindex to populate the index.", {
            noteId,
            contentPreview: noteContent.slice(0, 80),
        });
        return [];
    }

    const compacted = await compactRagContext(similar, { task: "suggest" });

    const contextBlock = compacted
        .map((c) => `- ${c.noteTitle} (${c.noteId}): ${c.content}`)
        .join("\n");

    const context = `## Existing Lore\n${contextBlock}`;
    const user = `New entry (noteId: ${noteId}):\n${noteContent}`;

    const { raw } = await callLLM(SUGGEST_RELATIONS_SYSTEM, user, "suggest", context, {
        jsonSchema: SUGGEST_RELATIONS_JSON_SCHEMA,
        userId,
    });

    try {
        const parsed = JSON.parse(raw);
        const validated = SuggestRelationsResponseSchema.safeParse(parsed);
        if (validated.success) {
            const suggestions = validated.data.suggestions as RelationSuggestion[];
            // Filter out self-referential suggestions when noteId is known
            return noteId !== "unknown"
                ? suggestions.filter((s) => s.targetNoteId !== noteId)
                : suggestions;
        }
        rootLogger.warn("Relations response failed validation", {
            errors: validated.error.issues,
        });
        return [];
    } catch {
        rootLogger.warn("Failed to parse LLM suggestions response");
        return [];
    }
}

/**
 * Apply an array of relation suggestions to AllCodex via ETAPI.
 * Logs each applied relation to the RelationHistory table.
 *
 * @returns { applied, failed } — failures are non-fatal per entry
 */
export async function applyRelations(
    sourceNoteId: string,
    relations: Array<{ targetNoteId: string; relationshipType: string; description?: string }>,
    options: CreateRelationOptions & { credentials?: EtapiCredentials } = {}
): Promise<{
    applied: Array<{ sourceNoteId: string; targetNoteId: string; relationshipType: string; relationName: string }>;
    skipped: Array<{ sourceNoteId: string; targetNoteId: string; relationshipType: string; reason: string }>;
    failed: Array<{ sourceNoteId: string; targetNoteId: string; relationshipType: string; error: string }>;
}> {
    const applied: Array<{ sourceNoteId: string; targetNoteId: string; relationshipType: string; relationName: string }> = [];
    const skipped: Array<{ sourceNoteId: string; targetNoteId: string; relationshipType: string; reason: string }> = [];
    const failed: Array<{ sourceNoteId: string; targetNoteId: string; relationshipType: string; error: string }> = [];

    let sourceNote;
    try {
        sourceNote = await getNote(sourceNoteId, options.credentials);
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { applied, skipped, failed: [{ sourceNoteId, targetNoteId: "N/A", relationshipType: "N/A", error: `Failed to fetch source note: ${msg}` }] };
    }
    const existingRelations = sourceNote.attributes?.filter(a => a.type === "relation") || [];

    await Promise.allSettled(
        relations.map(async (rel) => {
            try {
                if (!isCanonicalRelationshipType(rel.relationshipType)) {
                    skipped.push({
                        sourceNoteId,
                        targetNoteId: rel.targetNoteId,
                        relationshipType: rel.relationshipType,
                        reason: `Unknown relationship type: ${rel.relationshipType}`,
                    });
                    return;
                }

                const relationName = getCoreRelationName(rel.relationshipType);

                const exists = existingRelations.some(
                    (attr) => attr.name === relationName && attr.value === rel.targetNoteId
                );

                if (exists) {
                    skipped.push({
                        sourceNoteId,
                        targetNoteId: rel.targetNoteId,
                        relationshipType: rel.relationshipType,
                        reason: "Relation already exists.",
                    });
                    return;
                }

                const result = await createRelation(sourceNoteId, rel.targetNoteId, rel.relationshipType, {
                    bidirectional: options.bidirectional ?? true,
                    description: rel.description,
                    credentials: options.credentials,
                });

                if (result.skipped) {
                    skipped.push({
                        sourceNoteId,
                        targetNoteId: rel.targetNoteId,
                        relationshipType: rel.relationshipType,
                        reason: result.reason ?? "Relation already exists.",
                    });
                    return;
                }

                await prisma.relationHistory.create({
                    data: {
                        sourceNoteId,
                        targetNoteId: rel.targetNoteId,
                        type: rel.relationshipType,
                        relationName,
                        description: rel.description,
                    },
                });

                applied.push({ sourceNoteId, targetNoteId: rel.targetNoteId, relationshipType: rel.relationshipType, relationName });
            } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                rootLogger.error("Failed to apply relation", {
                    sourceNoteId,
                    targetNoteId: rel.targetNoteId,
                    relationType: rel.relationshipType,
                    error: msg,
                });
                failed.push({ sourceNoteId, targetNoteId: rel.targetNoteId, relationshipType: rel.relationshipType, error: msg });
            }
        })
    );

    return { applied, skipped, failed };
}

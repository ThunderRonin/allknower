/**
 * Shared relationship suggestion + apply pipeline.
 *
 * Extracted from route handler so both `/suggest/relationships` and
 * the brain dump auto-relate feature can reuse the same logic.
 */

import { queryLore } from "../rag/lancedb.ts";
import { callLLM } from "./prompt.ts";
import { createRelation, type CreateRelationOptions } from "../etapi/client.ts";
import prisma from "../db/client.ts";
import type { RelationSuggestion } from "../types/lore.ts";
import { SUGGEST_RELATIONS_SYSTEM } from "./prompts/suggest.ts";
import { SUGGEST_RELATIONS_JSON_SCHEMA } from "./schemas/llm-response-schemas.ts";
import { SuggestRelationsResponseSchema } from "./schemas/response-schemas.ts";
import { rootLogger } from "../logger.ts";

/**
 * Ask the LLM to suggest meaningful narrative relationships for a note.
 *
 * @param noteId   The AllCodex note ID for context
 * @param noteContent  The text content to analyze
 * @returns Array of suggested relations with confidence levels
 */
export async function suggestRelationsForNote(
    noteId: string,
    noteContent: string
): Promise<RelationSuggestion[]> {
    const similar = await queryLore(noteContent, 15);

    if (similar.length === 0) {
        return [];
    }

    const contextBlock = similar
        .map((c) => `- ${c.noteTitle} (${c.noteId}): ${c.content.slice(0, 200)}`)
        .join("\n");

    const context = `## Existing Lore\n${contextBlock}`;
    const user = `New entry (noteId: ${noteId}):\n${noteContent}`;

    const { raw } = await callLLM(SUGGEST_RELATIONS_SYSTEM, user, "suggest", context, {
        jsonSchema: SUGGEST_RELATIONS_JSON_SCHEMA,
    });

    try {
        const parsed = JSON.parse(raw);
        const validated = SuggestRelationsResponseSchema.safeParse(parsed);
        if (validated.success) {
            return validated.data.suggestions as RelationSuggestion[];
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
    options: CreateRelationOptions = {}
): Promise<{
    applied: Array<{ targetNoteId: string; type: string }>;
    failed: Array<{ targetNoteId: string; type: string; reason: string }>;
}> {
    const applied: Array<{ targetNoteId: string; type: string }> = [];
    const failed: Array<{ targetNoteId: string; type: string; reason: string }> = [];

    for (const rel of relations) {
        try {
            await createRelation(sourceNoteId, rel.targetNoteId, rel.relationshipType, {
                bidirectional: options.bidirectional ?? true,
                description: rel.description,
            });

            // Log to history
            await prisma.relationHistory.create({
                data: {
                    sourceNoteId,
                    targetNoteId: rel.targetNoteId,
                    type: rel.relationshipType,
                    description: rel.description,
                },
            });

            applied.push({ targetNoteId: rel.targetNoteId, type: rel.relationshipType });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            rootLogger.error("Failed to apply relation", {
                sourceNoteId,
                targetNoteId: rel.targetNoteId,
                relationType: rel.relationshipType,
                error: msg,
            });
            failed.push({ targetNoteId: rel.targetNoteId, type: rel.relationshipType, reason: msg });
        }
    }

    return { applied, failed };
}

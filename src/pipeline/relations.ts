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

    const system = `You are a worldbuilding assistant for All Reach. Given a new lore entry and a list of existing entries, suggest meaningful narrative relationships between them.

Return JSON: { "suggestions": [{ "targetNoteId": "...", "targetTitle": "...", "relationshipType": "ally|enemy|family|location|event|faction|other", "description": "One sentence explaining the suggested connection.", "confidence": "high|medium|low" }] }

Rules:
- Only suggest relationships that are genuinely plausible based on the content
- Do not invent connections
- "high" confidence = directly stated or strongly implied in the text
- "medium" confidence = likely based on context clues
- "low" confidence = possible but speculative`;

    const contextBlock = similar
        .map((c) => `- ${c.noteTitle} (${c.noteId}): ${c.content.slice(0, 200)}`)
        .join("\n");

    const user = `New entry (noteId: ${noteId}):\n${noteContent}\n\nExisting lore:\n${contextBlock}`;

    const { raw } = await callLLM(system, user, "suggest");

    try {
        const parsed = JSON.parse(raw);
        return (parsed.suggestions ?? []) as RelationSuggestion[];
    } catch {
        console.warn("[relations] Failed to parse LLM suggestions response");
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
            console.error(`[relations] Failed to apply relation ${sourceNoteId} → ${rel.targetNoteId}:`, error);
            failed.push({ targetNoteId: rel.targetNoteId, type: rel.relationshipType, reason: msg });
        }
    }

    return { applied, failed };
}

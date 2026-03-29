import Elysia, { t } from "elysia";
import { queryLore } from "../rag/lancedb.ts";
import { getAllCodexNotes } from "../etapi/client.ts";
import { callLLM } from "../pipeline/prompt.ts";
import { requireAuth } from "../plugins/auth-guard.ts";
import prisma from "../db/client.ts";
import { suggestRelationsForNote, applyRelations } from "../pipeline/relations.ts";
import { GAP_DETECT_SYSTEM } from "../pipeline/prompts/gap-detect.ts";
import { AUTOCOMPLETE_SYSTEM } from "../pipeline/prompts/autocomplete.ts";
import { GAP_DETECT_JSON_SCHEMA } from "../pipeline/schemas/llm-response-schemas.ts";
import { GapDetectResponseSchema } from "../pipeline/schemas/response-schemas.ts";
import { rootLogger } from "../logger.ts";

export const suggestRoute = new Elysia({ prefix: "/suggest" })
    .use(requireAuth)
    /**
     * Relationship suggester — given a note, find semantically similar lore
     * and ask the LLM to suggest meaningful connections.
     */
    .post(
        "/relationships",
        async ({ body }) => {
            const suggestions = await suggestRelationsForNote("unknown", body.text);
            return { suggestions };
        },
        {
            body: t.Object({
                text: t.String({ description: "Text of the new or existing lore entry to find relationships for" }),
            }),
            detail: {
                summary: "Suggest relationships",
                description:
                    "Finds semantically similar lore and suggests meaningful narrative connections.",
                tags: ["Intelligence"],
            },
        }
    )
    /**
     * Apply approved relationship suggestions — writes relation attributes
     * back to AllCodex via ETAPI.
     */
    .post(
        "/relationships/apply",
        async ({ body }) => {
            const result = await applyRelations(
                body.sourceNoteId,
                body.relations,
                { bidirectional: body.bidirectional ?? true }
            );
            return result;
        },
        {
            body: t.Object({
                sourceNoteId: t.String({ description: "The AllCodex note ID to create relations from" }),
                relations: t.Array(t.Object({
                    targetNoteId: t.String(),
                    relationshipType: t.String({ description: "ally|enemy|family|location|event|faction|other" }),
                    description: t.Optional(t.String()),
                })),
                bidirectional: t.Optional(t.Boolean({ default: true, description: "Create inverse relation on target note too" })),
            }),
            detail: {
                summary: "Apply relationship suggestions",
                description:
                    "Writes approved relation suggestions to AllCodex as relation attributes.",
                tags: ["Intelligence"],
            },
        }
    )
    /**
     * Gap detector — analyze the lore corpus and identify underdeveloped areas.
     */
    .get(
        "/gaps",
        async () => {
            const notes = await getAllCodexNotes("#lore");

            const typeCounts: Record<string, number> = {};
            for (const note of notes) {
                const typeAttr = note.attributes?.find((a: { name: string }) => a.name === "loreType");
                const type = typeAttr?.value ?? "unknown";
                typeCounts[type] = (typeCounts[type] ?? 0) + 1;
            }

            const context = `Lore entry counts by type:\n${JSON.stringify(typeCounts, null, 2)}\n\nTotal entries: ${notes.length}`;
            const user = `Identify gaps and underdeveloped areas in this lore collection.`;

            const { raw } = await callLLM(GAP_DETECT_SYSTEM, user, "gap-detect", context, {
                jsonSchema: GAP_DETECT_JSON_SCHEMA,
            });

            let result: unknown;
            try {
                const parsed = JSON.parse(raw);
                const validated = GapDetectResponseSchema.safeParse(parsed);
                if (validated.success) {
                    result = validated.data;
                } else {
                    rootLogger.warn("Gap detect response failed validation", {
                        errors: validated.error.issues,
                    });
                    result = { gaps: [], summary: "LLM response failed validation." };
                }
            } catch {
                result = { gaps: [], summary: "Failed to parse gap analysis." };
            }

            return { ...(result as object), typeCounts, totalNotes: notes.length };
        },
        {
            detail: {
                summary: "Detect lore gaps",
                description:
                    "Analyzes the lore corpus and identifies underdeveloped areas.",
                tags: ["Intelligence"],
            },
        }
    )
    /**
     * Autocomplete — fast lore title suggestions as the user types.
     *
     * Phase 1: Prisma title prefix match (instant, SQL).
     * Phase 2: Semantic LanceDB fallback to fill remaining slots.
     */
    .get(
        "/autocomplete",
        async ({ query }) => {
            const q = query.q;
            const limit = Number(query.limit ?? 10);

            // Phase 1: fast prefix match from the RAG index metadata table
            const prefixMatches = await prisma.ragIndexMeta.findMany({
                where: { noteTitle: { contains: q, mode: "insensitive" } },
                take: limit,
                select: { noteId: true, noteTitle: true },
                orderBy: { noteTitle: "asc" },
            });

            const seen = new Set(prefixMatches.map((m) => m.noteId));
            const suggestions = prefixMatches.map((m) => ({
                noteId: m.noteId,
                title: m.noteTitle,
            }));

            // Phase 2: semantic fill if prefix didn't saturate the limit
            if (suggestions.length < limit) {
                const remaining = limit - suggestions.length;
                const semantic = await queryLore(q, remaining + seen.size);
                for (const chunk of semantic) {
                    if (!seen.has(chunk.noteId)) {
                        suggestions.push({ noteId: chunk.noteId, title: chunk.noteTitle });
                        seen.add(chunk.noteId);
                    }
                    if (suggestions.length >= limit) break;
                }
            }

            // Phase 3: LLM creative completion when prefix + semantic came up empty
            if (suggestions.length < Math.min(3, limit)) {
                try {
                    const { raw } = await callLLM(AUTOCOMPLETE_SYSTEM, `Complete: "${q}"`, "autocomplete");
                    const parsed = JSON.parse(raw);
                    for (const s of (parsed.suggestions ?? [])) {
                        if (suggestions.length >= limit) break;
                        const matches = await prisma.ragIndexMeta.findMany({
                            where: { noteTitle: { contains: s.title, mode: "insensitive" } },
                            take: 1,
                            select: { noteId: true, noteTitle: true },
                        });
                        if (matches.length > 0 && !seen.has(matches[0].noteId)) {
                            suggestions.push({ noteId: matches[0].noteId, title: matches[0].noteTitle });
                            seen.add(matches[0].noteId);
                        }
                    }
                } catch { /* LLM autocomplete is best-effort */ }
            }

            return { suggestions };
        },
        {
            query: t.Object({
                q: t.String({ minLength: 1, description: "Partial title or concept to search for" }),
                limit: t.Optional(t.Numeric({ minimum: 1, maximum: 20, default: 10, description: "Max suggestions (1–20)" })),
            }),
            detail: {
                summary: "Lore autocomplete",
                description:
                    "Returns lore entry suggestions as the user types. Phase 1: instant title prefix match. Phase 2: semantic similarity fallback.",
                tags: ["Intelligence"],
            },
        }
    );

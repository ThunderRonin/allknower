import Elysia, { t } from "elysia";
import { getAllCodexNotes, getNoteContent } from "../etapi/client.ts";
import { callLLM } from "../pipeline/prompt.ts";
import { queryLore } from "../rag/lancedb.ts";
import { requireAuth } from "../plugins/auth-guard.ts";
import { CONSISTENCY_SYSTEM } from "../pipeline/prompts/consistency.ts";
import { CONSISTENCY_JSON_SCHEMA } from "../pipeline/schemas/llm-response-schemas.ts";
import { ConsistencyResponseSchema } from "../pipeline/schemas/response-schemas.ts";
import { rootLogger } from "../logger.ts";

/**
 * Semantic probes used to find the most relevant lore notes when no noteIds are
 * supplied. Multiple probes ensure broad coverage across the lore graph.
 */
const CONSISTENCY_PROBES = [
    "characters relationships history factions alliances",
    "world rules laws magic systems geography cosmology",
    "timeline events conflicts wars major incidents",
    "contradictions anomalies unresolved plot threads",
];

/** Max content chars to include per note in the LLM context (item 2.4 fix). */
const MAX_NOTE_CHARS = 2000;

export const consistencyRoute = new Elysia({ prefix: "/consistency" })
    .use(requireAuth)
    .post(
    "/check",
    async ({ body }) => {
        type NoteEntry = { noteId: string; title: string; content: string };
        let notes: NoteEntry[];

        if (body.noteIds?.length) {
            // Explicit mode: fetch requested notes and pass full content
            const search = body.noteIds.map((id) => `#noteId=${id}`).join(" OR ");
            const etapiNotes = await getAllCodexNotes(search);

            if (etapiNotes.length === 0) {
                return { issues: [], summary: "No lore notes found to check." };
            }

            notes = await Promise.all(
                etapiNotes.map(async (note) => {
                    const content = await getNoteContent(note.noteId).catch(() => "");
                    const plain = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
                    return { noteId: note.noteId, title: note.title, content: plain };
                })
            );
        } else {
            // Semantic sampling mode: use RAG probes to surface the most
            // consistency-relevant lore entries instead of truncating everything.
            const seenIds = new Set<string>();
            const sampled: NoteEntry[] = [];

            for (const probe of CONSISTENCY_PROBES) {
                const chunks = await queryLore(probe, 8);
                for (const chunk of chunks) {
                    if (!seenIds.has(chunk.noteId)) {
                        seenIds.add(chunk.noteId);
                        sampled.push({
                            noteId: chunk.noteId,
                            title: chunk.noteTitle,
                            content: chunk.content,
                        });
                    }
                }
            }

            if (sampled.length === 0) {
                return { issues: [], summary: "No lore notes found to check." };
            }

            notes = sampled;
        }

        const loreSummaries = notes.map(({ noteId, title, content }) => {
            const excerpt = content.slice(0, MAX_NOTE_CHARS);
            return `## ${title} (${noteId})\n${excerpt}`;
        });

        const context = `## Lore Entries\n\n${loreSummaries.join("\n\n")}`;
        const user = `Check these lore entries for consistency issues.`;

        const { raw } = await callLLM(CONSISTENCY_SYSTEM, user, "consistency", context, {
            jsonSchema: CONSISTENCY_JSON_SCHEMA,
        });

        let result: unknown;
        try {
            const parsed = JSON.parse(raw);
            const validated = ConsistencyResponseSchema.safeParse(parsed);
            if (validated.success) {
                result = validated.data;
            } else {
                rootLogger.warn("Consistency response failed validation", {
                    errors: validated.error.issues,
                });
                result = { issues: [], summary: "LLM response failed validation." };
            }
        } catch {
            result = { issues: [], summary: "Failed to parse consistency check response." };
        }

        return result;
    },
    {
        body: t.Object({
            noteIds: t.Optional(
                t.Array(t.String(), { description: "Specific note IDs to check. Omit to use semantic sampling across all lore." })
            ),
        }),
        detail: {
            summary: "Run consistency check",
            description:
                "Scans lore entries for contradictions, timeline conflicts, orphaned references, and naming inconsistencies. When noteIds are omitted, uses RAG semantic sampling to find the most relevant lore entries.",
            tags: ["Intelligence"],
        },
    }
);

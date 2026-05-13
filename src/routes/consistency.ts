import Elysia, { t } from "elysia";
import { rateLimit } from "elysia-rate-limit";
import { getAllCodexNotes, getNoteContent } from "../etapi/client.ts";
import { callLLM } from "../pipeline/prompt.ts";
import { queryLore } from "../rag/lancedb.ts";
import { requireAuth } from "../plugins/auth-guard.ts";
import { resolveAllCodexCredentials } from "../integrations/allcodex.ts";
import { env } from "../env.ts";
import { CONSISTENCY_SYSTEM } from "../pipeline/prompts/consistency.ts";
import { CONSISTENCY_JSON_SCHEMA } from "../pipeline/schemas/llm-response-schemas.ts";
import { ConsistencyResponseSchema } from "../pipeline/schemas/response-schemas.ts";
import { rootLogger } from "../logger.ts";

/**
 * Semantic probes used to find the most relevant lore notes when no noteIds are
 * supplied. Multiple probes ensure broad coverage across the lore graph.
 */
const CONSISTENCY_QUERY =
    "characters relationships factions timeline world rules contradictions unresolved plot threads";

/**
 * Keep the consistency prompt bounded. The previous route could feed the LLM
 * up to 32 note excerpts at 2000 chars each, which routinely pushed the live
 * integration flow past the generic 120s timeout.
 */
const CONSISTENCY_TOP_K = 8;
const MAX_NOTE_CHARS = 600;
const CONSISTENCY_TIMEOUT_MS = 120_000;
const CONSISTENCY_MAX_TOKENS = 2000;

export const consistencyRoute = new Elysia({ prefix: "/consistency" })
    .use(requireAuth)
    .use(
        rateLimit({
            max: env.AI_RATE_LIMIT_MAX,
            duration: env.AI_RATE_LIMIT_WINDOW_MS,
            errorResponse: new Response(
                JSON.stringify({
                    error: "Rate limit exceeded for AI tools.",
                    code: "RATE_LIMITED",
                }),
                { status: 429, headers: { "Content-Type": "application/json" } }
            ),
        })
    )
    .post(
    "/check",
    async ({ body, session }) => {
        const credentials = await resolveAllCodexCredentials(session!.user.id);
        type NoteEntry = { noteId: string; title: string; content: string };
        let notes: NoteEntry[];

        if (body.noteIds?.length) {
            // Explicit mode: fetch requested notes and pass full content
            const search = body.noteIds.map((id) => `#noteId=${id}`).join(" OR ");
            const etapiNotes = await getAllCodexNotes(search, credentials);

            if (etapiNotes.length === 0) {
                return { issues: [], summary: "No lore notes found to check." };
            }

            notes = await Promise.all(
                etapiNotes.map(async (note) => {
                    const content = await getNoteContent(note.noteId, credentials).catch(() => "");
                    const plain = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
                    return { noteId: note.noteId, title: note.title, content: plain };
                })
            );
        } else {
            // Semantic sampling mode: use RAG probes to surface the most
            // consistency-relevant lore entries instead of truncating everything.
            const chunks = await queryLore(CONSISTENCY_QUERY, CONSISTENCY_TOP_K);
            const sampled = chunks.map((chunk) => ({
                noteId: chunk.noteId,
                title: chunk.noteTitle,
                content: chunk.content,
            }));

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
            timeoutMs: CONSISTENCY_TIMEOUT_MS,
            maxTokens: CONSISTENCY_MAX_TOKENS,
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

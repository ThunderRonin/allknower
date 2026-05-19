import Elysia, { t } from "elysia";
import { rateLimit } from "elysia-rate-limit";
import { getAllCodexNotes, getNoteContent } from "../etapi/client.ts";
import { callLLM } from "../pipeline/prompt.ts";
import { queryLore } from "../rag/lancedb.ts";
import { compactRagContext } from "../rag/compact-context.ts";
import { requireAuth } from "../plugins/auth-guard.ts";
import { resolveAllCodexCredentials } from "../integrations/allcodex.ts";
import type { AllCodexCredentials } from "../integrations/allcodex.ts";
import { env } from "../env.ts";
import { CONSISTENCY_SYSTEM } from "../pipeline/prompts/consistency.ts";
import { CONSISTENCY_JSON_SCHEMA } from "../pipeline/schemas/llm-response-schemas.ts";
import { ConsistencyResponseSchema } from "../pipeline/schemas/response-schemas.ts";
import { rootLogger } from "../logger.ts";
import { sseEncode } from "../pipeline/stream-types.ts";

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

type NoteEntry = { noteId: string; title: string; content: string };

/**
 * Resolve lore notes for consistency checking.
 *
 * - Explicit mode (noteIds provided): fetch via ETAPI, strip HTML, return entries.
 * - Semantic sampling mode (no noteIds): RAG query + compact to token budget.
 */
async function resolveConsistencyNotes(
    noteIds: string[] | undefined,
    credentials: AllCodexCredentials,
): Promise<NoteEntry[]> {
    if (noteIds?.length) {
        const search = noteIds.map((id) => `#noteId=${id}`).join(" OR ");
        const etapiNotes = await getAllCodexNotes(search, credentials);
        return Promise.all(
            etapiNotes.map(async (note) => {
                const content = await getNoteContent(note.noteId, credentials).catch(() => "");
                const plain = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); // NOSONAR — [^>]+ is non-backtracking
                return { noteId: note.noteId, title: note.title, content: plain };
            })
        );
    }

    const rawChunks = await queryLore(CONSISTENCY_QUERY, CONSISTENCY_TOP_K);
    const compacted = await compactRagContext(rawChunks, { task: "consistency" });
    return compacted.map((chunk) => ({
        noteId: chunk.noteId,
        title: chunk.noteTitle,
        content: chunk.content,
    }));
}

/** Build the lore-entries context block sent to the LLM. */
function buildConsistencyPromptContext(notes: NoteEntry[]): string {
    const loreSummaries = notes.map(({ noteId, title, content }) => {
        const excerpt = content.slice(0, MAX_NOTE_CHARS);
        return `## ${title} (${noteId})\n${excerpt}`;
    });
    return `## Lore Entries\n\n${loreSummaries.join("\n\n")}`;
}

/** Parse + validate the raw LLM JSON response, falling back gracefully. */
function parseConsistencyResponse(raw: string): unknown {
    try {
        const parsed = JSON.parse(raw);
        const validated = ConsistencyResponseSchema.safeParse(parsed);
        if (validated.success) return validated.data;
        rootLogger.warn("Consistency response failed validation", {
            errors: validated.error.issues,
        });
        return { issues: [], summary: "LLM response failed validation." };
    } catch {
        return { issues: [], summary: "Failed to parse consistency check response." };
    }
}

type ConsistencyRouteDeps = {
    requireAuthImpl?: typeof requireAuth;
};

export function createConsistencyRoute({
    requireAuthImpl = requireAuth,
}: ConsistencyRouteDeps = {}) {
    return new Elysia({ prefix: "/consistency" })
        .use(requireAuthImpl)
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
        const notes = await resolveConsistencyNotes(body.noteIds, credentials);

        if (notes.length === 0) {
            return { issues: [], summary: "No lore notes found to check." };
        }

        const context = buildConsistencyPromptContext(notes);
        const { raw } = await callLLM(CONSISTENCY_SYSTEM, "Check these lore entries for consistency issues.", "consistency", context, {
            jsonSchema: CONSISTENCY_JSON_SCHEMA,
            timeoutMs: CONSISTENCY_TIMEOUT_MS,
            maxTokens: CONSISTENCY_MAX_TOKENS,
        });

        return parseConsistencyResponse(raw);
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
)
    .post(
        "/check/stream",
        async ({ body, session, set }) => {
            const credentials = await resolveAllCodexCredentials(session!.user.id);

            set.headers["Content-Type"] = "text/event-stream";
            set.headers["Cache-Control"] = "no-cache";
            set.headers["Connection"] = "keep-alive";

            return new ReadableStream({
                async start(controller) {
                    const encoder = new TextEncoder();
                    const send = (event: string, data: unknown) => {
                        controller.enqueue(encoder.encode(sseEncode(event, data)));
                    };

                    try {
                        send("status", { stage: "analyze", message: "Analyzing notes..." });

                        const notes = await resolveConsistencyNotes(body.noteIds, credentials);

                        if (notes.length === 0) {
                            send("result", { issues: [], summary: "No lore notes found to check." });
                            send("done", {});
                            controller.close();
                            return;
                        }

                        const context = buildConsistencyPromptContext(notes);
                        const { raw } = await callLLM(CONSISTENCY_SYSTEM, "Check these lore entries for consistency issues.", "consistency", context, {
                            jsonSchema: CONSISTENCY_JSON_SCHEMA,
                            timeoutMs: CONSISTENCY_TIMEOUT_MS,
                            maxTokens: CONSISTENCY_MAX_TOKENS,
                        });

                        send("result", parseConsistencyResponse(raw));
                        send("done", {});
                    } catch (e) {
                        send("error", { error: e instanceof Error ? e.message : String(e) });
                    } finally {
                        controller.close();
                    }
                },
            });
        },
        {
            body: t.Object({
                noteIds: t.Optional(
                    t.Array(t.String(), { description: "Specific note IDs to check. Omit to use semantic sampling across all lore." })
                ),
            }),
            detail: {
                summary: "Run consistency check (streaming)",
                description: "Streaming variant with status events for progress.",
                tags: ["Intelligence"],
            },
        }
    );
}

export const consistencyRoute = createConsistencyRoute();

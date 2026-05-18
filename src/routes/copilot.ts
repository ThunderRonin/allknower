import Elysia, { t } from "elysia";
import { rateLimit } from "elysia-rate-limit";
import { requireAuth } from "../plugins/auth-guard.ts";
import { env } from "../env.ts";
import { ArticleCopilotRequestSchema, ArticleCopilotResponseSchema } from "../types/copilot.ts";
import type { CopilotRagChunk } from "../types/copilot.ts";
import { runArticleCopilotTurn, runArticleCopilotStream, validateProposalScope } from "../pipeline/article-copilot.ts";
import { sseEncode } from "../pipeline/stream-types.ts";
import { compactRagContext } from "../rag/compact-context.ts";
import type { RagChunk } from "../types/lore.ts";

const ChatMessageBody = t.Object({
    role: t.Union([t.Literal("user"), t.Literal("assistant")]),
    content: t.String({ minLength: 1 }),
});

const CopilotNoteContextBody = t.Object({
    noteId: t.String(),
    title: t.String(),
    loreType: t.String(),
    contentHtml: t.String(),
    parentNoteIds: t.Array(t.String()),
    labels: t.Array(t.Object({
        name: t.String(),
        value: t.String(),
    })),
    relations: t.Array(t.Object({
        name: t.String(),
        targetNoteId: t.String(),
        description: t.Optional(t.String()),
    })),
});

const CopilotRagChunkBody = t.Object({
    noteId: t.String(),
    title: t.String(),
    excerpt: t.String(),
    score: t.Number(),
});

/** Adapt Portal's CopilotRagChunk[] → AllKnower RagChunk[] for compaction. */
function portalChunksToRag(chunks: CopilotRagChunk[]): RagChunk[] {
    return chunks.map((c) => ({
        noteId: c.noteId,
        noteTitle: c.title,
        content: c.excerpt,
        score: c.score,
    }));
}

/** Convert compacted RagChunk[] back to Portal's CopilotRagChunk shape. */
function ragToPortalChunks(chunks: RagChunk[]): CopilotRagChunk[] {
    return chunks.map((c) => ({
        noteId: c.noteId,
        title: c.noteTitle,
        excerpt: c.content,
        score: c.score,
    }));
}

type CopilotRouteDeps = {
    requireAuthImpl?: typeof requireAuth;
};

export function createCopilotRoute({
    requireAuthImpl = requireAuth,
}: CopilotRouteDeps = {}) {
    return new Elysia({ prefix: "/copilot" })
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
        "/article",
        async ({ body }) => {
            const parsed = ArticleCopilotRequestSchema.parse(body);
            const compactedRag = await compactRagContext(
                portalChunksToRag(parsed.ragContext),
                { task: "article-copilot" },
            );
            const compactedRequest = { ...parsed, ragContext: ragToPortalChunks(compactedRag) };
            return runArticleCopilotTurn(compactedRequest);
        },
        {
            body: t.Object({
                noteId: t.String(),
                transcript: t.Array(ChatMessageBody),
                currentNote: CopilotNoteContextBody,
                linkedNotes: t.Array(CopilotNoteContextBody),
                ragContext: t.Array(CopilotRagChunkBody),
                writableTargetIds: t.Array(t.String()),
            }),
            detail: {
                summary: "Article-scoped lore copilot",
                description:
                    "Generates discussion replies and reviewable proposals scoped to the current lore article and its direct writable neighbors.",
                tags: ["Intelligence"],
            },
        }
    )
    .post(
        "/article/stream",
        async ({ body, set }) => {
            const parsed = ArticleCopilotRequestSchema.parse(body);
            const compactedRag = await compactRagContext(
                portalChunksToRag(parsed.ragContext),
                { task: "article-copilot" },
            );
            const compactedRequest = { ...parsed, ragContext: ragToPortalChunks(compactedRag) };

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
                        send("status", { stage: "llm", message: "Generating response..." });

                        for await (const chunk of runArticleCopilotStream(compactedRequest)) {
                            if (chunk.type === "token") {
                                send("token", { content: chunk.content });
                            } else if (chunk.type === "reasoning") {
                                send("reasoning", { content: chunk.content });
                            } else if (chunk.type === "done") {
                                try {
                                    const jsonParsed = JSON.parse(chunk.raw);
                                    const validated = ArticleCopilotResponseSchema.parse(jsonParsed);
                                    const scoped = validateProposalScope(validated, compactedRequest);
                                    send("result", scoped);
                                } catch (e) {
                                    send("error", { error: e instanceof Error ? e.message : "Invalid copilot response" });
                                }
                                send("done", {
                                    tokensUsed: chunk.tokensUsed,
                                    model: chunk.model,
                                    latencyMs: chunk.latencyMs,
                                });
                            } else if (chunk.type === "error") {
                                send("error", { error: chunk.error, code: chunk.code });
                            }
                        }
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
                noteId: t.String(),
                transcript: t.Array(ChatMessageBody),
                currentNote: CopilotNoteContextBody,
                linkedNotes: t.Array(CopilotNoteContextBody),
                ragContext: t.Array(CopilotRagChunkBody),
                writableTargetIds: t.Array(t.String()),
            }),
            detail: {
                summary: "Article copilot (streaming SSE)",
                description: "Streaming variant of /copilot/article. Returns SSE events: status, token, reasoning, result, done, error.",
                tags: ["Intelligence"],
            },
        }
    );
}

export const copilotRoute = createCopilotRoute();

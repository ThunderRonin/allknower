import Elysia, { t } from "elysia";
import { rateLimit } from "elysia-rate-limit";
import { requireAuth } from "../plugins/auth-guard.ts";
import { env } from "../env.ts";
import { ArticleCopilotRequestSchema, ArticleCopilotResponseSchema } from "../types/copilot.ts";
import type { ArticleCopilotRequest, CopilotRagChunk } from "../types/copilot.ts";
import { runArticleCopilotTurn, runArticleCopilotStream, validateProposalScope } from "../pipeline/article-copilot.ts";
import { sseEncode } from "../pipeline/stream-types.ts";
import { compactRagContext } from "../rag/compact-context.ts";
import type { RagChunk } from "../types/lore.ts";
import prisma from "../db/client.ts";
import type { LoreSession } from "@prisma/client";
import { shouldCompact, compactSession } from "../pipeline/session-compactor.ts";
import { countTokens } from "../utils/tokens.ts";
import { rootLogger } from "../logger.ts";

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

const ArticleCopilotBody = t.Object({
    noteId: t.String(),
    sessionId: t.Optional(t.String()),
    transcript: t.Array(ChatMessageBody),
    currentNote: CopilotNoteContextBody,
    linkedNotes: t.Array(CopilotNoteContextBody),
    ragContext: t.Array(CopilotRagChunkBody),
    writableTargetIds: t.Array(t.String()),
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

/**
 * Find or create a LoreSession, run tier-3 compaction if needed,
 * and persist the latest user message.
 *
 * Returns the resolved session on success, or an error descriptor
 * that the caller can forward as an HTTP response.
 */
async function resolveOrCreateSession(
    parsed: ArticleCopilotRequest,
    compactedRequest: ArticleCopilotRequest,
    userId: string,
): Promise<{ loreSession: LoreSession } | { error: true; status: number; body: unknown }> {
    let loreSession;
    if (parsed.sessionId) {
        loreSession = await prisma.loreSession.findUnique({
            where: { id: parsed.sessionId },
        });
        if (!loreSession || loreSession.userId !== userId) {
            return { error: true, status: 404, body: { error: "NOT_FOUND", message: "Session not found" } };
        }
    } else {
        loreSession = await prisma.loreSession.create({
            data: {
                userId,
                title: compactedRequest.currentNote.title,
                state: {},
                tokensAccumulated: 0,
            },
        });
    }

    // Tier 3 compaction check
    if (shouldCompact(loreSession)) {
        try {
            await compactSession(loreSession);
            loreSession = await prisma.loreSession.findUniqueOrThrow({
                where: { id: loreSession.id },
            });
        } catch (e) {
            // CompactionLockError is non-fatal — proceed with existing context
            rootLogger.warn("Session compaction skipped", { error: String(e) });
        }
    }

    // Persist user message (before LLM call — may leave orphan on LLM failure)
    await prisma.loreSessionMessage.create({
        data: {
            sessionId: loreSession.id,
            role: "user",
            content: parsed.transcript.at(-1)?.content ?? "",
        },
    });

    return { loreSession };
}

/**
 * Parse the request body, compact RAG context, and resolve/create a session.
 *
 * Encapsulates the identical setup block shared by /article and /article/stream.
 * Returns the prepared inputs on success, or an error descriptor the caller can
 * forward as an HTTP response.
 */
async function prepareCopilotTurn(
    body: unknown,
    userId: string,
): Promise<
    | { compactedRequest: ArticleCopilotRequest; loreSession: LoreSession }
    | { error: true; status: number; body: unknown }
> {
    const parsed = ArticleCopilotRequestSchema.parse(body);
    const compactedRag = await compactRagContext(
        portalChunksToRag(parsed.ragContext),
        { task: "article-copilot" },
    );
    const compactedRequest = { ...parsed, ragContext: ragToPortalChunks(compactedRag) };

    const sessionResult = await resolveOrCreateSession(parsed, compactedRequest, userId);
    if ("error" in sessionResult) return sessionResult;
    return { compactedRequest, loreSession: sessionResult.loreSession };
}

/**
 * Persist the assistant message and increment the session token accumulator.
 * Callers are responsible for only invoking this when content is non-empty.
 */
async function persistAssistantMessage(sessionId: string, content: string): Promise<void> {
    const msgTokens = countTokens(content);
    await Promise.all([
        prisma.loreSessionMessage.create({
            data: {
                sessionId,
                role: "assistant",
                content,
                tokenCount: msgTokens,
            },
        }),
        prisma.loreSession.update({
            where: { id: sessionId },
            data: { tokensAccumulated: { increment: msgTokens } },
        }),
    ]);
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
        async ({ body, session, set }) => {
            const prep = await prepareCopilotTurn(body, session!.user.id);
            if ("error" in prep) {
                set.status = prep.status;
                return prep.body;
            }
            const { compactedRequest, loreSession } = prep;

            // Run LLM
            const response = await runArticleCopilotTurn(compactedRequest);

            // Persist assistant message + update token accumulator
            await persistAssistantMessage(loreSession.id, response.assistantMessage);

            return { ...response, sessionId: loreSession.id };
        },
        {
            body: ArticleCopilotBody,
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
        async ({ body, session, set }) => {
            // ── Session lifecycle (before SSE — errors return JSON) ──────
            const prep = await prepareCopilotTurn(body, session!.user.id);
            if ("error" in prep) {
                set.status = prep.status;
                return prep.body;
            }
            const { compactedRequest, loreSession } = prep;

            // ── SSE streaming ───────────────────────────────────────────
            set.headers["Content-Type"] = "text/event-stream";
            set.headers["Cache-Control"] = "no-cache";
            set.headers["Connection"] = "keep-alive";

            const sessionId = loreSession.id;
            let assistantContent = "";

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
                                assistantContent += chunk.content;
                                send("token", { content: chunk.content });
                            } else if (chunk.type === "reasoning") {
                                send("reasoning", { content: chunk.content });
                            } else if (chunk.type === "done") {
                                try {
                                    const jsonParsed = JSON.parse(chunk.raw);
                                    // Inject sessionId — the LLM response won't include it
                                    const validated = ArticleCopilotResponseSchema.parse({
                                        ...jsonParsed,
                                        sessionId,
                                    });
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

                        // After stream completes: persist assistant message + update tokens
                        if (assistantContent) {
                            await persistAssistantMessage(sessionId, assistantContent);
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
            body: ArticleCopilotBody,
            detail: {
                summary: "Article copilot (streaming SSE)",
                description: "Streaming variant of /copilot/article. Returns SSE events: status, token, reasoning, result, done, error.",
                tags: ["Intelligence"],
            },
        }
    );
}

export const copilotRoute = createCopilotRoute();

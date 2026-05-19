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

/**
 * Map internal RagChunk objects to the Portal CopilotRagChunk format.
 *
 * Converts each chunk's `noteTitle` to `title` and `content` to `excerpt`, preserving
 * `noteId` and `score`.
 *
 * @param chunks - The array of internal `RagChunk` objects to convert
 * @returns An array of `CopilotRagChunk` objects with `noteId`, `title`, `excerpt`, and `score` populated
 */
function ragToPortalChunks(chunks: RagChunk[]): CopilotRagChunk[] {
    return chunks.map((c) => ({
        noteId: c.noteId,
        title: c.noteTitle,
        excerpt: c.content,
        score: c.score,
    }));
}

/**
 * Ensures a LoreSession exists for the given request, attempts tier-3 compaction when needed, and records the latest user message.
 *
 * @param parsed - The original validated request payload; may include `sessionId` to resolve an existing session.
 * @param compactedRequest - The request whose RAG context has been compacted; used for initial session metadata when creating a new session.
 * @param userId - ID of the authenticated user performing the action.
 * @returns On success, an object containing the resolved `loreSession`. On failure, an error descriptor `{ error: true; status: number; body: unknown }` suitable for forwarding as an HTTP response (for example, 404 when a provided `sessionId` does not exist or does not belong to `userId`). Compaction failures are treated as non-fatal and do not prevent a successful return. */
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
 * Parse and prepare an article copilot request and ensure an associated LoreSession exists.
 *
 * Parses the raw request, compacts its RAG context for the "article-copilot" task, and resolves or creates the user's lore session.
 *
 * @param body - The raw request body to be parsed as an ArticleCopilotRequest
 * @param userId - The requesting user's ID used to resolve or create the session
 * @returns On success, an object containing `compactedRequest` (with compacted `ragContext`) and the `loreSession`; on failure, an error descriptor `{ error: true, status, body }` intended to be forwarded as an HTTP response
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
 * Persist an assistant message for a lore session and increment that session's token accumulator.
 *
 * @param sessionId - ID of the lore session to associate the message with
 * @param content - Assistant message content; must be non-empty
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

/**
 * Creates and returns an Elysia application mounted at the `/copilot` prefix that exposes copilot endpoints.
 *
 * The returned app includes authentication middleware, rate limiting for AI usage, and two POST routes:
 * - `/copilot/article` — non-streaming article-scoped copilot handler
 * - `/copilot/article/stream` — SSE streaming article-scoped copilot handler
 *
 * @param requireAuthImpl - Optional authentication middleware to apply to the routes; defaults to the module's `requireAuth` implementation.
 * @returns An Elysia application instance with the copilot routes and configured middleware.
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

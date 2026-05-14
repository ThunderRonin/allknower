import Elysia, { t } from "elysia";
import { rateLimit } from "elysia-rate-limit";
import { background } from "elysia-background";
import { runBrainDump, runBrainDumpStream, commitReviewedEntities } from "../pipeline/brain-dump.ts";
import { sseEncode } from "../pipeline/stream-types.ts";
import { indexNote } from "../rag/indexer.ts";
import { env } from "../env.ts";
import { requireAuth } from "../plugins/auth-guard.ts";
import { resolveAllCodexCredentials } from "../integrations/allcodex.ts";

type BrainDumpRouteDeps = {
    runBrainDumpImpl?: typeof runBrainDump;
    runBrainDumpStreamImpl?: typeof runBrainDumpStream;
    commitReviewedEntitiesImpl?: typeof commitReviewedEntities;
    indexNoteImpl?: typeof indexNote;
    requireAuthImpl?: typeof requireAuth;
    rateLimitEnv?: Pick<typeof env, "BRAIN_DUMP_RATE_LIMIT_MAX" | "BRAIN_DUMP_RATE_LIMIT_WINDOW_MS">;
};

export function createBrainDumpRoute({
    runBrainDumpImpl = runBrainDump,
    runBrainDumpStreamImpl = runBrainDumpStream,
    commitReviewedEntitiesImpl = commitReviewedEntities,
    indexNoteImpl = indexNote,
    requireAuthImpl = requireAuth,
    rateLimitEnv = env,
}: BrainDumpRouteDeps = {}) {
    return new Elysia({ prefix: "/brain-dump" })
    .use(requireAuthImpl)
    .use(background())
    .use(
        rateLimit({
            max: rateLimitEnv.BRAIN_DUMP_RATE_LIMIT_MAX,
            duration: rateLimitEnv.BRAIN_DUMP_RATE_LIMIT_WINDOW_MS,
            errorResponse: new Response(
                JSON.stringify({
                    error: "Rate limit exceeded. Brain dump is limited to 10 requests per minute.",
                    code: "RATE_LIMITED",
                }),
                { status: 429, headers: { "Content-Type": "application/json" } }
            ),
        })
    )
    .post(
        "/",
        async ({ body, backgroundTasks, session }) => {
            const mode = body.mode ?? "auto";
            const userId = session!.user.id;
            const credentials = await resolveAllCodexCredentials(userId);
            const result = await runBrainDumpImpl(body.rawText, mode, { credentials, userId });

            if ("reindexIds" in result) {
                const { reindexIds, ...rest } = result as typeof result & { reindexIds: string[] };
                for (const noteId of reindexIds) {
                    backgroundTasks.addTask(indexNoteImpl, noteId, credentials);
                }
                return rest;
            }

            return result;
        },
        {
            body: t.Object({
                rawText: t.String({
                    minLength: 10,
                    maxLength: 50000,
                    description: "Raw worldbuilding brain dump text to process",
                }),
                mode: t.Optional(t.Union([
                    t.Literal("auto"),
                    t.Literal("review"),
                    t.Literal("inbox"),
                ], { description: "Processing mode: auto writes immediately, review returns proposals, inbox queues without processing" })),
            }),
            detail: {
                summary: "Process a brain dump",
                description:
                    "Accepts raw worldbuilding text, runs it through the RAG + LLM pipeline, and creates/updates lore entries in AllCodex.",
                tags: ["Brain Dump"],
            },
        }
    )
    .post(
        "/stream",
        async ({ body, session, set }) => {
            const userId = session!.user.id;
            const credentials = await resolveAllCodexCredentials(userId);

            set.headers["Content-Type"] = "text/event-stream";
            set.headers["Cache-Control"] = "no-cache";
            set.headers["Connection"] = "keep-alive";

            return new ReadableStream({
                async start(controller) {
                    const encoder = new TextEncoder();
                    const send = (event: string, data: unknown) => {
                        controller.enqueue(encoder.encode(sseEncode(event, data)));
                    };

                    let resultJson = "";
                    try {
                        for await (const chunk of runBrainDumpStreamImpl(body.rawText, {
                            autoRelate: body.autoRelate ?? true,
                            credentials,
                            userId,
                        })) {
                            send(chunk.type, chunk);
                            if (chunk.type === "done") {
                                resultJson = chunk.raw;
                            }
                        }
                    } catch (e) {
                        send("error", { type: "error", error: e instanceof Error ? e.message : String(e) });
                    } finally {
                        controller.close();
                        // Fire-and-forget reindex for created/updated notes
                        if (resultJson) {
                            try {
                                const result = JSON.parse(resultJson);
                                const reindexIds = [
                                    ...(result.created ?? []).map((n: { noteId: string }) => n.noteId),
                                    ...(result.updated ?? []).map((n: { noteId: string }) => n.noteId),
                                ];
                                for (const noteId of reindexIds) {
                                    indexNoteImpl(noteId, credentials).catch(() => {});
                                }
                            } catch {}
                        }
                    }
                },
            });
        },
        {
            body: t.Object({
                rawText: t.String({
                    minLength: 10,
                    maxLength: 50000,
                }),
                autoRelate: t.Optional(t.Boolean({ default: true })),
            }),
            detail: {
                summary: "Process brain dump (streaming)",
                description: "Streaming variant of /brain-dump. Returns SSE events for each pipeline stage: status, token, reasoning, done, error.",
                tags: ["Brain Dump"],
            },
        }
    )
    .post(
        "/commit",
        async ({ body, backgroundTasks, session }) => {
            const userId = session!.user.id;
            const credentials = await resolveAllCodexCredentials(userId);
            const result = await commitReviewedEntitiesImpl(body.rawText, body.approvedEntities, credentials, userId);
            const { reindexIds, ...rest } = result as typeof result & { reindexIds: string[] };
            for (const noteId of (reindexIds ?? [])) {
                backgroundTasks.addTask(indexNoteImpl, noteId, credentials);
            }
            return rest;
        },
        {
            body: t.Object({
                rawText: t.String({ minLength: 1 }),
                approvedEntities: t.Array(t.Object({
                    title: t.String(),
                    type: t.String(),
                    action: t.Union([t.Literal("create"), t.Literal("update")]),
                    content: t.Optional(t.String()),
                    existingNoteId: t.Optional(t.String()),
                })),
            }),
            detail: {
                summary: "Commit reviewed entities",
                description: "Writes pre-approved entities from a review-mode brain dump to AllCodex.",
                tags: ["Brain Dump"],
            },
        }
    )
    .get(
        "/history",
        async ({ query, session }) => {
            const { default: prisma } = await import("../db/client.ts");
            const limit = Math.min(Number(query.limit ?? 20), 100);
            const cursor = query.cursor;

            const history = await prisma.brainDumpHistory.findMany({
                where: { userId: session!.user.id },
                orderBy: { createdAt: "desc" },
                take: limit + 1,
                ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                select: {
                    id: true,
                    rawText: true,
                    notesCreated: true,
                    notesUpdated: true,
                    model: true,
                    tokensUsed: true,
                    createdAt: true,
                },
            });

            const hasMore = history.length > limit;
            const items = hasMore ? history.slice(0, limit) : history;
            const nextCursor = hasMore ? items[items.length - 1].id : null;

            return { items, nextCursor, hasMore };
        },
        {
            query: t.Object({
                cursor: t.Optional(t.String({ description: "ID of the last item from the previous page (omit for first page)" })),
                limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20, description: "Number of items per page (1–100, default 20)" })),
            }),
            detail: {
                summary: "Get brain dump history",
                description: "Returns a paginated list of brain dump operations. Use nextCursor from the response to fetch the next page.",
                tags: ["Brain Dump"],
            },
        }
    )
    .get(
        "/history/:id",
        async ({ params, set, session }) => {
            const { default: prisma } = await import("../db/client.ts");
            const entry = await prisma.brainDumpHistory.findUnique({
                where: { id: params.id },
                select: {
                    id: true,
                    rawText: true,
                    parsedJson: true,
                    notesCreated: true,
                    notesUpdated: true,
                    model: true,
                    tokensUsed: true,
                    createdAt: true,
                    userId: true,
                },
            });
            if (!entry || entry.userId !== session!.user.id) {
                set.status = 404;
                return { error: "Brain dump entry not found", code: "ENTRY_NOT_FOUND" };
            }
            // Extract summary from parsedJson if present
            const parsed = entry.parsedJson as Record<string, unknown> | null;
            const { userId: _uid, ...rest } = entry;
            return {
                ...rest,
                summary: (parsed?.summary as string | null) ?? null,
            };
        },
        {
            params: t.Object({ id: t.String() }),
            detail: {
                summary: "Get a single brain dump entry",
                description: "Returns full details for one brain dump operation including parsedJson entities.",
                tags: ["Brain Dump"],
            },
        }
    );
}

export const brainDumpRoute = createBrainDumpRoute();

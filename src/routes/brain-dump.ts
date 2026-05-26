import Elysia, { t } from "elysia";
import { rateLimit } from "elysia-rate-limit";
import { background } from "elysia-background";
import { runBrainDump, runBrainDumpStream, commitReviewedEntities } from "../pipeline/brain-dump.ts";
import { firePushNotifications } from "../pipeline/push-notify.ts";
import { sseEncode } from "../pipeline/stream-types.ts";
import { indexNote } from "../rag/indexer.ts";
import { getModelChain } from "../pipeline/model-router.ts";
import { env } from "../env.ts";
import { requireAuth } from "../plugins/auth-guard.ts";
import { resolveAllCodexCredentials } from "../integrations/allcodex.ts";
import { getRevisionContent } from "../etapi/client.ts";
import prisma from "../db/client.ts";

type BrainDumpRouteDeps = {
    runBrainDumpImpl?: typeof runBrainDump;
    runBrainDumpStreamImpl?: typeof runBrainDumpStream;
    commitReviewedEntitiesImpl?: typeof commitReviewedEntities;
    indexNoteImpl?: typeof indexNote;
    requireAuthImpl?: typeof requireAuth;
    rateLimitEnv?: Pick<typeof env, "BRAIN_DUMP_RATE_LIMIT_MAX" | "BRAIN_DUMP_RATE_LIMIT_WINDOW_MS">;
    firePushNotificationsImpl?: typeof firePushNotifications;
    getRevisionContentImpl?: typeof getRevisionContent;
};

export function createBrainDumpRoute({
    runBrainDumpImpl = runBrainDump,
    runBrainDumpStreamImpl = runBrainDumpStream,
    commitReviewedEntitiesImpl = commitReviewedEntities,
    indexNoteImpl = indexNote,
    requireAuthImpl = requireAuth,
    rateLimitEnv = env,
    firePushNotificationsImpl = firePushNotifications,
    getRevisionContentImpl = getRevisionContent,
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
        async ({ body, backgroundTasks, session, set }) => {
            const mode = body.mode ?? "auto";
            const userId = session!.user.id;

            if (body.model) {
                const allowed = getModelChain("brain-dump");
                if (!allowed.includes(body.model)) {
                    set.status = 400;
                    return { error: "INVALID_MODEL", message: `Model not in configured chain. Allowed: ${allowed.join(", ")}` };
                }
            }

            const credentials = await resolveAllCodexCredentials(userId);
            const result = await runBrainDumpImpl(body.rawText, mode, { credentials, userId, model: body.model });

            if ("reindexIds" in result) {
                const { reindexIds, ...rest } = result as typeof result & { reindexIds: string[] };
                for (const noteId of reindexIds) {
                    backgroundTasks.addTask(indexNoteImpl, noteId, credentials);
                }
                if (reindexIds.length > 0) {
                    const payload = {
                        title: "Brain Dump Complete",
                        body: `Created ${result.created?.length ?? 0}, updated ${result.updated?.length ?? 0} lore entries.`,
                        href: "/brain-dump",
                    };
                    firePushNotificationsImpl(userId, payload).catch(() => {});
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
                model: t.Optional(t.String({ description: "Override primary model (must be in configured chain)" })),
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

            if (body.model) {
                const allowed = getModelChain("brain-dump");
                if (!allowed.includes(body.model)) {
                    set.status = 400;
                    return { error: "INVALID_MODEL", message: `Model not in configured chain. Allowed: ${allowed.join(", ")}` };
                }
            }

            const credentials = await resolveAllCodexCredentials(userId);

            set.headers["Content-Type"] = "text/event-stream";
            set.headers["Cache-Control"] = "no-cache";
            set.headers["Connection"] = "keep-alive";

            return new ReadableStream({
                async start(controller) {
                    const encoder = new TextEncoder();
                    const heartbeat = setInterval(() => {
                        try {
                            controller.enqueue(encoder.encode(": keepalive\n\n"));
                        } catch {
                            clearInterval(heartbeat);
                        }
                    }, 10_000);
                    const send = (event: string, data: unknown) => {
                        controller.enqueue(encoder.encode(sseEncode(event, data)));
                    };

                    let resultJson = "";
                    try {
                        for await (const chunk of runBrainDumpStreamImpl(body.rawText, {
                            autoRelate: body.autoRelate ?? true,
                            credentials,
                            userId,
                            model: body.model,
                        })) {
                            send(chunk.type, chunk);
                            if (chunk.type === "done") {
                                resultJson = chunk.raw;
                            }
                        }
                    } catch (e) {
                        const errMsg = e instanceof Error ? e.message : String(e);
                        send("error", { type: "error", error: errMsg });
                        firePushNotificationsImpl(userId, {
                            title: "Brain Dump Failed",
                            body: errMsg,
                            href: "/brain-dump",
                        }).catch(() => {});
                    } finally {
                        clearInterval(heartbeat);
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
                                const payload = {
                                    title: "Brain Dump Complete",
                                    body: `Created ${result.created?.length ?? 0}, updated ${result.updated?.length ?? 0} lore entries.`,
                                    href: "/brain-dump",
                                };
                                firePushNotificationsImpl(userId, payload).catch(() => {});
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
                model: t.Optional(t.String({ description: "Override primary model (must be in configured chain)" })),
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
    )

    // ── Batch (bulk queue) routes ────────────────────────────────────

    .post("/batch", async ({ session, body }) => {
        const userId = session!.user.id;
        const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const jobs = await prisma.brainDumpJob.createManyAndReturn({
            data: body.items.map((item: { rawText: string; parentNoteId?: string; mode?: string }, idx: number) => ({
                userId,
                batchId,
                rawText: item.rawText,
                parentNoteId: item.parentNoteId ?? null,
                mode: item.mode ?? "auto",
                status: "queued",
                position: idx,
            })),
            select: { id: true, position: true },
        });
        return { batchId, jobs };
    }, {
        body: t.Object({
            items: t.Array(t.Object({
                rawText: t.String({ minLength: 1 }),
                parentNoteId: t.Optional(t.String()),
                mode: t.Optional(t.Union([t.Literal("auto"), t.Literal("review")])),
            }), { minItems: 1, maxItems: 50 }),
        }),
        detail: { summary: "Submit a batch of brain dumps", tags: ["Brain Dump"] },
    })

    .get("/batch/:batchId", async ({ session, params, set }) => {
        const userId = session!.user.id;
        const jobs = await prisma.brainDumpJob.findMany({
            where: { batchId: params.batchId, userId },
            orderBy: { position: "asc" },
        });
        if (jobs.length === 0) {
            set.status = 404;
            return { error: "BATCH_NOT_FOUND" };
        }
        const counts = jobs.reduce((acc, j) => {
            acc[j.status] = (acc[j.status] ?? 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        const terminal = (counts.queued ?? 0) === 0 && (counts.running ?? 0) === 0;
        return { batchId: params.batchId, jobs, counts, terminal };
    }, {
        params: t.Object({ batchId: t.String() }),
        detail: { summary: "Get batch status", tags: ["Brain Dump"] },
    })

    .delete("/batch/:batchId", async ({ session, params }) => {
        const userId = session!.user.id;
        const result = await prisma.brainDumpJob.updateMany({
            where: { batchId: params.batchId, userId, status: "queued" },
            data: { status: "cancelled", finishedAt: new Date() },
        });
        return { cancelled: result.count };
    }, {
        params: t.Object({ batchId: t.String() }),
        detail: { summary: "Cancel queued jobs in a batch", tags: ["Brain Dump"] },
    })

    // ── Diff / revision attribution ─────────────────────────────────

    .get("/history/:id/diffs", async ({ params, set, session }) => {
        const entry = await prisma.brainDumpHistory.findUnique({
            where: { id: params.id },
            select: { id: true, userId: true },
        });
        if (!entry || entry.userId !== session!.user.id) {
            set.status = 404;
            return { error: "Brain dump entry not found", code: "ENTRY_NOT_FOUND" };
        }

        const links = await prisma.brainDumpRevisionLink.findMany({
            where: { brainDumpHistoryId: params.id },
            orderBy: { createdAt: "asc" },
        });
        if (links.length === 0) return { diffs: [] };

        const credentials = await resolveAllCodexCredentials(session!.user.id);
        const diffs = await Promise.all(links.map(async (link) => {
            let contentBefore: string | null = null;
            let contentAfter: string | null = null;
            if (link.revisionIdBefore) {
                try { contentBefore = await getRevisionContentImpl(link.revisionIdBefore, credentials); }
                catch { contentBefore = null; }
            }
            if (link.revisionIdAfter) {
                try { contentAfter = await getRevisionContentImpl(link.revisionIdAfter, credentials); }
                catch { contentAfter = null; }
            }
            return {
                noteId: link.noteId,
                action: link.action,
                revisionIdBefore: link.revisionIdBefore,
                revisionIdAfter: link.revisionIdAfter,
                contentBefore,
                contentAfter,
            };
        }));
        return { diffs };
    }, {
        params: t.Object({ id: t.String() }),
        detail: { summary: "Get content diffs for a brain dump", tags: ["Brain Dump"] },
    });
}

export const brainDumpRoute = createBrainDumpRoute();

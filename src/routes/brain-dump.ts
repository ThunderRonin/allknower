import Elysia, { t } from "elysia";
import { rateLimit } from "elysia-rate-limit";
import { background } from "elysia-background";
import { runBrainDump, commitReviewedEntities } from "../pipeline/brain-dump.ts";
import { indexNote } from "../rag/indexer.ts";
import { env } from "../env.ts";
import { requireAuth } from "../plugins/auth-guard.ts";

type BrainDumpRouteDeps = {
    runBrainDumpImpl?: typeof runBrainDump;
    commitReviewedEntitiesImpl?: typeof commitReviewedEntities;
    indexNoteImpl?: typeof indexNote;
    requireAuthImpl?: typeof requireAuth;
    rateLimitEnv?: Pick<typeof env, "BRAIN_DUMP_RATE_LIMIT_MAX" | "BRAIN_DUMP_RATE_LIMIT_WINDOW_MS">;
};

export function createBrainDumpRoute({
    runBrainDumpImpl = runBrainDump,
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
        async ({ body, backgroundTasks }) => {
            const mode = body.mode ?? "auto";
            const result = await runBrainDumpImpl(body.rawText, mode);

            if ("reindexIds" in result) {
                const { reindexIds, ...rest } = result as typeof result & { reindexIds: string[] };
                for (const noteId of reindexIds) {
                    backgroundTasks.addTask(indexNoteImpl, noteId);
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
        "/commit",
        async ({ body, backgroundTasks }) => {
            const result = await commitReviewedEntitiesImpl(body.rawText, body.approvedEntities);
            const { reindexIds, ...rest } = result as typeof result & { reindexIds: string[] };
            for (const noteId of (reindexIds ?? [])) {
                backgroundTasks.addTask(indexNoteImpl, noteId);
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
        async ({ query }) => {
            const { default: prisma } = await import("../db/client.ts");
            const limit = Math.min(Number(query.limit ?? 20), 100);
            const cursor = query.cursor;

            const history = await prisma.brainDumpHistory.findMany({
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
        async ({ params, set }) => {
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
                },
            });
            if (!entry) {
                set.status = 404;
                return { error: "Brain dump entry not found", code: "ENTRY_NOT_FOUND" };
            }
            // Extract summary from parsedJson if present
            const parsed = entry.parsedJson as Record<string, unknown> | null;
            return {
                ...entry,
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

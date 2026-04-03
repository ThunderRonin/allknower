import Elysia, { t } from "elysia";
import { queryLore } from "../rag/lancedb.ts";
import { indexNote, fullReindex, reindexStaleNotes } from "../rag/indexer.ts";
import prisma from "../db/client.ts";
import { requireAuth } from "../plugins/auth-guard.ts";

export const ragRoute = new Elysia({ prefix: "/rag" })
    .use(requireAuth)
    .post(
        "/query",
        async ({ body }) => {
            const chunks = await queryLore(body.text, body.topK ?? 10);
            return { results: chunks };
        },
        {
            body: t.Object({
                text: t.String({ minLength: 1, description: "Text to find semantically similar lore for" }),
                topK: t.Optional(t.Number({ minimum: 1, maximum: 50, default: 10, description: "Number of results (1–50)" })),
            }),
            detail: {
                summary: "Query the RAG index",
                description: "Returns the top-k most semantically similar lore chunks for the given text.",
                tags: ["RAG"],
            },
        }
    )
    .post(
        "/reindex/:noteId",
        async ({ params }) => {
            try {
                await indexNote(params.noteId);
                return { ok: true, noteId: params.noteId };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const missingNote = /missing note|not found|\b404\b/i.test(message);

                return new Response(
                    JSON.stringify({
                        error: missingNote ? "NOTE_NOT_FOUND" : "REINDEX_FAILED",
                        message,
                        noteId: params.noteId,
                    }),
                    {
                        status: missingNote ? 404 : 500,
                        headers: { "Content-Type": "application/json" },
                    }
                );
            }
        },
        {
            params: t.Object({ noteId: t.String({ description: "AllCodex note ID to reindex" }) }),
            detail: {
                summary: "Reindex a single note",
                description: "Fetches the note from AllCodex and updates its embedding in LanceDB.",
                tags: ["RAG"],
            },
        }
    )
    .post(
        "/reindex",
        async () => {
            const result = await fullReindex();
            return result;
        },
        {
            detail: {
                summary: "Full RAG reindex",
                description: "Reindexes all lore notes from AllCodex. Slow — use sparingly.",
                tags: ["RAG"],
            },
        }
    )
    .post(
        "/reindex-stale",
        async () => {
            const result = await reindexStaleNotes();
            return result;
        },
        {
            detail: {
                summary: "Reindex stale notes",
                description:
                    "Compares each lore note's utcDateModified against its last embeddedAt timestamp. Only reindexes notes that have changed since the last embedding — safe to run on a schedule.",
                tags: ["RAG"],
            },
        }
    )
    .get(
        "/status",
        async () => {
            const count = await prisma.ragIndexMeta.count();
            const latest = await prisma.ragIndexMeta.findFirst({
                orderBy: { embeddedAt: "desc" },
                select: { embeddedAt: true, model: true },
            });
            return { indexedNotes: count, lastIndexed: latest?.embeddedAt, model: latest?.model };
        },
        {
            detail: {
                summary: "RAG index status",
                description: "Returns the number of indexed notes and last index time.",
                tags: ["RAG"],
            },
        }
    );

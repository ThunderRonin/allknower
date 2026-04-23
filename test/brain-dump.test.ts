import { mock } from "bun:test";

// Mock transitive deps loaded by src/routes/brain-dump.ts → pipeline/brain-dump.ts
// before any import triggers the module graph.  Without these mocks, Bun caches
// the real modules, which then bleed into later test files (e.g. relations.test.ts).
mock.module("../src/rag/lancedb.ts", () => ({
    queryLore: mock(async () => []),
    upsertNoteChunks: mock(async () => {}),
    chunkText: mock(() => []),
    deleteNoteChunks: mock(async () => {}),
    checkLanceDbHealth: mock(async () => ({ ok: true })),
}));

mock.module("../src/pipeline/prompt.ts", () => ({
    buildBrainDumpPrompt: mock(() => ({ system: "sys", context: "ctx", user: "usr" })),
    callLLM: mock(async () => ({ raw: "{}", tokensUsed: 0, model: "test", latencyMs: 0 })),
}));

mock.module("../src/etapi/client.ts", () => ({
    getAllCodexNotes: mock(async () => []),
    getNoteContent: mock(async () => ""),
    createNote: mock(async () => ({ note: { noteId: "n" }, branch: {} })),
    setNoteContent: mock(async () => {}),
    updateNote: mock(async (id: string) => ({ noteId: id })),
    tagNote: mock(async () => {}),
    setNoteTemplate: mock(async () => {}),
    createAttribute: mock(async () => {}),
    createRelation: mock(async () => {}),
    checkAllCodexHealth: mock(async () => ({ ok: true })),
    invalidateCredentialCache: mock(() => {}),
    probeAllCodex: mock(async () => ({ ok: true })),
}));

mock.module("../src/db/client.ts", () => ({
    default: {
        appConfig: { findUnique: mock(async () => null) },
        brainDumpHistory: {
            create: mock(async () => ({ id: "h1" })),
            findUnique: mock(async () => null),
        },
        ragIndexMeta: {
            upsert: mock(async () => ({})),
            findMany: mock(async () => []),
        },
        relationHistory: {
            create: mock(async () => ({})),
        },
    },
}));

mock.module("../src/rag/indexer.ts", () => ({
    indexNote: mock(async () => {}),
    fullReindex: mock(async () => ({ indexed: 0, failed: 0 })),
    reindexStaleNotes: mock(async () => ({ reindexed: 0, failed: 0, upToDate: 0 })),
}));

import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { requireAuthBypass } from "./helpers/auth.ts";
import { requestJson } from "./helpers/http.ts";
import { createBrainDumpRoute } from "../src/routes/brain-dump.ts";

const app = new Elysia().use(createBrainDumpRoute({
    requireAuthImpl: requireAuthBypass,
    rateLimitEnv: {
        BRAIN_DUMP_RATE_LIMIT_MAX: 10,
        BRAIN_DUMP_RATE_LIMIT_WINDOW_MS: 60000,
    },
    runBrainDumpImpl: async (rawText: string, mode: "auto" | "review" | "inbox" = "auto") => ({
        mode,
        summary: `Processed ${rawText.length} chars`,
        created: [{ noteId: "note-1", title: "Archivist", type: "character" as const }],
        updated: [],
        skipped: [],
        reindexIds: ["note-1"],
    }),
    commitReviewedEntitiesImpl: async () => ({
        summary: "Committed entities",
        created: [],
        updated: [],
        skipped: [],
        reindexIds: [],
    }),
    indexNoteImpl: async () => {},
}));

describe("Brain dump routes", () => {
    it("POST /brain-dump accepts valid input and returns a result", async () => {
        const { status, json } = await requestJson(app, "/brain-dump/", {
            method: "POST",
            json: {
                rawText: "The archivist buried a fragment beneath the obsidian gate.",
                mode: "review",
            },
        });

        const body = json as { summary: string; created: unknown[] };
        expect(status).toBe(200);
        expect(body.summary).toContain("Processed");
        expect(Array.isArray(body.created)).toBe(true);
    });

    it("POST /brain-dump rejects too-short raw text", async () => {
        const { status } = await requestJson(app, "/brain-dump/", {
            method: "POST",
            json: { rawText: "too short" },
        });

        expect(status).toBe(422);
    });

    it("POST /brain-dump rejects unsupported modes", async () => {
        const { status } = await requestJson(app, "/brain-dump/", {
            method: "POST",
            json: {
                rawText: "The archivist buried a fragment beneath the obsidian gate.",
                mode: "invalid-mode",
            },
        });

        expect(status).toBe(422);
    });

    it("rate limit error response contains a code field", async () => {
        const limited = new Elysia().use(createBrainDumpRoute({
            requireAuthImpl: requireAuthBypass,
            rateLimitEnv: {
                BRAIN_DUMP_RATE_LIMIT_MAX: 0,
                BRAIN_DUMP_RATE_LIMIT_WINDOW_MS: 60000,
            },
            runBrainDumpImpl: async () => ({ mode: "auto" as const, summary: "", created: [] as never[], updated: [] as never[], skipped: [] as never[], reindexIds: [] as string[] }),
            commitReviewedEntitiesImpl: async () => ({ summary: "", created: [] as never[], updated: [] as never[], skipped: [] as never[], reindexIds: [] as string[] }),
            indexNoteImpl: async () => {},
        }));

        const res = await limited.handle(
            new Request("http://localhost/brain-dump/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rawText: "The archivist buried a fragment beneath the obsidian gate." }),
            })
        );

        expect(res.status).toBe(429);
        const body = await res.json();
        expect(body).toHaveProperty("code");
        expect(body.code).toBe("RATE_LIMITED");
    });

    it("history/:id returns 404 with code NOT_FOUND for unknown id", async () => {
        const app = new Elysia().use(createBrainDumpRoute({
            requireAuthImpl: requireAuthBypass,
            rateLimitEnv: { BRAIN_DUMP_RATE_LIMIT_MAX: 10, BRAIN_DUMP_RATE_LIMIT_WINDOW_MS: 60000 },
            runBrainDumpImpl: async () => ({ mode: "auto" as const, summary: "", created: [] as never[], updated: [] as never[], skipped: [] as never[], reindexIds: [] as string[] }),
            commitReviewedEntitiesImpl: async () => ({ summary: "", created: [] as never[], updated: [] as never[], skipped: [] as never[], reindexIds: [] as string[] }),
            indexNoteImpl: async () => {},
        }));

        const res = await app.handle(
            new Request("http://localhost/brain-dump/history/does-not-exist-at-all-xyz")
        );

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body).toHaveProperty("code");
        expect(body.code).toBe("ENTRY_NOT_FOUND");
    });
});
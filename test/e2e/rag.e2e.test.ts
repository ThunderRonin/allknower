import "../helpers/e2e-mock-setup.ts";
import { describe, expect, it, afterAll, beforeAll } from "bun:test";
import { cleanupLanceDb } from "../helpers/e2e-harness.ts";
import { requestJson, type RouteApp } from "../helpers/http.ts";

let app: RouteApp;

beforeAll(async () => {
    // Dynamic import so that mock.module() calls from e2e-mock-setup.ts
    // (including the auth-guard bypass) are applied before the module graph loads.
    const mod = await import("../../src/app.ts");
    app = mod.app;

    // Clean up any leftover ragIndexMeta from prior test runs to avoid flakes
    const { default: prisma } = await import("../../src/db/client.ts");
    await prisma.ragIndexMeta.deleteMany({});
});

afterAll(async () => {
    await cleanupLanceDb();
});

// ── Query (empty index — no notes indexed yet) ──────────────────────────────

describe("E2E: POST /rag/query", () => {
    it("returns array of results", async () => {
        const { status, json } = await requestJson(app, "/rag/query", {
            method: "POST",
            json: { text: "Aldric king", topK: 5 },
        });
        expect(status).toBe(200);
        const body = json as { results: unknown[] };
        expect(Array.isArray(body.results)).toBe(true);
    }, 15_000);

    it("respects topK parameter", async () => {
        const { status, json } = await requestJson(app, "/rag/query", {
            method: "POST",
            json: { text: "test", topK: 1 },
        });
        expect(status).toBe(200);
        const body = json as { results: unknown[] };
        expect(body.results.length).toBeLessThanOrEqual(1);
    }, 15_000);

    it("rejects missing text field with 422", async () => {
        const { status } = await requestJson(app, "/rag/query", {
            method: "POST",
            json: { topK: 5 },
        });
        expect(status).toBe(422);
    });

    it("rejects empty text with 422", async () => {
        const { status } = await requestJson(app, "/rag/query", {
            method: "POST",
            json: { text: "", topK: 5 },
        });
        expect(status).toBe(422);
    });
});

// ── Reindex single note ─────────────────────────────────────────────────────

describe("E2E: POST /rag/reindex/:noteId", () => {
    it("triggers reindex for a specific note and returns ok", async () => {
        const { status, json } = await requestJson(app, "/rag/reindex/note-1", {
            method: "POST",
        });
        expect(status).toBe(200);
        const body = json as { ok: boolean; noteId: string };
        expect(body.ok).toBe(true);
        expect(body.noteId).toBe("note-1");
    }, 30_000);
});

// ── Full reindex ────────────────────────────────────────────────────────────

describe("E2E: POST /rag/reindex", () => {
    it("triggers full reindex and returns indexed/failed counts", async () => {
        const { status, json } = await requestJson(app, "/rag/reindex", {
            method: "POST",
        });
        expect(status).toBe(200);
        const body = json as { indexed: number; failed: number };
        expect(typeof body.indexed).toBe("number");
        expect(typeof body.failed).toBe("number");
        expect(body.indexed).toBeGreaterThanOrEqual(0);
    }, 30_000);
});

// ── Reindex stale ───────────────────────────────────────────────────────────

describe("E2E: POST /rag/reindex-stale", () => {
    it("reindexes stale notes and returns reindexed/failed/upToDate counts", async () => {
        const { status, json } = await requestJson(app, "/rag/reindex-stale", {
            method: "POST",
        });
        expect(status).toBe(200);
        const body = json as { reindexed: number; failed: number; upToDate: number };
        expect(typeof body.reindexed).toBe("number");
        expect(typeof body.failed).toBe("number");
        expect(typeof body.upToDate).toBe("number");
    }, 30_000);
});

// ── Status (should reflect indexed notes from earlier reindex calls) ────────

describe("E2E: GET /rag/status", () => {
    it("returns index stats with indexedNotes count", async () => {
        const { status, json } = await requestJson(app, "/rag/status");
        expect(status).toBe(200);
        const body = json as { indexedNotes: number; lastIndexed: string | null; model: string | null };
        expect(typeof body.indexedNotes).toBe("number");
        // After prior reindex calls, at least 1 note should be indexed
        expect(body.indexedNotes).toBeGreaterThanOrEqual(1);
        expect(body.lastIndexed).toBeDefined();
        expect(body.model).toBeDefined();
    });
});

// ── Query after indexing (now the index has data) ───────────────────────────

describe("E2E: POST /rag/query (after indexing)", () => {
    it("returns results with correct shape after notes are indexed", async () => {
        const { status, json } = await requestJson(app, "/rag/query", {
            method: "POST",
            json: { text: "Aldric king of Valorheim", topK: 5 },
        });
        expect(status).toBe(200);
        const body = json as { results: Array<{ noteId: string; noteTitle: string; content: string; score: number }> };
        expect(Array.isArray(body.results)).toBe(true);
        // With random 4-dim embeddings the similarity threshold (0.3) may or may not
        // be hit — validate shape if any results are returned
        for (const chunk of body.results) {
            expect(typeof chunk.noteId).toBe("string");
            expect(typeof chunk.noteTitle).toBe("string");
            expect(typeof chunk.content).toBe("string");
            expect(typeof chunk.score).toBe("number");
        }
    }, 15_000);
});

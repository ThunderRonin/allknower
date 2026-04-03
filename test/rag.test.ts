import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import { requireAuthBypass } from "./helpers/auth.ts";
import { requestJson } from "./helpers/http.ts";

let lastTopK = 0;
let throwOnMissingReindex = false;

mock.module("../src/plugins/auth-guard.ts", () => ({
    requireAuth: requireAuthBypass
}));

mock.module("../src/rag/lancedb.ts", () => ({
    checkLanceDbHealth: mock(async () => ({ ok: true })),
    queryLore: mock(async (text: string, topK: number) => {
        lastTopK = topK;
        return [
            { noteId: "note-1", noteTitle: `Result for ${text}`, content: "Lore chunk", distance: 0.01 },
        ];
    })
}));

mock.module("../src/rag/indexer.ts", () => ({
    indexNote: mock(async (noteId: string) => {
        if (throwOnMissingReindex && noteId === "missing-note") {
            throw new Error("missing note");
        }
    }),
    fullReindex: mock(async () => ({ indexed: 12, skipped: 0 })),
    reindexStaleNotes: mock(async () => ({ indexed: 0, skipped: 3 })),
}));

mock.module("../src/db/client.ts", () => ({
    default: {
        ragIndexMeta: {
            count: mock(async () => 7),
            findFirst: mock(async () => ({ embeddedAt: "2026-04-02T00:00:00.000Z", model: "embed-test" })),
        },
    }
}));

const { ragRoute } = await import("../src/routes/rag.ts");

const app = new Elysia().use(ragRoute);

describe("RAG routes", () => {
    beforeEach(() => {
        lastTopK = 0;
        throwOnMissingReindex = false;
    });

    it("POST /rag/query returns semantic results and uses topK=10 by default", async () => {
        const { status, json } = await requestJson(app, "/rag/query", {
            method: "POST",
            json: { text: "vault city" },
        });

        const body = json as { results: Array<{ noteId: string }> };
        expect(status).toBe(200);
        expect(Array.isArray(body.results)).toBe(true);
        expect(body.results[0].noteId).toBe("note-1");
        expect(lastTopK).toBe(10);
    });

    it("POST /rag/query rejects empty text", async () => {
        const { status } = await requestJson(app, "/rag/query", {
            method: "POST",
            json: { text: "" },
        });

        expect(status).toBe(422);
    });

    it("POST /rag/query rejects topK values above 50", async () => {
        const { status } = await requestJson(app, "/rag/query", {
            method: "POST",
            json: { text: "vault city", topK: 51 },
        });

        expect(status).toBe(422);
    });

    it("GET /rag/status returns index metadata", async () => {
        const { status, json } = await requestJson(app, "/rag/status");
        const body = json as { indexedNotes: number; lastIndexed: string; model: string };

        expect(status).toBe(200);
        expect(typeof body.indexedNotes).toBe("number");
        expect(body.lastIndexed).toBe("2026-04-02T00:00:00.000Z");
        expect(body.model).toBe("embed-test");
    });

    it("POST /rag/reindex-stale completes without crashing", async () => {
        const { status, json } = await requestJson(app, "/rag/reindex-stale", {
            method: "POST",
        });

        expect(status).toBe(200);
        expect(json).toEqual({ indexed: 0, skipped: 3 });
    });

    it("POST /rag/reindex/:noteId should fail gracefully for a missing note", async () => {
        throwOnMissingReindex = true;

        const { status } = await requestJson(app, "/rag/reindex/missing-note", {
            method: "POST",
        });

        expect(status).toBeLessThan(500);
    });
});
import { describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import { requireAuthBypass } from "./helpers/auth.ts";
import { requestJson } from "./helpers/http.ts";

mock.module("../src/plugins/auth-guard.ts", () => ({
    requireAuth: requireAuthBypass
}));

mock.module("../src/env.ts", () => ({
    env: {
        BRAIN_DUMP_RATE_LIMIT_MAX: 10,
        BRAIN_DUMP_RATE_LIMIT_WINDOW_MS: 60000,
    }
}));

mock.module("../src/pipeline/brain-dump.ts", () => ({
    runBrainDump: mock(async (rawText: string, mode: string) => ({
        mode,
        summary: `Processed ${rawText.length} chars`,
        created: [{ noteId: "note-1", title: "Archivist", type: "character", action: "created" }],
        updated: [],
        skipped: [],
        reindexIds: ["note-1"],
    })),
    commitReviewedEntities: mock(async () => ({
        summary: "Committed entities",
        created: [],
        updated: [],
        skipped: [],
        reindexIds: [],
    })),
}));

mock.module("../src/rag/indexer.ts", () => ({
    indexNote: async () => {}
}));

mock.module("../src/db/client.ts", () => ({
    default: {
        brainDumpHistory: {
            findMany: mock(async () => []),
            findUnique: mock(async () => null),
        },
    }
}));

const { brainDumpRoute } = await import("../src/routes/brain-dump.ts");

const app = new Elysia().use(brainDumpRoute);

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
});
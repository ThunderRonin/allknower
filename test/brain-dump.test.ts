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
});
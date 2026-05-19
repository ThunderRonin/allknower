import "../helpers/e2e-mock-setup.ts";
import { describe, expect, it, afterAll, beforeAll } from "bun:test";
import { createBrainDumpRoute } from "../../src/routes/brain-dump.ts";
import { requireAuthBypass } from "../helpers/auth.ts";
import { cleanupLanceDb } from "../helpers/e2e-harness.ts";
import { requestJson } from "../helpers/http.ts";
import { Elysia } from "elysia";
import brainDumpFixture from "../fixtures/brain-dump-single-entity.json";
import reviewFixture from "../fixtures/brain-dump-review-mode.json";

const brainDumpApp = new Elysia().use(
    createBrainDumpRoute({
        requireAuthImpl: requireAuthBypass,
        rateLimitEnv: {
            BRAIN_DUMP_RATE_LIMIT_MAX: 1000,
            BRAIN_DUMP_RATE_LIMIT_WINDOW_MS: 60_000,
        },
    })
);

beforeAll(async () => {
    // Clean up any leftover history from prior test runs to avoid flakes
    const { default: prisma } = await import("../../src/db/client.ts");
    await prisma.brainDumpHistory.deleteMany({ where: { userId: "test-user" } });
});

afterAll(async () => {
    await cleanupLanceDb();
});

describe("E2E: POST /brain-dump", () => {
    it("processes single-entity brain dump and returns created entities + summary", async () => {
        const { status, json } = await requestJson(brainDumpApp, "/brain-dump", {
            method: "POST",
            json: brainDumpFixture,
        });
        expect(status).toBe(200);
        const body = json as Record<string, unknown>;
        expect(body.summary).toBeDefined();
        expect(typeof body.summary).toBe("string");
        expect(Array.isArray(body.created)).toBe(true);
        expect(Array.isArray(body.updated)).toBe(true);
        expect(Array.isArray(body.skipped)).toBe(true);
    }, 30_000);

    it("returns review-mode result with proposed entities", async () => {
        const { status, json } = await requestJson(brainDumpApp, "/brain-dump", {
            method: "POST",
            json: reviewFixture,
        });
        expect(status).toBe(200);
        const body = json as Record<string, unknown>;
        expect(body.mode).toBe("review");
        expect(body.summary).toBeDefined();
        expect(Array.isArray(body.proposedEntities)).toBe(true);
    }, 30_000);

    it("rejects empty rawText with 422", async () => {
        const { status } = await requestJson(brainDumpApp, "/brain-dump", {
            method: "POST",
            json: { rawText: "", mode: "auto" },
        });
        expect(status).toBeGreaterThanOrEqual(400);
    });

    it("rejects rawText shorter than minLength", async () => {
        const { status } = await requestJson(brainDumpApp, "/brain-dump", {
            method: "POST",
            json: { rawText: "short", mode: "auto" },
        });
        expect(status).toBeGreaterThanOrEqual(400);
    });
});

describe("E2E: GET /brain-dump/history", () => {
    it("returns paginated history from real DB", async () => {
        // Ensure at least one entry exists (the first POST above should have created one)
        const { status, json } = await requestJson(brainDumpApp, "/brain-dump/history");
        expect(status).toBe(200);
        const body = json as Record<string, unknown>;
        expect(Array.isArray(body.items)).toBe(true);
        expect("hasMore" in body).toBe(true);
        expect("nextCursor" in body).toBe(true);
        // Should have at least the entry from the auto-mode POST
        const items = body.items as unknown[];
        expect(items.length).toBeGreaterThanOrEqual(1);
    }, 30_000);

    it("respects limit query parameter", async () => {
        const { status, json } = await requestJson(brainDumpApp, "/brain-dump/history?limit=1");
        expect(status).toBe(200);
        const body = json as { items: unknown[] };
        expect(body.items.length).toBeLessThanOrEqual(1);
    });
});

describe("E2E: GET /brain-dump/history/:id", () => {
    it("returns full entry by ID from real DB", async () => {
        const { json: historyJson } = await requestJson(brainDumpApp, "/brain-dump/history");
        const items = (historyJson as any).items;
        expect(items.length).toBeGreaterThan(0);

        const entryId = items[0].id;
        const { status, json } = await requestJson(brainDumpApp, `/brain-dump/history/${entryId}`);
        expect(status).toBe(200);
        const entry = json as Record<string, unknown>;
        expect(entry.id).toBe(entryId);
        expect(entry.parsedJson).toBeDefined();
        expect(entry.rawText).toBeDefined();
        expect(entry.notesCreated).toBeDefined();
        expect(entry.notesUpdated).toBeDefined();
        expect(entry.model).toBeDefined();
        expect("summary" in entry).toBe(true);
    }, 30_000);

    it("returns 404 for nonexistent ID", async () => {
        const { status } = await requestJson(brainDumpApp, "/brain-dump/history/nonexistent-id-00000");
        expect(status).toBe(404);
    });
});

describe("E2E: POST /brain-dump/commit", () => {
    it("commits reviewed entities to AllCodex", async () => {
        const { status, json } = await requestJson(brainDumpApp, "/brain-dump/commit", {
            method: "POST",
            json: {
                approvedEntities: [
                    {
                        title: "Aldric",
                        type: "character",
                        content: "<p>Aldric is the king.</p>",
                        action: "create",
                    },
                ],
                rawText: "Aldric is the king of a vast kingdom.",
            },
        });
        expect(status).toBe(200);
        const body = json as Record<string, unknown>;
        expect(body.summary).toBeDefined();
        expect(Array.isArray(body.created)).toBe(true);
        expect(Array.isArray(body.updated)).toBe(true);
        expect(Array.isArray(body.skipped)).toBe(true);
    }, 30_000);
});

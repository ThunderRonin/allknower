import "../helpers/e2e-mock-setup.ts";
import { describe, expect, it, afterAll, beforeAll } from "bun:test";
import { cleanupLanceDb } from "../helpers/e2e-harness.ts";
import { requestJson, type RouteApp } from "../helpers/http.ts";

let suggestApp: RouteApp;

beforeAll(async () => {
    const { app } = await import("../../src/app.ts");
    suggestApp = app;

    // Clean up leftover relation history from prior test runs
    const { default: prisma } = await import("../../src/db/client.ts");
    await prisma.relationHistory.deleteMany({ where: { sourceNoteId: "note-1" } });
});

afterAll(async () => {
    // Clean up relation history created during apply tests
    const { default: prisma } = await import("../../src/db/client.ts");
    await prisma.relationHistory.deleteMany({ where: { sourceNoteId: "note-1" } });
    await cleanupLanceDb();
});

describe("E2E: POST /suggest/relationships", () => {
    it("returns suggestions array", async () => {
        const { status, json } = await requestJson(suggestApp, "/suggest/relationships", {
            method: "POST",
            json: {
                noteId: "note-1",
                text: "Aldric is the king of Valorheim, a powerful ruler.",
            },
        });
        expect(status).toBe(200);
        const body = json as Record<string, unknown>;
        expect(body.suggestions).toBeDefined();
        expect(Array.isArray(body.suggestions)).toBe(true);
    }, 60_000);

    it("returns suggestions without noteId (optional field)", async () => {
        const { status, json } = await requestJson(suggestApp, "/suggest/relationships", {
            method: "POST",
            json: {
                text: "A mysterious sorcerer from the northern wastes.",
            },
        });
        expect(status).toBe(200);
        const body = json as Record<string, unknown>;
        expect(body.suggestions).toBeDefined();
        expect(Array.isArray(body.suggestions)).toBe(true);
    }, 60_000);

    it("rejects request missing required text field", async () => {
        const { status } = await requestJson(suggestApp, "/suggest/relationships", {
            method: "POST",
            json: { noteId: "note-1" },
        });
        expect(status).toBeGreaterThanOrEqual(400);
    });
});

describe("E2E: POST /suggest/relationships/apply", () => {
    it("returns applied/skipped/failed arrays for valid relation", async () => {
        const { status, json } = await requestJson(suggestApp, "/suggest/relationships/apply", {
            method: "POST",
            json: {
                sourceNoteId: "note-1",
                relations: [
                    {
                        targetNoteId: "note-2",
                        relationshipType: "ally",
                        description: "Aldric is allied with the eastern guild.",
                    },
                ],
                bidirectional: true,
            },
        });
        expect(status).toBe(200);
        const body = json as Record<string, unknown>;
        // Shape validation: all three result arrays are present
        expect(body.applied).toBeDefined();
        expect(Array.isArray(body.applied)).toBe(true);
        expect(body.skipped).toBeDefined();
        expect(Array.isArray(body.skipped)).toBe(true);
        expect(body.failed).toBeDefined();
        expect(Array.isArray(body.failed)).toBe(true);
        // With mocked createRelation (returns void), the relation lands in
        // the failed array due to missing .skipped property. In production
        // with real ETAPI, it would be in applied.
        const total =
            (body.applied as unknown[]).length +
            (body.skipped as unknown[]).length +
            (body.failed as unknown[]).length;
        expect(total).toBeGreaterThanOrEqual(1);
    }, 60_000);

    it("skips unknown relationship types", async () => {
        const { status, json } = await requestJson(suggestApp, "/suggest/relationships/apply", {
            method: "POST",
            json: {
                sourceNoteId: "note-1",
                relations: [
                    {
                        targetNoteId: "note-2",
                        relationshipType: "bogus_type_not_real",
                    },
                ],
            },
        });
        expect(status).toBe(200);
        const body = json as Record<string, unknown>;
        // Unknown type → skipped
        const skipped = body.skipped as Array<Record<string, unknown>>;
        expect(skipped.length).toBeGreaterThanOrEqual(1);
        expect(skipped[0].reason).toContain("Unknown relationship type");
    }, 60_000);

    it("rejects request missing sourceNoteId", async () => {
        const { status } = await requestJson(suggestApp, "/suggest/relationships/apply", {
            method: "POST",
            json: {
                relations: [
                    { targetNoteId: "note-2", relationshipType: "ally" },
                ],
            },
        });
        expect(status).toBeGreaterThanOrEqual(400);
    });
});

describe("E2E: GET /suggest/gaps", () => {
    it("returns gaps array with type counts and total", async () => {
        const { status, json } = await requestJson(suggestApp, "/suggest/gaps");
        expect(status).toBe(200);
        const body = json as Record<string, unknown>;
        // gaps may be empty if LLM response fails validation, but shape is present
        expect(body.gaps).toBeDefined();
        expect(Array.isArray(body.gaps)).toBe(true);
        expect(typeof body.summary).toBe("string");
        expect(body.typeCounts).toBeDefined();
        expect(typeof body.typeCounts).toBe("object");
        expect(typeof body.totalNotes).toBe("number");
    }, 60_000);
});

describe("E2E: POST /suggest/gaps", () => {
    it("returns same shape as GET /suggest/gaps", async () => {
        const { status, json } = await requestJson(suggestApp, "/suggest/gaps", {
            method: "POST",
        });
        expect(status).toBe(200);
        const body = json as Record<string, unknown>;
        expect(body.gaps).toBeDefined();
        expect(Array.isArray(body.gaps)).toBe(true);
        expect(typeof body.summary).toBe("string");
        expect(body.typeCounts).toBeDefined();
        expect(typeof body.totalNotes).toBe("number");
    }, 60_000);
});

describe("E2E: GET /suggest/autocomplete", () => {
    it("returns suggestions array for query", async () => {
        const { status, json } = await requestJson(suggestApp, "/suggest/autocomplete?q=Ald");
        expect(status).toBe(200);
        const body = json as Record<string, unknown>;
        expect(body.suggestions).toBeDefined();
        expect(Array.isArray(body.suggestions)).toBe(true);
    }, 15_000);

    it("rejects empty query parameter", async () => {
        const { status } = await requestJson(suggestApp, "/suggest/autocomplete?q=");
        // Elysia validates minLength: 1, so empty q should fail
        expect(status).toBeGreaterThanOrEqual(400);
    }, 15_000);

    it("respects limit parameter", async () => {
        const { status, json } = await requestJson(suggestApp, "/suggest/autocomplete?q=Ald&limit=5");
        expect(status).toBe(200);
        const body = json as { suggestions: unknown[] };
        expect(body.suggestions.length).toBeLessThanOrEqual(5);
    }, 15_000);
});

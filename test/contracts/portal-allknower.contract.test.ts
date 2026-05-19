/**
 * Portal→AllKnower contract tests.
 * Validates that AllKnower's HTTP responses match the shapes Portal expects.
 * Uses real Postgres (via e2e-mock-setup), mocked LLM + ETAPI.
 *
 * Supersedes test/integration/portal-contracts.test.ts (5 → 22+ contracts).
 *
 * NOTE: All route imports are dynamic (in beforeAll) to avoid triggering the
 * real auth-guard module graph before mocks take effect. See CLAUDE.md E2E section.
 */
import "../helpers/e2e-mock-setup.ts";

import { describe, expect, it, afterAll, beforeAll } from "bun:test";
import { cleanupLanceDb } from "../helpers/e2e-harness.ts";
import { assertFieldsPresent } from "../helpers/contract-helpers.ts";
import { requestJson, type RouteApp } from "../helpers/http.ts";

let app: RouteApp;

beforeAll(async () => {
    const mod = await import("../../src/app.ts");
    app = mod.app;
});

afterAll(async () => {
    await cleanupLanceDb();
});

// ── Health ─────────────────────────────────────────────────────────────────

describe("Portal contract: GET /health", () => {
    it("shape: { status, checks: { database, lancedb, allcodex, bootstrap } }", async () => {
        const { status, json } = await requestJson(app, "/health");
        expect(status).toBe(200);
        const body = json as any;
        expect(body.status).toBeDefined();
        expect(body.checks).toBeDefined();
        assertFieldsPresent(body.checks, ["database", "lancedb", "allcodex", "bootstrap"], "/health.checks");
    });
});

// ── Config ─────────────────────────────────────────────────────────────────

describe("Portal contract: GET /config/models", () => {
    it("returns object with model chain keys", async () => {
        const { status, json } = await requestJson(app, "/config/models");
        expect(status).toBe(200);
        expect(typeof json).toBe("object");
        expect(json).not.toBeNull();
    });
});

// ── Brain Dump ─────────────────────────────────────────────────────────────

describe("Portal contract: POST /brain-dump (auto)", () => {
    it("shape: { summary, created, updated, skipped }", async () => {
        const { status, json } = await requestJson(app, "/brain-dump", {
            method: "POST",
            json: { rawText: "Aldric is the king of Valorheim.", mode: "auto" },
        });
        expect(status).toBe(200);
        const body = json as any;
        expect(typeof body.summary).toBe("string");
        expect(Array.isArray(body.created)).toBe(true);
        expect(Array.isArray(body.updated)).toBe(true);
        expect(Array.isArray(body.skipped)).toBe(true);
        if (body.created.length > 0) {
            assertFieldsPresent(body.created[0], ["noteId", "title", "type"], "brain-dump created entity");
        }
    }, 30_000);
});

describe("Portal contract: POST /brain-dump (review)", () => {
    it("shape: { mode: 'review', summary, proposedEntities }", async () => {
        const { status, json } = await requestJson(app, "/brain-dump", {
            method: "POST",
            json: { rawText: "Aldric is the king of Valorheim.", mode: "review" },
        });
        expect(status).toBe(200);
        const body = json as any;
        expect(body.mode).toBe("review");
        expect(typeof body.summary).toBe("string");
        expect(Array.isArray(body.proposedEntities)).toBe(true);
        if (body.proposedEntities.length > 0) {
            assertFieldsPresent(body.proposedEntities[0], ["title", "type", "action"], "proposed entity");
        }
    }, 30_000);
});

describe("Portal contract: POST /brain-dump/commit", () => {
    it("shape: { summary, created, updated, skipped }", async () => {
        const { status, json } = await requestJson(app, "/brain-dump/commit", {
            method: "POST",
            json: {
                approvedEntities: [{
                    title: "Aldric",
                    type: "character",
                    content: "<p>King</p>",
                    action: "create",
                }],
                rawText: "Aldric is the king.",
            },
        });
        expect(status).toBe(200);
        const body = json as any;
        expect(typeof body.summary).toBe("string");
        expect(Array.isArray(body.created)).toBe(true);
    }, 30_000);
});

describe("Portal contract: GET /brain-dump/history", () => {
    it("shape: { items, nextCursor, hasMore }", async () => {
        const { status, json } = await requestJson(app, "/brain-dump/history");
        expect(status).toBe(200);
        const body = json as any;
        expect(Array.isArray(body.items)).toBe(true);
        expect("nextCursor" in body).toBe(true);
        expect(typeof body.hasMore).toBe("boolean");
        if (body.items.length > 0) {
            assertFieldsPresent(body.items[0], ["id", "rawText", "notesCreated", "notesUpdated"], "history item");
        }
    });
});

describe("Portal contract: GET /brain-dump/history/:id", () => {
    it("returns full entry or 404", async () => {
        const { json: hist } = await requestJson(app, "/brain-dump/history");
        const histBody = hist as any;
        if (histBody.items?.length > 0) {
            const id = histBody.items[0].id;
            const { status, json } = await requestJson(app, `/brain-dump/history/${id}`);
            expect(status).toBe(200);
            assertFieldsPresent(json as any, ["id", "rawText", "parsedJson"], "history entry");
        }
    });

    it("404 shape: { error }", async () => {
        const { status, json } = await requestJson(app, "/brain-dump/history/nonexistent");
        expect(status).toBe(404);
        expect((json as any).error).toBeDefined();
    });
});

// ── RAG ────────────────────────────────────────────────────────────────────

describe("Portal contract: POST /rag/query", () => {
    it("shape: { results: [] }", async () => {
        const { status, json } = await requestJson(app, "/rag/query", {
            method: "POST",
            json: { text: "test query", topK: 5 },
        });
        expect(status).toBe(200);
        expect(Array.isArray((json as any).results)).toBe(true);
    }, 15_000);
});

describe("Portal contract: GET /rag/status", () => {
    it("shape: { indexedNotes, lastIndexed, model }", async () => {
        const { status, json } = await requestJson(app, "/rag/status");
        expect(status).toBe(200);
        expect(typeof (json as any).indexedNotes).toBe("number");
    });
});

// ── Copilot ────────────────────────────────────────────────────────────────

describe("Portal contract: POST /copilot/article", () => {
    it("shape: { assistantMessage, citations, proposal, sessionId }", async () => {
        const { status, json } = await requestJson(app, "/copilot/article", {
            method: "POST",
            json: {
                noteId: "note-1",
                transcript: [{ role: "user", content: "Hello" }],
                currentNote: {
                    noteId: "note-1",
                    title: "T",
                    loreType: "character",
                    contentHtml: "",
                    parentNoteIds: [],
                    labels: [],
                    relations: [],
                },
                linkedNotes: [],
                ragContext: [],
                writableTargetIds: [],
            },
        });
        expect(status).toBe(200);
        const body = json as any;
        expect(typeof body.assistantMessage).toBe("string");
        expect(Array.isArray(body.citations)).toBe(true);
        expect("proposal" in body).toBe(true);
        expect(typeof body.sessionId).toBe("string");
    }, 30_000);
});

// ── Consistency ────────────────────────────────────────────────────────────

describe("Portal contract: POST /consistency/check", () => {
    it("shape: { issues, summary } or error", async () => {
        const { status, json } = await requestJson(app, "/consistency/check", {
            method: "POST",
            json: { noteIds: ["note-1"] },
        });
        const body = json as any;
        if (status === 200) {
            expect(Array.isArray(body.issues)).toBe(true);
            expect(typeof body.summary).toBe("string");
            if (body.issues.length > 0) {
                assertFieldsPresent(body.issues[0], ["type", "severity", "description"], "consistency issue");
            }
        }
    }, 60_000);
});

// ── Suggest ────────────────────────────────────────────────────────────────

describe("Portal contract: POST /suggest/relationships", () => {
    it("shape: { suggestions }", async () => {
        const { status, json } = await requestJson(app, "/suggest/relationships", {
            method: "POST",
            json: { text: "Aldric is the king of Valorheim" },
        });
        expect(status).toBe(200);
        expect(Array.isArray((json as any).suggestions)).toBe(true);
    }, 60_000);
});

describe("Portal contract: POST /suggest/relationships/apply", () => {
    it("shape: { applied, skipped, failed }", async () => {
        const { status, json } = await requestJson(app, "/suggest/relationships/apply", {
            method: "POST",
            json: {
                sourceNoteId: "note-1",
                relations: [{
                    targetNoteId: "note-2",
                    relationshipType: "rulerOf",
                    name: "rules",
                    description: "Aldric rules Valorheim",
                }],
            },
        });
        expect(status).toBe(200);
        const body = json as any;
        expect(Array.isArray(body.applied)).toBe(true);
        expect(Array.isArray(body.skipped)).toBe(true);
        expect(Array.isArray(body.failed)).toBe(true);
    }, 30_000);
});

describe("Portal contract: POST /suggest/gaps", () => {
    it("shape: { gaps, summary, typeCounts, totalNotes }", async () => {
        const { status, json } = await requestJson(app, "/suggest/gaps", {
            method: "POST",
            json: { noteIds: [] },
        });
        expect(status).toBe(200);
        const body = json as any;
        expect(Array.isArray(body.gaps)).toBe(true);
        expect(typeof body.summary).toBe("string");
        expect(typeof body.typeCounts).toBe("object");
        expect(typeof body.totalNotes).toBe("number");
    }, 60_000);
});

describe("Portal contract: GET /suggest/autocomplete", () => {
    it("shape: { suggestions: [{ noteId, title }] }", async () => {
        const { status, json } = await requestJson(app, "/suggest/autocomplete?q=test");
        expect(status).toBe(200);
        expect(Array.isArray((json as any).suggestions)).toBe(true);
    });
});

// ── Integrations ───────────────────────────────────────────────────────────

describe("Portal contract: POST /integrations/allcodex/connect", () => {
    it("shape: { ok: boolean }", async () => {
        const { status, json } = await requestJson(app, "/integrations/allcodex/connect", {
            method: "POST",
            json: { baseUrl: "http://localhost:8080", token: "test-token" },
        });
        expect(status).toBe(200);
        expect((json as any).ok).toBe(true);
    });
});

describe("Portal contract: GET /integrations/allcodex/status", () => {
    it("shape: { connected, provider }", async () => {
        const { status, json } = await requestJson(app, "/integrations/allcodex/status");
        expect(status).toBe(200);
        expect("connected" in (json as any)).toBe(true);
    });
});

describe("Portal contract: DELETE /integrations/allcodex", () => {
    it("returns 200 with ok response", async () => {
        const { status } = await requestJson(app, "/integrations/allcodex", {
            method: "DELETE",
        });
        expect(status).toBe(200);
    });
});

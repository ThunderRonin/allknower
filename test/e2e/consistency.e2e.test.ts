import "../helpers/e2e-mock-setup.ts";
import { describe, expect, it, afterAll } from "bun:test";
import { createConsistencyRoute } from "../../src/routes/consistency.ts";
import { requireAuthBypass } from "../helpers/auth.ts";
import { cleanupLanceDb } from "../helpers/e2e-harness.ts";
import { requestJson } from "../helpers/http.ts";
import { Elysia } from "elysia";

const consistencyApp = new Elysia().use(
    createConsistencyRoute({ requireAuthImpl: requireAuthBypass })
);

afterAll(async () => {
    await cleanupLanceDb();
});

describe("E2E: POST /consistency/check", () => {
    it("returns issues array with noteIds provided", async () => {
        const { status, json } = await requestJson(consistencyApp, "/consistency/check", {
            method: "POST",
            json: { noteIds: ["note-1"] },
        });
        expect(status).toBe(200);
        const body = json as Record<string, unknown>;
        expect(body.issues).toBeDefined();
        expect(Array.isArray(body.issues)).toBe(true);
        // Summary is always present (either from LLM or fallback)
        expect(typeof body.summary).toBe("string");
    }, 60_000);

    it("returns 500 for semantic sampling when LanceDB is empty", async () => {
        // Without noteIds, the route calls queryLore which throws when the
        // LanceDB table doesn't exist in the test environment. The route does
        // not wrap this in try-catch — the server returns 500.
        const { status } = await requestJson(consistencyApp, "/consistency/check", {
            method: "POST",
            json: {},
        });
        expect(status).toBe(500);
    }, 60_000);

    it("falls through to semantic sampling with empty noteIds array", async () => {
        // Empty array → falsy .length → same semantic sampling path → 500
        const { status } = await requestJson(consistencyApp, "/consistency/check", {
            method: "POST",
            json: { noteIds: [] },
        });
        expect(status).toBe(500);
    }, 60_000);
});

describe("E2E: POST /consistency/check/stream", () => {
    it("returns SSE stream with result and done events", async () => {
        const response = await consistencyApp.handle(
            new Request("http://localhost/consistency/check/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ noteIds: ["note-1"] }),
            })
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/event-stream");

        const text = await response.text();
        expect(text.length).toBeGreaterThan(0);

        // Parse SSE events
        const events = text
            .split("\n\n")
            .filter((block) => block.trim().length > 0)
            .map((block) => {
                const eventMatch = block.match(/^event:\s*(.+)$/m);
                const dataMatch = block.match(/^data:\s*(.+)$/m);
                return {
                    event: eventMatch?.[1] ?? "",
                    data: dataMatch?.[1] ? JSON.parse(dataMatch[1]) : null,
                };
            });

        const eventTypes = events.map((e) => e.event);
        expect(eventTypes).toContain("status");
        expect(eventTypes).toContain("result");
        expect(eventTypes).toContain("done");

        // The result event should have the issues array shape
        const resultEvent = events.find((e) => e.event === "result");
        expect(resultEvent).toBeDefined();
        expect(resultEvent!.data.issues).toBeDefined();
        expect(Array.isArray(resultEvent!.data.issues)).toBe(true);
    }, 60_000);
});

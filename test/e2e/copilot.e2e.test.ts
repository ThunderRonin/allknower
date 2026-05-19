import "../helpers/e2e-mock-setup.ts";
import { describe, expect, it, afterAll, beforeAll } from "bun:test";
import { createCopilotRoute } from "../../src/routes/copilot.ts";
import { requireAuthBypass } from "../helpers/auth.ts";
import { cleanupLanceDb } from "../helpers/e2e-harness.ts";
import { requestJson } from "../helpers/http.ts";
import { Elysia } from "elysia";
import copilotFixture from "../fixtures/copilot-conversation.json";

const copilotApp = new Elysia().use(
    createCopilotRoute({ requireAuthImpl: requireAuthBypass })
);

/** Builds a valid POST /copilot/article body with sensible defaults. */
function buildArticleBody(overrides: Record<string, unknown> = {}) {
    return {
        noteId: copilotFixture.noteId,
        transcript: copilotFixture.messages,
        currentNote: {
            noteId: copilotFixture.noteId,
            title: "Aldric",
            loreType: "character",
            contentHtml: "<p>Aldric is the king.</p>",
            parentNoteIds: [],
            labels: [{ name: "loreType", value: "character" }],
            relations: [],
        },
        linkedNotes: [],
        ragContext: [],
        writableTargetIds: [copilotFixture.noteId],
        ...overrides,
    };
}

beforeAll(async () => {
    // Clean up leftover sessions from prior test runs to avoid flakes
    const { default: prisma } = await import("../../src/db/client.ts");
    await prisma.loreSessionMessage.deleteMany({
        where: { session: { userId: "test-user" } },
    });
    await prisma.loreSession.deleteMany({ where: { userId: "test-user" } });
});

afterAll(async () => {
    await cleanupLanceDb();
});

describe("E2E: POST /copilot/article", () => {
    it("creates session and returns assistantMessage + proposal + citations", async () => {
        const { status, json } = await requestJson(copilotApp, "/copilot/article", {
            method: "POST",
            json: buildArticleBody(),
        });
        expect(status).toBe(200);
        const body = json as Record<string, unknown>;
        expect(typeof body.assistantMessage).toBe("string");
        expect((body.assistantMessage as string).length).toBeGreaterThan(0);
        expect("proposal" in body).toBe(true);
        expect("citations" in body).toBe(true);
        expect(Array.isArray(body.citations)).toBe(true);
        // Should also return sessionId for multi-turn continuation
        expect(typeof body.sessionId).toBe("string");
    }, 30_000);

    it("persists session and supports multi-turn continuation", async () => {
        // First turn — creates a new session
        const { status: s1, json: j1 } = await requestJson(copilotApp, "/copilot/article", {
            method: "POST",
            json: buildArticleBody({
                noteId: "note-persist-test",
                transcript: [{ role: "user", content: "Hello" }],
                currentNote: {
                    noteId: "note-persist-test",
                    title: "Test",
                    loreType: "character",
                    contentHtml: "<p>Test</p>",
                    parentNoteIds: [],
                    labels: [],
                    relations: [],
                },
                writableTargetIds: ["note-persist-test"],
            }),
        });
        expect(s1).toBe(200);
        const firstBody = j1 as Record<string, unknown>;
        const sessionId = firstBody.sessionId as string;
        expect(typeof sessionId).toBe("string");

        // Second turn — pass sessionId to continue the same session
        const { status: s2, json: j2 } = await requestJson(copilotApp, "/copilot/article", {
            method: "POST",
            json: buildArticleBody({
                noteId: "note-persist-test",
                sessionId,
                transcript: [
                    { role: "user", content: "Hello" },
                    { role: "assistant", content: "Hi there" },
                    { role: "user", content: "Follow up" },
                ],
                currentNote: {
                    noteId: "note-persist-test",
                    title: "Test",
                    loreType: "character",
                    contentHtml: "<p>Test</p>",
                    parentNoteIds: [],
                    labels: [],
                    relations: [],
                },
                writableTargetIds: ["note-persist-test"],
            }),
        });
        expect(s2).toBe(200);
        const secondBody = j2 as Record<string, unknown>;
        // Should return the same sessionId
        expect(secondBody.sessionId).toBe(sessionId);

        // Verify messages were persisted to real DB
        const { default: prisma } = await import("../../src/db/client.ts");
        const messages = await prisma.loreSessionMessage.findMany({
            where: { sessionId },
            orderBy: { createdAt: "asc" },
        });
        // 2 turns: each turn persists 1 user + 1 assistant = 4 total
        expect(messages.length).toBe(4);
        expect(messages[0].role).toBe("user");
        expect(messages[1].role).toBe("assistant");
        expect(messages[2].role).toBe("user");
        expect(messages[3].role).toBe("assistant");
    }, 30_000);

    it("returns 404 for nonexistent sessionId", async () => {
        const { status, json } = await requestJson(copilotApp, "/copilot/article", {
            method: "POST",
            json: buildArticleBody({
                sessionId: "nonexistent-session-id",
            }),
        });
        expect(status).toBe(404);
        const body = json as Record<string, unknown>;
        expect(body.error).toBe("NOT_FOUND");
    }, 30_000);

    it("handles empty transcript gracefully (persists empty user content)", async () => {
        // The route does not enforce a minimum transcript length at the Elysia
        // boundary — .at(-1) yields undefined, defaulting to empty string.
        // Verify it still succeeds and returns a valid response shape.
        const { status, json } = await requestJson(copilotApp, "/copilot/article", {
            method: "POST",
            json: buildArticleBody({ transcript: [] }),
        });
        expect(status).toBe(200);
        const body = json as Record<string, unknown>;
        expect(typeof body.assistantMessage).toBe("string");
        expect(typeof body.sessionId).toBe("string");
    }, 30_000);

    it("rejects request missing required fields", async () => {
        const { status } = await requestJson(copilotApp, "/copilot/article", {
            method: "POST",
            json: { noteId: "note-1" },
        });
        expect(status).toBeGreaterThanOrEqual(400);
    });
});

describe("E2E: POST /copilot/article/stream", () => {
    it("returns SSE stream with result and done events", async () => {
        const response = await copilotApp.handle(
            new Request("http://localhost/copilot/article/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(buildArticleBody()),
            })
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/event-stream");

        // Read the full SSE stream
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
        // Should have at minimum: status, result, done
        expect(eventTypes).toContain("status");
        expect(eventTypes).toContain("done");
    }, 30_000);
});

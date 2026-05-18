import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import { requireAuthBypass } from "../../test/helpers/auth.ts";
import { requestJson } from "../../test/helpers/http.ts";

// ── Mock refs ────────────────────────────────────────────────────────────────

const runArticleCopilotTurnMock = mock(async () => ({
    assistantMessage: "Discussed.",
    citations: [],
    proposal: null,
}));

const runArticleCopilotStreamMock = mock(async function* () {
    yield { type: "done" as const, raw: JSON.stringify({
        assistantMessage: "Streamed.",
        citations: [],
        proposal: null,
    }), tokensUsed: 10, model: "test", latencyMs: 50 };
});

const validateProposalScopeMock = mock((response: any) => response);

const compactRagContextMock = mock(async (chunks: any[]) => chunks);

const shouldCompactMock = mock(() => false);
const compactSessionMock = mock(async () => ({}));

const countTokensMock = mock((text: string) => Math.ceil(text.length / 4));

// ── Prisma mock refs ─────────────────────────────────────────────────────────

let mockSessionStore: Record<string, any> = {};
let mockMessageStore: any[] = [];
let sessionCreateCounter = 0;

const loreSessionFindUniqueMock = mock(async ({ where }: any) => {
    return mockSessionStore[where.id] ?? null;
});

const loreSessionFindUniqueOrThrowMock = mock(async ({ where }: any) => {
    const s = mockSessionStore[where.id];
    if (!s) throw new Error(`Session ${where.id} not found`);
    return s;
});

const loreSessionCreateMock = mock(async ({ data }: any) => {
    sessionCreateCounter++;
    const id = `session-auto-${sessionCreateCounter}`;
    const session = {
        id,
        userId: data.userId,
        title: data.title,
        state: data.state ?? {},
        tokensAccumulated: data.tokensAccumulated ?? 0,
        compactionCount: 0,
        compactionFailed: 0,
        lockedAt: null,
    };
    mockSessionStore[id] = session;
    return session;
});

const loreSessionUpdateMock = mock(async ({ where, data }: any) => {
    const session = mockSessionStore[where.id];
    if (!session) throw new Error(`Session ${where.id} not found`);
    if (data.tokensAccumulated?.increment) {
        session.tokensAccumulated += data.tokensAccumulated.increment;
    }
    return session;
});

const loreSessionMessageCreateMock = mock(async ({ data }: any) => {
    const msg = { id: `msg-${mockMessageStore.length}`, ...data, createdAt: new Date() };
    mockMessageStore.push(msg);
    return msg;
});

// ── Module mocks (before imports) ────────────────────────────────────────────

mock.module("../plugins/auth-guard.ts", () => ({
    requireAuth: requireAuthBypass,
}));

mock.module("../pipeline/article-copilot.ts", () => ({
    runArticleCopilotTurn: runArticleCopilotTurnMock,
    runArticleCopilotStream: runArticleCopilotStreamMock,
    validateProposalScope: validateProposalScopeMock,
}));

mock.module("../rag/compact-context.ts", () => ({
    compactRagContext: compactRagContextMock,
}));

mock.module("../db/client.ts", () => ({
    default: {
        loreSession: {
            findUnique: loreSessionFindUniqueMock,
            findUniqueOrThrow: loreSessionFindUniqueOrThrowMock,
            create: loreSessionCreateMock,
            update: loreSessionUpdateMock,
            updateMany: mock(async () => ({ count: 0 })),
            deleteMany: mock(async () => ({ count: 0 })),
        },
        loreSessionMessage: {
            create: loreSessionMessageCreateMock,
            findMany: mock(async () => []),
            deleteMany: mock(async () => ({ count: 0 })),
        },
    },
}));

mock.module("../pipeline/session-compactor.ts", () => ({
    shouldCompact: shouldCompactMock,
    compactSession: compactSessionMock,
    rebuildContext: mock(() => ""),
    pruneStaleSession: mock(async () => 0),
    CompactionLockError: class CompactionLockError extends Error {
        constructor(sessionId: string) {
            super(`Compaction lock held for session ${sessionId}`);
            this.name = "CompactionLockError";
        }
    },
}));

mock.module("../utils/tokens.ts", () => ({
    countTokens: countTokensMock,
    tokensToChars: mock((n: number) => Math.floor(n * 3.5)),
}));

mock.module("../logger.ts", () => ({
    rootLogger: {
        info: mock(() => {}),
        warn: mock(() => {}),
        error: mock(() => {}),
        child: mock(() => ({
            info: mock(() => {}),
            warn: mock(() => {}),
            error: mock(() => {}),
        })),
    },
}));

// ── Import route after mocks ─────────────────────────────────────────────────

const { createCopilotRoute } = await import("./copilot.ts");
const copilotRoute = createCopilotRoute({ requireAuthImpl: requireAuthBypass });

const app = new Elysia().use(copilotRoute);

// ── Fixtures ─────────────────────────────────────────────────────────────────

const validBody = {
    noteId: "note-current",
    transcript: [{ role: "user", content: "Discuss this article." }],
    currentNote: {
        noteId: "note-current",
        title: "Current",
        loreType: "location",
        contentHtml: "<p>Current</p>",
        parentNoteIds: ["parent-1"],
        labels: [],
        relations: [],
    },
    linkedNotes: [],
    ragContext: [],
    writableTargetIds: ["note-current"],
};

const bodyWithRag = {
    ...validBody,
    ragContext: [
        { noteId: "rag-1", title: "Dragon Lore", excerpt: "Dragons are ancient creatures...", score: 0.92 },
        { noteId: "rag-2", title: "Fire Magic", excerpt: "Fire magic originated from...", score: 0.85 },
    ],
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Copilot routes", () => {
    beforeEach(() => {
        // Clear all mock call data
        runArticleCopilotTurnMock.mockClear();
        runArticleCopilotStreamMock.mockClear();
        validateProposalScopeMock.mockClear();
        compactRagContextMock.mockClear();
        shouldCompactMock.mockClear();
        compactSessionMock.mockClear();
        countTokensMock.mockClear();
        loreSessionFindUniqueMock.mockClear();
        loreSessionFindUniqueOrThrowMock.mockClear();
        loreSessionCreateMock.mockClear();
        loreSessionUpdateMock.mockClear();
        loreSessionMessageCreateMock.mockClear();

        // Reset stores
        mockSessionStore = {};
        mockMessageStore = [];
        sessionCreateCounter = 0;

        // Reset default implementations
        runArticleCopilotTurnMock.mockImplementation(async () => ({
            assistantMessage: "Discussed.",
            citations: [],
            proposal: null,
        }));

        runArticleCopilotStreamMock.mockImplementation(async function* () {
            yield { type: "done" as const, raw: JSON.stringify({
                assistantMessage: "Streamed.",
                citations: [],
                proposal: null,
            }), tokensUsed: 10, model: "test", latencyMs: 50 };
        });

        validateProposalScopeMock.mockImplementation((response: any) => response);
        shouldCompactMock.mockImplementation(() => false);
        countTokensMock.mockImplementation((text: string) => Math.ceil(text.length / 4));
    });

    // ── Basic request/response (existing tests updated for sessionId) ────

    it("POST /copilot/article returns the documented response shape with sessionId", async () => {
        const { status, json } = await requestJson(app, "/copilot/article", {
            method: "POST",
            json: validBody,
        });

        expect(status).toBe(200);
        expect(json).toMatchObject({
            assistantMessage: "Discussed.",
            citations: [],
            proposal: null,
        });
        expect((json as any).sessionId).toEqual(expect.any(String));
    });

    it("POST /copilot/article rejects malformed request bodies before the pipeline", async () => {
        const { status } = await requestJson(app, "/copilot/article", {
            method: "POST",
            json: {
                ...validBody,
                transcript: [{ role: "system", content: "invalid" }],
            },
        });

        expect(status).toBe(422);
        expect(runArticleCopilotTurnMock).not.toHaveBeenCalled();
    });

    it("POST /copilot/article calls compactRagContext with task 'article-copilot'", async () => {
        const { status } = await requestJson(app, "/copilot/article", {
            method: "POST",
            json: bodyWithRag,
        });

        expect(status).toBe(200);
        expect(compactRagContextMock).toHaveBeenCalledTimes(1);
        expect(compactRagContextMock).toHaveBeenCalledWith(
            [
                { noteId: "rag-1", noteTitle: "Dragon Lore", content: "Dragons are ancient creatures...", score: 0.92 },
                { noteId: "rag-2", noteTitle: "Fire Magic", content: "Fire magic originated from...", score: 0.85 },
            ],
            { task: "article-copilot" },
        );
    });

    it("POST /copilot/article works with empty ragContext", async () => {
        const { status } = await requestJson(app, "/copilot/article", {
            method: "POST",
            json: validBody,
        });

        expect(status).toBe(200);
        expect(compactRagContextMock).toHaveBeenCalledTimes(1);
        expect(compactRagContextMock).toHaveBeenCalledWith([], { task: "article-copilot" });
    });

    it("POST /copilot/article passes compacted chunks back in Portal shape to the pipeline", async () => {
        compactRagContextMock.mockImplementationOnce(async (chunks: any[]) => chunks.slice(0, 1));

        const { status } = await requestJson(app, "/copilot/article", {
            method: "POST",
            json: bodyWithRag,
        });

        expect(status).toBe(200);
        expect(runArticleCopilotTurnMock).toHaveBeenCalledTimes(1);

        const calls = runArticleCopilotTurnMock.mock.calls as unknown as Array<[any]>;
        expect(calls[0][0].ragContext).toEqual([
            { noteId: "rag-1", title: "Dragon Lore", excerpt: "Dragons are ancient creatures...", score: 0.92 },
        ]);
    });

    // ── Session auto-create ──────────────────────────────────────────────

    it("auto-creates a LoreSession when no sessionId is provided", async () => {
        const { status, json } = await requestJson(app, "/copilot/article", {
            method: "POST",
            json: validBody,
        });

        expect(status).toBe(200);
        expect(loreSessionCreateMock).toHaveBeenCalledTimes(1);
        expect(loreSessionCreateMock).toHaveBeenCalledWith({
            data: {
                userId: "test-user",
                title: "Current",
                state: {},
                tokensAccumulated: 0,
            },
        });
        expect((json as any).sessionId).toMatch(/^session-auto-/);
    });

    // ── Session reuse ────────────────────────────────────────────────────

    it("reuses an existing session when sessionId is provided", async () => {
        mockSessionStore["existing-session"] = {
            id: "existing-session",
            userId: "test-user",
            title: "Current",
            state: {},
            tokensAccumulated: 500,
            compactionCount: 0,
            compactionFailed: 0,
            lockedAt: null,
        };

        const { status, json } = await requestJson(app, "/copilot/article", {
            method: "POST",
            json: { ...validBody, sessionId: "existing-session" },
        });

        expect(status).toBe(200);
        expect(loreSessionCreateMock).not.toHaveBeenCalled();
        expect(loreSessionFindUniqueMock).toHaveBeenCalledTimes(1);
        expect((json as any).sessionId).toBe("existing-session");
    });

    // ── Session not found ────────────────────────────────────────────────

    it("returns 404 when sessionId does not exist", async () => {
        const { status, json } = await requestJson(app, "/copilot/article", {
            method: "POST",
            json: { ...validBody, sessionId: "nonexistent-session" },
        });

        expect(status).toBe(404);
        expect((json as any).error).toBe("NOT_FOUND");
        expect(runArticleCopilotTurnMock).not.toHaveBeenCalled();
    });

    // ── Session owned by different user ──────────────────────────────────

    it("returns 404 when session belongs to a different user", async () => {
        mockSessionStore["other-user-session"] = {
            id: "other-user-session",
            userId: "different-user",
            title: "Someone else's session",
            state: {},
            tokensAccumulated: 0,
            compactionCount: 0,
            compactionFailed: 0,
            lockedAt: null,
        };

        const { status, json } = await requestJson(app, "/copilot/article", {
            method: "POST",
            json: { ...validBody, sessionId: "other-user-session" },
        });

        expect(status).toBe(404);
        expect((json as any).error).toBe("NOT_FOUND");
        expect(runArticleCopilotTurnMock).not.toHaveBeenCalled();
    });

    // ── User message persistence ─────────────────────────────────────────

    it("persists the user message to LoreSessionMessage", async () => {
        const { status } = await requestJson(app, "/copilot/article", {
            method: "POST",
            json: validBody,
        });

        expect(status).toBe(200);

        // Should have 2 calls: user message + assistant message
        expect(loreSessionMessageCreateMock).toHaveBeenCalledTimes(2);

        const userCall = loreSessionMessageCreateMock.mock.calls[0] as unknown as [any];
        expect(userCall[0].data.role).toBe("user");
        expect(userCall[0].data.content).toBe("Discuss this article.");
    });

    // ── Assistant message persistence ────────────────────────────────────

    it("persists the assistant message after LLM response", async () => {
        const { status } = await requestJson(app, "/copilot/article", {
            method: "POST",
            json: validBody,
        });

        expect(status).toBe(200);

        const assistantCall = loreSessionMessageCreateMock.mock.calls[1] as unknown as [any];
        expect(assistantCall[0].data.role).toBe("assistant");
        expect(assistantCall[0].data.content).toBe("Discussed.");
        expect(assistantCall[0].data.tokenCount).toEqual(expect.any(Number));
    });

    // ── Token accumulation ───────────────────────────────────────────────

    it("increments tokensAccumulated on the session after response", async () => {
        const { status } = await requestJson(app, "/copilot/article", {
            method: "POST",
            json: validBody,
        });

        expect(status).toBe(200);
        expect(loreSessionUpdateMock).toHaveBeenCalledTimes(1);

        const updateCall = loreSessionUpdateMock.mock.calls[0] as unknown as [any];
        expect(updateCall[0].data.tokensAccumulated).toEqual({
            increment: expect.any(Number),
        });
        expect(updateCall[0].data.tokensAccumulated.increment).toBeGreaterThan(0);
    });

    // ── Compaction triggers ──────────────────────────────────────────────

    it("calls compactSession when shouldCompact returns true", async () => {
        mockSessionStore["compactable-session"] = {
            id: "compactable-session",
            userId: "test-user",
            title: "Current",
            state: {},
            tokensAccumulated: 100000,
            compactionCount: 0,
            compactionFailed: 0,
            lockedAt: null,
        };

        shouldCompactMock.mockImplementation(() => true);
        compactSessionMock.mockImplementation(async () => ({
            intent: "compacted",
            loreTypesInPlay: [],
            noteIdsModified: [],
            skippedEntities: [],
            rawInputsSummary: "",
            unresolvedGaps: [],
            currentFocus: null,
        }));

        const { status } = await requestJson(app, "/copilot/article", {
            method: "POST",
            json: { ...validBody, sessionId: "compactable-session" },
        });

        expect(status).toBe(200);
        expect(shouldCompactMock).toHaveBeenCalledTimes(1);
        expect(compactSessionMock).toHaveBeenCalledTimes(1);
        // After compaction, session is re-fetched
        expect(loreSessionFindUniqueOrThrowMock).toHaveBeenCalledTimes(1);
    });

    it("does not call compactSession when shouldCompact returns false", async () => {
        shouldCompactMock.mockImplementation(() => false);

        const { status } = await requestJson(app, "/copilot/article", {
            method: "POST",
            json: validBody,
        });

        expect(status).toBe(200);
        expect(shouldCompactMock).toHaveBeenCalledTimes(1);
        expect(compactSessionMock).not.toHaveBeenCalled();
    });

    // ── CompactionLockError is non-fatal ─────────────────────────────────

    it("continues normally when compactSession throws CompactionLockError", async () => {
        mockSessionStore["locked-session"] = {
            id: "locked-session",
            userId: "test-user",
            title: "Current",
            state: {},
            tokensAccumulated: 100000,
            compactionCount: 0,
            compactionFailed: 0,
            lockedAt: null,
        };

        shouldCompactMock.mockImplementation(() => true);
        compactSessionMock.mockImplementation(async () => {
            throw new Error("Compaction lock held for session locked-session");
        });

        const { status, json } = await requestJson(app, "/copilot/article", {
            method: "POST",
            json: { ...validBody, sessionId: "locked-session" },
        });

        // Should still succeed — error is logged, not thrown
        expect(status).toBe(200);
        expect((json as any).assistantMessage).toBe("Discussed.");
        expect((json as any).sessionId).toBe("locked-session");
    });

    // ── Streaming endpoint session tests ─────────────────────────────────

    describe("POST /copilot/article/stream", () => {
        it("auto-creates session and includes sessionId in result event", async () => {
            const response = await app.handle(new Request("http://localhost/copilot/article/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(validBody),
            }));

            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")).toContain("text/event-stream");

            const text = await response.text();
            expect(text).toContain("event: result");
            expect(text).toContain("session-auto-");
            expect(loreSessionCreateMock).toHaveBeenCalledTimes(1);
        });

        it("returns 404 for nonexistent session on stream endpoint", async () => {
            const response = await app.handle(new Request("http://localhost/copilot/article/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...validBody, sessionId: "nonexistent" }),
            }));

            expect(response.status).toBe(404);
            const json = await response.json();
            expect(json.error).toBe("NOT_FOUND");
        });

        it("returns 404 for session owned by different user on stream endpoint", async () => {
            mockSessionStore["other-user-stream"] = {
                id: "other-user-stream",
                userId: "different-user",
                title: "Not yours",
                state: {},
                tokensAccumulated: 0,
                compactionCount: 0,
                compactionFailed: 0,
                lockedAt: null,
            };

            const response = await app.handle(new Request("http://localhost/copilot/article/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...validBody, sessionId: "other-user-stream" }),
            }));

            expect(response.status).toBe(404);
        });

        it("persists user message before streaming", async () => {
            await app.handle(new Request("http://localhost/copilot/article/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(validBody),
            })).then(r => r.text()); // consume the stream

            // User message should be persisted
            const userMessages = loreSessionMessageCreateMock.mock.calls.filter(
                (call: any) => call[0].data.role === "user"
            );
            expect(userMessages.length).toBe(1);
        });

        it("persists assistant message and updates tokens after stream completes", async () => {
            (runArticleCopilotStreamMock as any).mockImplementation(async function* () {
                yield { type: "token" as const, content: "Hello " };
                yield { type: "token" as const, content: "world" };
                yield { type: "done" as const, raw: JSON.stringify({
                    assistantMessage: "Hello world",
                    citations: [],
                    proposal: null,
                }), tokensUsed: 5, model: "test", latencyMs: 30 };
            });

            const response = await app.handle(new Request("http://localhost/copilot/article/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(validBody),
            }));
            await response.text(); // consume stream to trigger post-stream persistence

            // Assistant message should be persisted with accumulated content
            const assistantMessages = loreSessionMessageCreateMock.mock.calls.filter(
                (call: any) => call[0].data.role === "assistant"
            );
            expect(assistantMessages.length).toBe(1);
            expect(assistantMessages[0][0].data.content).toBe("Hello world");

            // Token accumulation should be updated
            expect(loreSessionUpdateMock).toHaveBeenCalledTimes(1);
        });

        it("checks compaction on stream endpoint", async () => {
            mockSessionStore["stream-compact-session"] = {
                id: "stream-compact-session",
                userId: "test-user",
                title: "Current",
                state: {},
                tokensAccumulated: 100000,
                compactionCount: 0,
                compactionFailed: 0,
                lockedAt: null,
            };

            shouldCompactMock.mockImplementation(() => true);
            compactSessionMock.mockImplementation(async () => ({}));

            const response = await app.handle(new Request("http://localhost/copilot/article/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...validBody, sessionId: "stream-compact-session" }),
            }));
            await response.text();

            expect(shouldCompactMock).toHaveBeenCalledTimes(1);
            expect(compactSessionMock).toHaveBeenCalledTimes(1);
        });
    });
});

import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import { requireAuthBypass } from "../../test/helpers/auth.ts";
import { requestJson } from "../../test/helpers/http.ts";

const queryLoreMock = mock(async (..._args: any[]) => [] as any[]);
const getAllCodexNotesMock = mock(async (..._args: any[]) => [] as any[]);
const getNoteContentMock = mock(async (..._args: any[]) => "");
const invalidateCredentialCacheMock = mock(() => {});
const probeAllCodexMock = mock(async (..._args: any[]) => ({ ok: true }));
const getNoteMock = mock(async (..._args: any[]) => ({}));
const createNoteMock = mock(async (..._args: any[]) => ({ note: {}, branch: {} }));
const updateNoteMock = mock(async (..._args: any[]) => ({}));
const setNoteContentMock = mock(async (..._args: any[]) => {});
const createAttributeMock = mock(async (..._args: any[]) => ({}));
const setNoteTemplateMock = mock(async (..._args: any[]) => {});
const tagNoteMock = mock(async (..._args: any[]) => {});
const createRelationMock = mock(async (..._args: any[]) => {});
const checkAllCodexHealthMock = mock(async (..._args: any[]) => ({ ok: true }));
const callLLMMock = mock(async () => ({
    raw: JSON.stringify({ issues: [], summary: "All consistent." }),
    tokensUsed: 42,
    model: "test-model",
    latencyMs: 1234,
}));

mock.module("../plugins/auth-guard.ts", () => ({
    requireAuth: requireAuthBypass,
}));

mock.module("../rag/lancedb.ts", () => ({
    queryLore: queryLoreMock,
}));

mock.module("../etapi/client.ts", () => ({
    invalidateCredentialCache: invalidateCredentialCacheMock,
    probeAllCodex: probeAllCodexMock,
    getAllCodexNotes: getAllCodexNotesMock,
    getNote: getNoteMock,
    getNoteContent: getNoteContentMock,
    createNote: createNoteMock,
    updateNote: updateNoteMock,
    setNoteContent: setNoteContentMock,
    createAttribute: createAttributeMock,
    setNoteTemplate: setNoteTemplateMock,
    tagNote: tagNoteMock,
    createRelation: createRelationMock,
    checkAllCodexHealth: checkAllCodexHealthMock,
}));

mock.module("../pipeline/prompt.ts", () => ({
    callLLM: callLLMMock,
    callLLMStream: mock(async function* () { yield { type: "done", raw: "{}", tokensUsed: 0, model: "test", latencyMs: 0 }; }),
    buildBrainDumpPrompt: mock(() => ({ system: "sys", context: "ctx", user: "usr" })),
}));

mock.module("../integrations/allcodex.ts", () => ({
    resolveAllCodexCredentials: mock(async () => ({ baseUrl: "http://localhost:8080", token: "test-token" })),
}));

const { consistencyRoute } = await import("./consistency.ts");

const app = new Elysia().use(consistencyRoute);

describe("Consistency routes", () => {
    beforeEach(() => {
        queryLoreMock.mockClear();
        getAllCodexNotesMock.mockClear();
        getNoteContentMock.mockClear();
        callLLMMock.mockClear();
    });

    it("POST /consistency/check bounds semantic sampling context and LLM call options", async () => {
        queryLoreMock.mockImplementation(async (probe: string) => [{
            noteId: `note-${probe.slice(0, 6)}`,
            noteTitle: `Title ${probe.slice(0, 6)}`,
            content: "A".repeat(5000),
            score: 0.99,
        }]);

        const { status, json } = await requestJson(app, "/consistency/check", {
            method: "POST",
            json: {},
        });

        expect(status).toBe(200);
        expect(json).toEqual({ issues: [], summary: "All consistent." });
        expect(queryLoreMock).toHaveBeenCalledTimes(1);
        expect(callLLMMock).toHaveBeenCalledTimes(1);

        const [, , task, context, options] = callLLMMock.mock.calls[0] as unknown as [
            string,
            string,
            string,
            string,
            { jsonSchema?: unknown; timeoutMs?: number; maxTokens?: number },
        ];

        expect(task).toBe("consistency");
        expect(context).toContain("## Lore Entries");
        expect(context).not.toContain("A".repeat(1200));
        expect(options.timeoutMs).toBe(120000);
        expect(options.maxTokens).toBe(2000);
        expect(options.jsonSchema).toBeDefined();
    });
});

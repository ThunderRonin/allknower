import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import { requireAuthBypass } from "../../test/helpers/auth.ts";
import { requestJson } from "../../test/helpers/http.ts";

const runArticleCopilotTurnMock = mock(async () => ({
    assistantMessage: "Discussed.",
    citations: [],
    proposal: null,
}));

const compactRagContextMock = mock(async (chunks: any[]) => chunks);

mock.module("../plugins/auth-guard.ts", () => ({
    requireAuth: requireAuthBypass,
}));

mock.module("../pipeline/article-copilot.ts", () => ({
    runArticleCopilotTurn: runArticleCopilotTurnMock,
    runArticleCopilotStream: mock(async function* () { yield { type: "done", raw: "{}", tokensUsed: 0, model: "test", latencyMs: 0 }; }),
    validateProposalScope: mock((proposal: any) => proposal),
}));

mock.module("../rag/compact-context.ts", () => ({
    compactRagContext: compactRagContextMock,
}));

const { copilotRoute } = await import("./copilot.ts");

const app = new Elysia().use(copilotRoute);

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

describe("Copilot routes", () => {
    beforeEach(() => {
        runArticleCopilotTurnMock.mockClear();
        compactRagContextMock.mockClear();
    });

    it("POST /copilot/article returns the documented response shape", async () => {
        const { status, json } = await requestJson(app, "/copilot/article", {
            method: "POST",
            json: validBody,
        });

        expect(status).toBe(200);
        expect(json).toEqual({
            assistantMessage: "Discussed.",
            citations: [],
            proposal: null,
        });
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
        // Mock compactRagContext to return a subset (simulating budget trimming)
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
});

import { beforeEach, describe, expect, it, mock } from "bun:test";

const callWithFallbackMock = mock(async () => ({
    raw: JSON.stringify({
        assistantMessage: "Acknowledged.",
        citations: [],
        proposal: null,
    }),
    tokensUsed: 100,
    model: "test-model",
    latencyMs: 12,
}));

mock.module("./model-router.ts", () => ({
    callWithFallback: callWithFallbackMock,
}));

import { runArticleCopilotTurn } from "./article-copilot.ts";

const baseInput = {
    noteId: "note-current",
    transcript: [{ role: "user" as const, content: "Discuss the article." }],
    currentNote: {
        noteId: "note-current",
        title: "Current Note",
        loreType: "location",
        contentHtml: "<p>Current</p>",
        labels: [],
        relations: [],
        parentNoteIds: ["parent-1"],
    },
    linkedNotes: [
        {
            noteId: "note-linked",
            title: "Linked Note",
            loreType: "character",
            contentHtml: "<p>Linked</p>",
            labels: [],
            relations: [],
            parentNoteIds: ["parent-1"],
        },
    ],
    ragContext: [
        {
            noteId: "note-rag",
            title: "RAG Note",
            excerpt: "Read-only lore context",
            score: 0.81,
        },
    ],
    writableTargetIds: ["note-current", "note-linked"],
};

describe("runArticleCopilotTurn", () => {
    beforeEach(() => {
        callWithFallbackMock.mockClear();
    });

    it("accepts discussion-only turns with no proposal", async () => {
        callWithFallbackMock.mockResolvedValueOnce({
            raw: JSON.stringify({
                assistantMessage: "Here are a few options.",
                citations: [{ noteId: "note-rag", title: "RAG Note", source: "rag" }],
                proposal: null,
            }),
            tokensUsed: 123,
            model: "test-model",
            latencyMs: 20,
        });

        const result = await runArticleCopilotTurn(baseInput, "user-1");

        expect(result.proposal).toBeNull();
        expect(result.citations).toHaveLength(1);
    });

    it("rejects malformed model output", async () => {
        callWithFallbackMock.mockResolvedValueOnce({
            raw: "{not json",
            tokensUsed: 1,
            model: "test-model",
            latencyMs: 3,
        });

        await expect(runArticleCopilotTurn(baseInput, "user-1")).rejects.toThrow("invalid JSON");
    });

    it("rejects proposals that target notes outside writableTargetIds", async () => {
        callWithFallbackMock.mockResolvedValueOnce({
            raw: JSON.stringify({
                assistantMessage: "I drafted a change.",
                citations: [],
                proposal: {
                    targets: [
                        {
                            kind: "update",
                            targetId: "note-rag",
                            contentHtml: "<p>Should not be writable.</p>",
                            labelUpserts: [],
                            labelDeletes: [],
                            relationAdds: [],
                            relationDeletes: [],
                            rationale: "Bad scope.",
                        },
                    ],
                },
            }),
            tokensUsed: 10,
            model: "test-model",
            latencyMs: 5,
        });

        await expect(runArticleCopilotTurn(baseInput, "user-1")).rejects.toThrow("outside the writable scope");
    });

    it("accepts proposals that update a supplied writable linked note", async () => {
        callWithFallbackMock.mockResolvedValueOnce({
            raw: JSON.stringify({
                assistantMessage: "I drafted a linked-note update.",
                citations: [{ noteId: "note-linked", title: "Linked Note", source: "linked" }],
                proposal: {
                    targets: [
                        {
                            kind: "update",
                            targetId: "note-linked",
                            contentHtml: "<p>Updated linked content.</p>",
                            labelUpserts: [],
                            labelDeletes: [],
                            relationAdds: [],
                            relationDeletes: [],
                            rationale: "The linked note carries this detail.",
                        },
                    ],
                },
            }),
            tokensUsed: 10,
            model: "test-model",
            latencyMs: 5,
        });

        const result = await runArticleCopilotTurn(baseInput, "user-1");

        expect(result.proposal?.targets[0].targetId).toBe("note-linked");
    });

    it("rejects create proposals that do not link back to the current article", async () => {
        callWithFallbackMock.mockResolvedValueOnce({
            raw: JSON.stringify({
                assistantMessage: "I drafted a new note.",
                citations: [],
                proposal: {
                    targets: [
                        {
                            kind: "create",
                            targetId: "tmp-1",
                            title: "Detached Note",
                            loreType: "character",
                            contentHtml: "<p>Detached</p>",
                            labelUpserts: [],
                            labelDeletes: [],
                            relationAdds: [],
                            relationDeletes: [],
                            rationale: "Bad create.",
                        },
                    ],
                },
            }),
            tokensUsed: 10,
            model: "test-model",
            latencyMs: 5,
        });

        await expect(runArticleCopilotTurn(baseInput, "user-1")).rejects.toThrow("must link directly to the current article");
    });
});

import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import { requireAuthBypass } from "../../test/helpers/auth.ts";
import { requestJson } from "../../test/helpers/http.ts";

const runArticleCopilotTurnMock = mock(async () => ({
    assistantMessage: "Discussed.",
    citations: [],
    proposal: null,
}));

mock.module("../plugins/auth-guard.ts", () => ({
    requireAuth: requireAuthBypass,
}));

mock.module("../pipeline/article-copilot.ts", () => ({
    runArticleCopilotTurn: runArticleCopilotTurnMock,
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

describe("Copilot routes", () => {
    beforeEach(() => {
        runArticleCopilotTurnMock.mockClear();
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
});

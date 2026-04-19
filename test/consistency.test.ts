import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import { requireAuthBypass } from "./helpers/auth.ts";
import { requestJson } from "./helpers/http.ts";

let returnNoNotes = false;

async function buildBrainDumpPromptMock(
    rawText: string,
    ragContext: Array<{ noteTitle: string; content: string }>
) {
    const context = ragContext.length > 0
        ? ragContext.map((chunk) => `### ${chunk.noteTitle}\n${chunk.content}`).join("\n\n")
        : "No existing lore found";

    return {
        system: "You are the lore architect",
        context,
        user: rawText,
        admittedChunks: ragContext,
    };
}

mock.module("../src/plugins/auth-guard.ts", () => ({
    requireAuth: requireAuthBypass
}));

mock.module("../src/etapi/client.ts", () => ({
    checkAllCodexHealth: mock(async () => ({ ok: true })),
    createAttribute: mock(async () => ({})),
    createNote: mock(async () => ({ note: { noteId: "new-note-1" } })),
    createRelation: mock(async () => {}),
    getAllCodexNotes: mock(async () => {
        if (returnNoNotes) {
            return [];
        }

        return [
            { noteId: "note-1", title: "Archivist" },
            { noteId: "note-2", title: "Citadel" },
        ];
    }),
    getNoteContent: mock(async (noteId: string) => `<p>${noteId} content</p>`),
    getNote: mock(async (noteId: string) => ({ noteId, title: "Mock Note", type: "text" })),
    setNoteContent: mock(async () => {}),
    setNoteTemplate: mock(async () => {}),
    tagNote: mock(async () => {}),
    updateNote: mock(async (noteId: string) => ({ noteId, title: "Mock Note", type: "text", mime: "text/html" })),
    probeAllCodex: mock(async () => ({ ok: true })),
    invalidateCredentialCache: mock(() => {}),
}));

mock.module("../src/rag/lancedb.ts", () => ({
    checkLanceDbHealth: mock(async () => ({ ok: true })),
    queryLore: mock(async () => {
        if (returnNoNotes) {
            return [];
        }

        return [
            { noteId: "note-1", noteTitle: "Archivist", content: "Lore chunk", distance: 0.1 },
        ];
    })
}));

mock.module("../src/pipeline/prompt.ts", () => ({
    buildBrainDumpPrompt: mock(buildBrainDumpPromptMock),
    callLLM: mock(async (_system: string, _user: string, task?: string) => {
        if (task === "brain-dump") {
            return {
                raw: JSON.stringify({
                    entities: [{ type: "character", title: "King Arthur", content: "A king.", attributes: {}, action: "create" }],
                    summary: "Extracted a character",
                }),
                tokensUsed: 100,
                model: "testing-model",
            };
        }

        return {
            raw: JSON.stringify({
                issues: [{ type: "contradiction", severity: "high", description: "Dead character walking", affectedNoteIds: ["note-1", "note-2"] }],
                summary: "Found a contradiction",
            })
        };
    })
}));

const { consistencyRoute } = await import("../src/routes/consistency.ts");

const app = new Elysia().use(consistencyRoute);

describe("Consistency routes", () => {
    beforeEach(() => {
        returnNoNotes = false;
    });

    it("POST /consistency/check returns the documented response shape", async () => {
        const { status, json } = await requestJson(app, "/consistency/check", {
            method: "POST",
            json: { noteIds: ["note-1", "note-2"] },
        });

        const body = json as { issues: Array<{ severity: string }>; summary: string };
        expect(status).toBe(200);
        expect(Array.isArray(body.issues)).toBe(true);
        expect(body.issues[0].severity).toBe("high");
        expect(typeof body.summary).toBe("string");
    });

    it("POST /consistency/check rejects an invalid request body", async () => {
        const { status } = await requestJson(app, "/consistency/check", {
            method: "POST",
            json: { noteIds: "note-1" },
        });

        expect(status).toBe(422);
    });

    it("POST /consistency/check returns a graceful empty response when no notes are available", async () => {
        returnNoNotes = true;

        const { status, json } = await requestJson(app, "/consistency/check", {
            method: "POST",
            json: {},
        });

        expect(status).toBe(200);
        expect(json).toEqual({ issues: [], summary: "No lore notes found to check." });
    });
});
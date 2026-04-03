import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import { requireAuthBypass } from "./helpers/auth.ts";
import { requestJson } from "./helpers/http.ts";

let returnNoNotes = false;

mock.module("../src/plugins/auth-guard.ts", () => ({
    requireAuth: requireAuthBypass
}));

mock.module("../src/etapi/client.ts", () => ({
    checkAllCodexHealth: mock(async () => ({ ok: true })),
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
    callLLM: mock(async () => ({
        raw: JSON.stringify({
            issues: [{ type: "contradiction", severity: "high", description: "Dead character walking", affectedNoteIds: ["note-1", "note-2"] }],
            summary: "Found a contradiction",
        })
    }))
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
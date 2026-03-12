import { describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// 1. Mock auth guard
mock.module("../../src/plugins/auth-guard.ts", () => ({
    requireAuth: new Elysia({ name: "allknower/require-auth" })
}));

// 2. Mock model-router for LLM calls
mock.module("../../src/pipeline/prompt.ts", () => ({
    callLLM: mock(async (system: string, user: string, task: string) => {
        return { 
            raw: JSON.stringify({ 
                issues: [
                    { type: "contradiction", severity: "high", description: "Dead character walking", affectedNoteIds: ["1", "2"] }
                ], 
                summary: "Found a contradiction" 
            }) 
        };
    })
}));

// 3. Mock ETAPI for getting notes and content
mock.module("../../src/etapi/client.ts", () => ({
    getAllCodexNotes: mock(async () => [
        { noteId: "1", title: "Note 1" },
        { noteId: "2", title: "Note 2" }
    ]),
    getNoteContent: mock(async () => "<p>Note content string</p>")
}));

import { app } from "../../src/app";

describe("E2E API Tests: Consistency", () => {

    describe("POST /consistency/check", () => {
        it("should return consistency issues from the LLM based on note contents", async () => {
             const req = new Request("http://localhost/consistency/check", {
                 method: "POST",
                 headers: { "Content-Type": "application/json" },
                 body: JSON.stringify({ noteIds: ["1", "2"] })
             });
             const res = await app.handle(req);
             
             expect(res.status).toBe(200);
             const data = await res.json();
             
             expect(data.summary).toBe("Found a contradiction");
             expect(data.issues.length).toBe(1);
             expect(data.issues[0].severity).toBe("high");
        });
    });
});

import { describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// 1. Mock auth guard
mock.module("../../src/plugins/auth-guard.ts", () => ({
    requireAuth: new Elysia({ name: "allknower/require-auth" })
}));

// 2. Mock model-router for LLM calls (Gap detection and Relationships)
mock.module("../../src/pipeline/prompt.ts", () => ({
    callLLM: mock(async (system: string, user: string, task: string) => {
        if (task === "suggest") {
            return { raw: JSON.stringify({ suggestions: [{ targetNoteId: "mock-1", targetTitle: "Mocker", relationshipType: "ally", description: "Friends" }] }) };
        }
        if (task === "gap-detect") {
            return { raw: JSON.stringify({ gaps: [{ area: "Cities", severity: "high", description: "No cities.", suggestion: "Add one." }], summary: "Add cities" }) };
        }
        return { raw: "{}" };
    })
}));

// 3. Mock LanceDB for Semantic Search (Relationships and Autocomplete Phase 2)
mock.module("../../src/rag/lancedb.ts", () => ({
    queryLore: mock(async (query: string, limit: number) => {
        if (query === "empty-query") return [];
        return [{ noteId: "semantic-1", noteTitle: "Semantic King", content: "Lore", distance: 0.1 }];
    })
}));

// 4. Mock ETAPI for Gap Detection
mock.module("../../src/etapi/client.ts", () => ({
    getAllCodexNotes: mock(async () => [
        { noteId: "1", title: "A", attributes: [{ name: "loreType", value: "character" }] },
        { noteId: "2", title: "B", attributes: [{ name: "loreType", value: "character" }] }
    ])
}));

// 5. Mock Prisma for Autocomplete Phase 1
mock.module("../../src/db/client.ts", () => ({
    default: {
        ragIndexMeta: {
            findMany: mock(async () => [
                { noteId: "prefix-1", noteTitle: "Prefix Match" }
            ])
        }
    }
}));

import { app } from "../../src/app";

describe("E2E API Tests: Suggestions", () => {

    describe("POST /suggest/relationships", () => {
        it("should return relationship suggestions from LLM when similar lore exists", async () => {
            const req = new Request("http://localhost/suggest/relationships", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: "Looking for friends." })
            });
            const res = await app.handle(req);
            expect(res.status).toBe(200);
            const data = await res.json();
            
            expect(data.suggestions.length).toBe(1);
            expect(data.suggestions[0].targetTitle).toBe("Mocker");
            expect(data.suggestions[0].relationshipType).toBe("ally");
        });

        it("should return empty suggestions if no similar lore exists", async () => {
             const req = new Request("http://localhost/suggest/relationships", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: "empty-query" }) // Our mock returns [] for this specific string
            });
            const res = await app.handle(req);
            const data = await res.json();
            
            expect(data.suggestions.length).toBe(0);
        });
    });

    describe("GET /suggest/gaps", () => {
        it("should return gap analysis and type counts", async () => {
            const req = new Request("http://localhost/suggest/gaps");
            const res = await app.handle(req);
            
            expect(res.status).toBe(200);
            const data = await res.json();
            
            expect(data.gaps.length).toBe(1);
            expect(data.typeCounts["character"]).toBe(2);
            expect(data.totalNotes).toBe(2);
        });
    });

    describe("GET /suggest/autocomplete", () => {
        it("should return combined Phase 1 (Prefix) and Phase 2 (Semantic) suggestions", async () => {
             const req = new Request("http://localhost/suggest/autocomplete?q=Prefix");
             const res = await app.handle(req);
             
             expect(res.status).toBe(200);
             const data = await res.json();
             
             // Expected to have both Phase 1 mock and Phase 2 mock
             expect(data.suggestions.length).toBe(2);
             expect(data.suggestions[0].title).toBe("Prefix Match");
             expect(data.suggestions[1].title).toBe("Semantic King");
        });
    });
});

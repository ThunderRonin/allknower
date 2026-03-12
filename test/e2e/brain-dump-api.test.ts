import { describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// 1. Mock auth guard to bypass authentication
mock.module("../../src/plugins/auth-guard.ts", () => ({
    requireAuth: new Elysia({ name: "allknower/require-auth" })
}));

// 2. Mock model-router so we don't hit OpenRouter in E2E tests
mock.module("../../src/pipeline/model-router.ts", () => ({
    callWithFallback: mock(async () => ({
        raw: JSON.stringify({
            entities: [{ type: "character", title: "API King", content: "A king from API test.", action: "create" }],
            summary: "Extracted via API"
        }),
        tokensUsed: 100,
        model: "testing-model"
    }))
}));

// 3. Mock background indexing
mock.module("../../src/rag/indexer.ts", () => ({
    indexNote: mock(async () => {})
}));

// 4. Mock ETAPI
mock.module("../../src/etapi/client.ts", () => ({
    createNote: mock(async () => ({ note: { noteId: "new-api-note-1" } })),
    setNoteTemplate: mock(async () => {}),
    tagNote: mock(async () => {}),
    createAttribute: mock(async () => {})
}));

// 5. Mock LanceDB
mock.module("../../src/rag/lancedb.ts", () => ({
    queryLore: mock(async () => [])
}));

// 6. Mock Prisma
mock.module("../../src/db/client.ts", () => ({
    default: {
        appConfig: {
            findUnique: mock(async () => null)
        },
        brainDumpHistory: {
            create: mock(async () => ({ id: "history-1" })),
            findMany: mock(async () => [])
        }
    }
}));

// Import App after mocks are defined
import { app } from "../../src/app";

describe("E2E API Tests: Brain Dump", () => {

    describe("POST /brain-dump", () => {
        it("should return expected output from mocked LLM and create notes via ETAPI", async () => {
            const req = new Request("http://localhost/brain-dump/", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ rawText: "Here is text for brain dump. Text must be at least 10 chars." })
            });
            
            const res = await app.handle(req);
            
            // Check success
            expect(res.status).toBe(200);
            
            const data = await res.json();
            
            // Validate response matches our OpenRouter mock
            expect(data.summary).toBe("Extracted via API");
            expect(data.created.length).toBe(1);
            expect(data.created[0].title).toBe("API King");
        });

        it("should return 400 for text less than 10 characters", async () => {
            const req = new Request("http://localhost/brain-dump/", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ rawText: "short" })
            });

            const res = await app.handle(req);
            // Elysia validation should catch this
            expect(res.status).toBe(422); // Elysia defaults to 422 Unprocessable Entity for schema validation failures
        });
    });

    describe("GET /brain-dump/history", () => {
         it("should return history details", async () => {
            const req = new Request("http://localhost/brain-dump/history");
            const res = await app.handle(req);
            
            expect(res.status).toBe(200);
            const data = await res.json();
            // We mocked findMany to return []
            expect(Array.isArray(data)).toBe(true);
            expect(data.length).toBe(0);
        });
    });
});

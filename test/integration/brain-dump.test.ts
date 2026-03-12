import { describe, expect, it, mock } from "bun:test";

// Set up module mocks before importing the function that uses them.
mock.module("../../src/rag/lancedb.ts", () => ({
    queryLore: mock(async () => [])
}));

mock.module("../../src/pipeline/prompt.ts", () => ({
    buildBrainDumpPrompt: mock(() => ({ system: "sys", context: "ctx", user: "usr" })),
    callLLM: mock(async () => ({
        raw: JSON.stringify({
            entities: [{ type: "character", title: "King Arthur", content: "A king.", action: "create" }],
            summary: "Extracted a character"
        }),
        tokensUsed: 100,
        model: "testing-model"
    }))
}));

mock.module("../../src/etapi/client.ts", () => ({
    createNote: mock(async () => ({ note: { noteId: "new-note-1" } })),
    setNoteTemplate: mock(async () => {}),
    tagNote: mock(async () => {}),
    createAttribute: mock(async () => {})
}));

// Mock Prisma
mock.module("../../src/db/client.ts", () => ({
    default: {
        appConfig: {
            findUnique: mock(async () => null)
        },
        brainDumpHistory: {
            create: mock(async () => ({ id: "history-1" }))
        }
    }
}));

// Import after mocks
import { runBrainDump } from "../../src/pipeline/brain-dump";

describe("runBrainDump Integration", () => {
    it("should process text, call LLM, and create note via ETAPI", async () => {
        const result = await runBrainDump("King Arthur was here.");
        
        expect(result.summary).toBe("Extracted a character");
        expect(result.created.length).toBe(1);
        expect(result.created[0].title).toBe("King Arthur");
        expect(result.reindexIds).toContain("new-note-1");
    });
});

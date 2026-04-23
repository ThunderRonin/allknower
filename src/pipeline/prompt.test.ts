import { mock } from "bun:test";

// model-router.test.ts (alphabetically earlier) mocks env.ts without RAG vars,
// contaminating this test when both run under bun test src/pipeline/.
// Re-declare env here so prompt.ts loads with the values it needs.
mock.module("../env.ts", () => ({
    env: {
        RAG_CONTEXT_MAX_TOKENS: 6000,
        RAG_CHUNK_DEDUP_SIMILARITY_THRESHOLD: 0.85,
        RAG_CHUNK_SUMMARY_THRESHOLD_TOKENS: 400,
    },
}));

import { describe, expect, it } from "bun:test";
import { buildBrainDumpPrompt } from "./prompt";

describe("prompt builder", () => {
    it("should build prompt without RAG context", async () => {
        const rawText = "A king was born.";
        const result = await buildBrainDumpPrompt(rawText, []);

        expect(result.system).toContain("You are the lore architect");
        expect(result.context).toContain("No existing lore found");
        expect(result.user).toContain(rawText);
        expect(result.admittedChunks).toEqual([]);
    });

    it("should build prompt with RAG context", async () => {
        const rawText = "He is the son of Arthur.";
        const ragContext = [
            { noteId: "1", noteTitle: "Arthur", content: "The great king.", score: 0.1 }
        ];
        const result = await buildBrainDumpPrompt(rawText, ragContext);

        expect(result.context).toContain("### Arthur");
        expect(result.context).toContain("The great king.");
        expect(result.context).not.toContain("No existing lore found");
        expect(result.user).toContain(rawText);
        expect(result.admittedChunks).toHaveLength(1);
    });
});

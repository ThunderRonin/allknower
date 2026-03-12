import { describe, expect, it } from "bun:test";
import { buildBrainDumpPrompt } from "./prompt";

describe("prompt builder", () => {
    it("should build prompt without RAG context", () => {
        const rawText = "A king was born.";
        const result = buildBrainDumpPrompt(rawText, []);

        expect(result.system).toContain("You are the lore architect");
        expect(result.context).toContain("No existing lore found");
        expect(result.user).toContain(rawText);
    });

    it("should build prompt with RAG context", () => {
        const rawText = "He is the son of Arthur.";
        const ragContext = [
            { noteId: "1", noteTitle: "Arthur", content: "The great king.", score: 0.1 }
        ];
        const result = buildBrainDumpPrompt(rawText, ragContext);

        expect(result.context).toContain("### Arthur");
        expect(result.context).toContain("The great king.");
        expect(result.context).not.toContain("No existing lore found");
        expect(result.user).toContain(rawText);
    });
});

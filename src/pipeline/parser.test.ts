import { describe, expect, it } from "bun:test";
import { parseBrainDumpResponse } from "./parser";

describe("parser", () => {
    it("should parse valid JSON successfully", () => {
        const validJson = JSON.stringify({
            entities: [
                {
                    type: "character",
                    title: "Arthur",
                    content: "<p>The great king.</p>",
                    attributes: {},
                    action: "create"
                }
            ],
            summary: "Extracted a character."
        });

        const result = parseBrainDumpResponse(validJson);
        expect(result.summary).toBe("Extracted a character.");
        expect(result.entities.length).toBe(1);
        expect(result.entities[0].title).toBe("Arthur");
    });

    it("should throw error for completely invalid JSON", () => {
        expect(() => parseBrainDumpResponse("Not JSON")).toThrow("LLM returned invalid JSON");
    });

    it("should safely drop malformed entities but keep valid ones", () => {
        const mixedJson = JSON.stringify({
            entities: [
                {
                    type: "character",
                    title: "Arthur",
                    content: "<p>The great king.</p>",
                    attributes: {},
                    action: "create"
                },
                {
                    // Malformed: missing type
                    title: "Bad Entity",
                    action: "create"
                }
            ],
            summary: "Extracted mixed entities."
        });

        const result = parseBrainDumpResponse(mixedJson);
        expect(result.entities.length).toBe(1); // Dropped the bad one
        expect(result.entities[0].title).toBe("Arthur");
    });
});

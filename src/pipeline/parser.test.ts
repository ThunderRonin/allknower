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

    it("should coerce comma-string faction fields into arrays (LLM formatting quirk)", () => {
        // LLMs often return members/allies/enemies as comma-separated strings instead of arrays.
        // The coerceToArray helper in lore.ts should handle this gracefully.
        const json = JSON.stringify({
            entities: [
                {
                    type: "faction",
                    title: "Übermenschreich",
                    content: "<p>A militarized technocratic superpower.</p>",
                    attributes: {
                        members: "The Chancellor, The General Council",
                        allies: "Iron Pact",
                        enemies: "The Free Cities, The Wanderers",
                        factionType: "Empire",
                    },
                    action: "create"
                }
            ],
            summary: "Extracted a faction with string-formatted arrays."
        });

        const result = parseBrainDumpResponse(json);
        expect(result.entities.length).toBe(1);

        const faction = result.entities[0];
        expect(faction.title).toBe("Übermenschreich");
        // @ts-expect-error — accessing typed attributes union
        expect(Array.isArray(faction.attributes.members)).toBe(true);
        // @ts-expect-error
        expect(faction.attributes.members).toEqual(["The Chancellor", "The General Council"]);
        // @ts-expect-error
        expect(Array.isArray(faction.attributes.allies)).toBe(true);
        // @ts-expect-error
        expect(faction.attributes.enemies).toEqual(["The Free Cities", "The Wanderers"]);
    });
});

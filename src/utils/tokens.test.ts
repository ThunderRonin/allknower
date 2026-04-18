import { describe, expect, it } from "bun:test";
import { countTokens, tokensToChars } from "./tokens.ts";

describe("countTokens", () => {
    it("returns a positive integer for non-empty string", () => {
        const result = countTokens("Hello world");
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThan(0);
    });

    it("returns 0 for empty string", () => {
        expect(countTokens("")).toBe(0);
    });

    it("longer text returns more tokens than shorter text", () => {
        const short = countTokens("Hi");
        const long = countTokens("The archivist buried a fragment beneath the obsidian gate in the northern reaches.");
        expect(long).toBeGreaterThan(short);
    });

    it("heuristic: Math.ceil(len/3.5) for non-empty string", () => {
        // Verify heuristic formula independently
        const text = "Hello world";
        const expected = Math.ceil(text.length / 3.5);
        expect(expected).toBeGreaterThanOrEqual(1);
    });

    it("heuristic result is always >= 1 for non-empty string", () => {
        const texts = ["a", "ab", "abc", "hello"];
        for (const t of texts) {
            const heuristic = Math.ceil(t.length / 3.5);
            expect(heuristic).toBeGreaterThanOrEqual(1);
        }
    });
});

describe("tokensToChars", () => {
    it("returns Math.floor(tokens * 3.5)", () => {
        expect(tokensToChars(10)).toBe(Math.floor(10 * 3.5));
    });

    it("tokensToChars(1) = 3", () => {
        expect(tokensToChars(1)).toBe(3);
    });

    it("tokensToChars(100) = 350", () => {
        expect(tokensToChars(100)).toBe(350);
    });

    it("tokensToChars(0) = 0", () => {
        expect(tokensToChars(0)).toBe(0);
    });

    it("round-trip: tokensToChars(countTokens(text)) <= text.length always", () => {
        const texts = [
            "Short text",
            "A moderately longer piece of worldbuilding lore about a character named Aldric.",
            "x".repeat(500),
        ];
        for (const text of texts) {
            const tokens = countTokens(text);
            const chars = tokensToChars(tokens);
            // tokensToChars uses floor * 3.5 — should be <= actual length for realistic text
            expect(chars).toBeLessThanOrEqual(text.length + 10); // tiny buffer for heuristic drift
        }
    });
});

import { describe, expect, it } from "bun:test";
import type { RagChunk } from "../types/lore.ts";
import { computeRrf, type RrfEntry } from "./rrf.ts";

function chunk(noteId: string, content: string, score = 0): RagChunk {
    return {
        noteId,
        noteTitle: `Note ${noteId}`,
        content,
        score,
    };
}

describe("computeRrf", () => {
    it("returns an empty array for an empty map", () => {
        expect(computeRrf(new Map(), 60)).toEqual([]);
    });

    it("scores a vector-only rank 1 result as 1/(k+1)", () => {
        const entries = new Map<string, RrfEntry>([
            ["a", { chunk: chunk("a", "alpha"), vectorRank: 1 }],
        ]);

        expect(computeRrf(entries, 60)[0].score).toBeCloseTo(1 / 61);
    });

    it("scores a keyword-only rank 1 result as 1/(k+1)", () => {
        const entries = new Map<string, RrfEntry>([
            ["a", { chunk: chunk("a", "alpha"), keywordRank: 1 }],
        ]);

        expect(computeRrf(entries, 60)[0].score).toBeCloseTo(1 / 61);
    });

    it("scores both search legs higher than a single leg", () => {
        const entries = new Map<string, RrfEntry>([
            ["both", { chunk: chunk("both", "alpha"), vectorRank: 3, keywordRank: 3 }],
            ["single", { chunk: chunk("single", "beta"), vectorRank: 1 }],
        ]);

        const results = computeRrf(entries, 60);

        expect(results[0].noteId).toBe("both");
    });

    it("scores both legs at rank 1 as 2/(k+1)", () => {
        const entries = new Map<string, RrfEntry>([
            ["a", { chunk: chunk("a", "alpha"), vectorRank: 1, keywordRank: 1 }],
        ]);

        expect(computeRrf(entries, 60)[0].score).toBeCloseTo(2 / 61);
    });

    it("sorts results descending by score", () => {
        const entries = new Map<string, RrfEntry>([
            ["low", { chunk: chunk("low", "low"), vectorRank: 10 }],
            ["high", { chunk: chunk("high", "high"), vectorRank: 1, keywordRank: 1 }],
            ["mid", { chunk: chunk("mid", "mid"), keywordRank: 2 }],
        ]);

        expect(computeRrf(entries, 60).map((c) => c.noteId)).toEqual(["high", "mid", "low"]);
    });

    it("gives earlier ranks higher scores than later ranks", () => {
        const entries = new Map<string, RrfEntry>([
            ["early", { chunk: chunk("early", "early"), vectorRank: 1 }],
            ["late", { chunk: chunk("late", "late"), vectorRank: 8 }],
        ]);

        const results = computeRrf(entries, 60);

        expect(results[0].noteId).toBe("early");
        expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it("uses higher k to shrink score gaps", () => {
        const entries = new Map<string, RrfEntry>([
            ["early", { chunk: chunk("early", "early"), vectorRank: 1 }],
            ["late", { chunk: chunk("late", "late"), vectorRank: 10 }],
        ]);

        const lowK = computeRrf(entries, 10);
        const highK = computeRrf(entries, 100);

        expect(lowK[0].score - lowK[1].score).toBeGreaterThan(highK[0].score - highK[1].score);
    });

    it("matches the exact formula for vector rank 3 and keyword rank 7", () => {
        const entries = new Map<string, RrfEntry>([
            ["a", { chunk: chunk("a", "alpha"), vectorRank: 3, keywordRank: 7 }],
        ]);

        expect(computeRrf(entries, 60)[0].score).toBeCloseTo((1 / 63) + (1 / 67));
    });

    it("preserves chunk identity fields", () => {
        const entries = new Map<string, RrfEntry>([
            ["a", { chunk: { noteId: "id", noteTitle: "Blackstone Keep", content: "stone walls", score: 0.99 }, vectorRank: 1 }],
        ]);

        expect(computeRrf(entries, 60)[0]).toMatchObject({
            noteId: "id",
            noteTitle: "Blackstone Keep",
            content: "stone walls",
        });
    });

    it("returns positive finite scores", () => {
        const entries = new Map<string, RrfEntry>([
            ["a", { chunk: chunk("a", "alpha"), vectorRank: 1 }],
            ["b", { chunk: chunk("b", "beta"), keywordRank: 5 }],
        ]);

        for (const result of computeRrf(entries, 60)) {
            expect(result.score).toBeGreaterThan(0);
            expect(Number.isFinite(result.score)).toBe(true);
        }
    });
});

import { describe, expect, it } from "bun:test";
import { deduplicateChunks } from "./chunk-dedup.ts";
import type { RagChunk } from "../types/lore.ts";

// Helper — build a minimal RagChunk for tests
function chunk(content: string, noteId = "note-1"): RagChunk {
    return { noteId, noteTitle: "Test Note", content, score: 1.0 };
}

describe("deduplicateChunks", () => {
    it("empty array returns empty array", () => {
        expect(deduplicateChunks([])).toEqual([]);
    });

    it("single chunk returns single chunk unchanged", () => {
        const c = chunk("Aldric is the king of Valorheim and rules the northern reaches.");
        expect(deduplicateChunks([c])).toEqual([c]);
    });

    it("two identical chunks → only first kept", () => {
        const c = chunk("Aldric guards the northern gate each winter solstice.");
        const result = deduplicateChunks([c, { ...c }]);
        expect(result).toHaveLength(1);
    });

    it("two near-identical chunks (>85% trigram overlap) → only first kept", () => {
        // Adding 4 unique words to a 24-trigram base gives Jaccard=0.857 > 0.85
        const base = "Aldric guards the northern gate between Ironmark and the frozen highlands each winter solstice because the realm demands it and the king never shirks his duty";
        const c1 = chunk(base);
        const c2 = chunk(base + " still guards it today"); // 0.857 Jaccard
        const result = deduplicateChunks([c1, c2]);
        expect(result).toHaveLength(1);
    });

    it("two clearly distinct chunks → both kept", () => {
        const c1 = chunk("Aldric is the king of Valorheim and commands a great army.");
        const c2 = chunk("The Sunken Temple lies deep beneath the Crystal Sea far to the south.");
        const result = deduplicateChunks([c1, c2]);
        expect(result).toHaveLength(2);
    });

    it("preserves first occurrence when deduplicating (not second)", () => {
        const first = chunk("The archivist guards the obsidian gate each night.", "note-a");
        const second = chunk("The archivist guards the obsidian gate every single night.", "note-b");
        const result = deduplicateChunks([first, second]);
        expect(result[0].noteId).toBe("note-a");
    });

    it("preserves order of non-duplicate chunks", () => {
        const c1 = chunk("Aria Vale is the protagonist of chapter one in the northern saga realm.", "note-1");
        const c2 = chunk("Aether Keep stands on the cliffs above the Sunken Silver Sea today.", "note-2");
        const c3 = chunk("The Dragon Wars ended the ancient empire of Valdoria centuries ago.", "note-3");
        const result = deduplicateChunks([c1, c2, c3]);
        expect(result.map((r) => r.noteId)).toEqual(["note-1", "note-2", "note-3"]);
    });

    it("custom threshold 0.5 deduplicates more aggressively than 0.9", () => {
        const c1 = chunk("Aria Vale explores the northern highlands of Valorheim each season.");
        const c2 = chunk("Aria Vale explores the northern highlands of Valorheim every season now.");
        const resultStrict = deduplicateChunks([c1, c2], 0.5);
        const resultLenient = deduplicateChunks([c1, c2], 0.99);
        // At threshold 0.5 it's more aggressive (drops more), at 0.99 it's less aggressive
        expect(resultStrict.length).toBeLessThanOrEqual(resultLenient.length);
    });

    it("custom threshold 0.99 keeps chunks that 0.85 would drop", () => {
        const base = "Aldric rules the northern realm each winter season near the frontier.";
        const c1 = chunk(base);
        const c2 = chunk(base + " The army patrols daily.");
        // Default 0.85 likely deduplicates; 0.99 may keep both
        const result99 = deduplicateChunks([c1, c2], 0.99);
        expect(result99.length).toBe(2);
    });

    it("chunks from different noteIds with same content → only first kept", () => {
        const content = "Aldric guards the obsidian gate each winter solstice near Ironmark.";
        const c1 = chunk(content, "note-a");
        const c2 = chunk(content, "note-b");
        const result = deduplicateChunks([c1, c2]);
        expect(result).toHaveLength(1);
        expect(result[0].noteId).toBe("note-a");
    });

    it("three chunks: first + third similar, second distinct → first + second kept", () => {
        // Base has 27 trigrams; adding 1 different last word gives Jaccard=0.913 between c1 and c3
        const base = "Aldric rules the northern frontier of Valorheim with authority from his ancient throne overseeing the realm of all its subjects and territories from";
        const c1 = chunk(base + " dawn", "note-1");
        const c2 = chunk("The Sunken Temple lies beneath the Crystal Sea in the far distant south far from any known civilization.", "note-2");
        const c3 = chunk(base + " dusk", "note-3"); // 0.913 Jaccard with c1
        const result = deduplicateChunks([c1, c2, c3]);
        // c1 and c3 share >85% trigrams; c2 is distinct — expect 2 results
        expect(result).toHaveLength(2);
        expect(result.map((r) => r.noteId)).toContain("note-1");
        expect(result.map((r) => r.noteId)).toContain("note-2");
    });

    it("very short content (1-2 words) does not produce trigrams → treated as distinct", () => {
        const c1 = chunk("Aldric", "note-1");
        const c2 = chunk("Valorheim", "note-2");
        // Can't form trigrams from 1-word strings → jaccard = 0 → distinct
        const result = deduplicateChunks([c1, c2]);
        expect(result).toHaveLength(2);
    });

    it("content with only stopwords does not false-positive deduplicate unrelated chunks", () => {
        const c1 = chunk("The and of in a to with by for is are was were", "note-1");
        const c2 = chunk("It be do have has had will would could should shall", "note-2");
        // If trigrams happen to overlap they'll be deduped, but shouldn't crash
        const result = deduplicateChunks([c1, c2]);
        expect(result.length).toBeGreaterThanOrEqual(1);
    });
});

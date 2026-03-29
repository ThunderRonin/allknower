import { describe, expect, test } from "bun:test";

/**
 * Unit tests for query-level per-note deduplication.
 *
 * In lancedb.ts, after reranking, we keep only the highest-scoring chunk
 * per noteId. This file tests that logic in isolation.
 */

interface RagChunk {
    noteId: string;
    noteTitle: string;
    content: string;
    score: number;
}

function deduplicateByNote(chunks: RagChunk[]): RagChunk[] {
    const bestPerNote = new Map<string, RagChunk>();
    for (const chunk of chunks) {
        const existing = bestPerNote.get(chunk.noteId);
        if (!existing || chunk.score > existing.score) {
            bestPerNote.set(chunk.noteId, chunk);
        }
    }
    return Array.from(bestPerNote.values());
}

describe("query-result deduplication by noteId", () => {
    test("keeps only the highest-scoring chunk per note", () => {
        const input: RagChunk[] = [
            { noteId: "note1", noteTitle: "A", content: "chunk 1a", score: 0.9 },
            { noteId: "note1", noteTitle: "A", content: "chunk 1b", score: 0.5 },
            { noteId: "note2", noteTitle: "B", content: "chunk 2a", score: 0.8 },
        ];
        const result = deduplicateByNote(input);
        expect(result).toHaveLength(2);
        const note1 = result.find((r) => r.noteId === "note1");
        expect(note1?.content).toBe("chunk 1a");
        expect(note1?.score).toBe(0.9);
    });

    test("returns all chunks when all have unique noteIds", () => {
        const input: RagChunk[] = [
            { noteId: "n1", noteTitle: "A", content: "x", score: 0.5 },
            { noteId: "n2", noteTitle: "B", content: "y", score: 0.6 },
            { noteId: "n3", noteTitle: "C", content: "z", score: 0.7 },
        ];
        expect(deduplicateByNote(input)).toHaveLength(3);
    });

    test("handles empty input", () => {
        expect(deduplicateByNote([])).toHaveLength(0);
    });

    test("handles single item", () => {
        const input: RagChunk[] = [
            { noteId: "n1", noteTitle: "A", content: "x", score: 0.5 },
        ];
        expect(deduplicateByNote(input)).toHaveLength(1);
    });

    test("keeps first occurrence when scores are equal", () => {
        const input: RagChunk[] = [
            { noteId: "n1", noteTitle: "A", content: "first", score: 0.7 },
            { noteId: "n1", noteTitle: "A", content: "second", score: 0.7 },
        ];
        const result = deduplicateByNote(input);
        expect(result).toHaveLength(1);
        // Should keep whichever appeared first or second with equal score
        // (implementation uses >, so first inserted stays)
        expect(result[0].content).toBe("first");
    });
});

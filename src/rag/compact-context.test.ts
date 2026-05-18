import { describe, it, expect, mock } from "bun:test";

mock.module("../env.ts", () => ({
    env: {
        RAG_CONTEXT_MAX_TOKENS: 100,
        RAG_CHUNK_DEDUP_SIMILARITY_THRESHOLD: 0.85,
        RAG_CHUNK_SUMMARY_THRESHOLD_TOKENS: 50,
        OPENROUTER_API_KEY: "test",
        OPENROUTER_BASE_URL: "https://test",
        DATABASE_URL: "postgresql://localhost/test",
        NODE_ENV: "test",
    },
}));

mock.module("../logger.ts", () => ({
    rootLogger: { info: () => {}, warn: () => {}, error: () => {}, child: () => ({ info: () => {}, warn: () => {}, error: () => {} }) },
}));

mock.module("./chunk-compactor.ts", () => ({
    compactChunks: async (chunks: any[]) => chunks,
    compactChunk: async (chunk: any) => chunk,
}));

import { compactRagContext } from "./compact-context.ts";
import type { RagChunk } from "../types/lore.ts";

function makeChunk(id: string, content: string, score = 0.9): RagChunk {
    return { noteId: id, noteTitle: `Note ${id}`, content, score };
}

describe("compactRagContext", () => {
    it("returns empty array for empty input", async () => {
        expect(await compactRagContext([])).toEqual([]);
    });

    it("enforces token budget (Tier 1)", async () => {
        // Budget is 100 tokens (from env mock). Each chunk has varied prose
        // that should tokenize to ~40-60 tokens. With budget 100, at most 2
        // should be admitted.
        const chunks = [
            makeChunk("1", "The ancient dragon Malachar descended upon the village of Thornfield at the break of dawn, scattering the terrified villagers into the surrounding forests and hills.", 0.9),
            makeChunk("2", "Queen Seraphina of the Northern Reaches commanded her royal guard to fortify the castle walls against the incoming siege from the rebel alliance forces.", 0.8),
            makeChunk("3", "The Archmage Thessius discovered an ancient tome hidden deep within the catacombs beneath the grand library of the Obsidian Tower in the eastern district.", 0.7),
            makeChunk("4", "A mysterious merchant arrived at the crossroads tavern carrying exotic wares from distant lands beyond the Whispering Sea and the Crimson Desert wastes.", 0.6),
        ];
        const result = await compactRagContext(chunks, { skipSummarization: true });
        // With 100-token budget and ~40+ tokens per chunk, we should admit
        // fewer than all 4 chunks
        expect(result.length).toBeLessThan(chunks.length);
        expect(result.length).toBeGreaterThan(0);
    });

    it("deduplicates near-identical chunks (Tier 1.5)", async () => {
        const chunks = [
            makeChunk("1", "The dragon attacked the village at dawn.", 0.9),
            makeChunk("2", "The dragon attacked the village at dawn.", 0.8),
        ];
        const result = await compactRagContext(chunks, {
            maxTokens: 10000,
            skipSummarization: true,
        });
        expect(result.length).toBe(1);
    });

    it("respects per-task budget", async () => {
        // autocomplete has a 1000-token budget — this short chunk fits easily
        const chunks = [makeChunk("1", "A short lore fragment about a sword.", 0.9)];
        const result = await compactRagContext(chunks, {
            task: "autocomplete",
            skipSummarization: true,
        });
        expect(result.length).toBe(1);
    });

    it("skips Tier 2 when skipSummarization is true", async () => {
        const chunks = [makeChunk("1", "Short content", 0.9)];
        const result = await compactRagContext(chunks, {
            maxTokens: 10000,
            skipSummarization: true,
        });
        expect(result).toEqual(chunks);
    });

    it("uses maxTokens override over task budget", async () => {
        // autocomplete has 1000-token budget, but we override with 5000
        const chunks = [makeChunk("1", "A short lore fragment about a sword.", 0.9)];
        const result = await compactRagContext(chunks, {
            task: "autocomplete",
            maxTokens: 5000,
            skipSummarization: true,
        });
        expect(result.length).toBe(1);
    });

    it("falls back to env budget for unknown tasks", async () => {
        // No task specified, no maxTokens — should use env.RAG_CONTEXT_MAX_TOKENS (100)
        const chunks = [makeChunk("1", "A brief note.", 0.9)];
        const result = await compactRagContext(chunks, { skipSummarization: true });
        expect(result.length).toBe(1);
    });
});

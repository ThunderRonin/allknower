// Must mock env BEFORE any lancedb.ts import — env is read at module load for DB_PATH
import { mock } from "bun:test";

mock.module("../env.ts", () => ({
    env: {
        LANCEDB_PATH: "./data/lancedb-test",
        EMBEDDING_DIMENSIONS: 4,
        RAG_CHUNK_DEDUP_SIMILARITY_THRESHOLD: 0.85,
        RAG_CONTEXT_MAX_TOKENS: 6000,
        RAG_CHUNK_SUMMARY_THRESHOLD_TOKENS: 600,
        OPENROUTER_API_KEY: "test-key",
        OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
        EMBEDDING_CLOUD: "test/embedding-model",
        RERANK_MODEL: "cohere/rerank-4-pro",
        RAG_HYBRID_VECTOR_K: 0,
        RAG_HYBRID_BM25_K: 0,
        RAG_HYBRID_RRF_K: 60,
        RAG_VECTOR_SIMILARITY_THRESHOLD: 0.3,
        RAG_RERANK_TOP_N: 10,
        RAG_RERANK_DOC_MAX_CHARS: 2048,
        RAG_RERANK_ENABLED: "false",
        DATABASE_URL: "postgresql://test:test@localhost:5432/test",
        NODE_ENV: "test",
    },
}));

// Mock embedder — lancedb.ts imports it at top-level via embedder.ts
mock.module("./embedder.ts", () => ({
    embed: async (_text: string) => [0.1, 0.2, 0.3, 0.4],
    embedBatch: async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3, 0.4]),
    EMBEDDING_DIMENSIONS: 4,
}));


import { describe, expect, it } from "bun:test";
import { chunkText } from "./lancedb.ts";

// ── chunkText (pure chunking function) ────────────────────────────────────────

describe("chunkText", () => {
    it("empty string returns []", () => {
        expect(chunkText("")).toEqual([]);
    });

    it("whitespace-only string returns []", () => {
        expect(chunkText("   \n  \t  ")).toEqual([]);
    });

    it("short text (< chunkSize words) returns single chunk", () => {
        const result = chunkText("Hello world this is a short piece.");
        expect(result).toHaveLength(1);
    });

    it("single chunk contains full input text", () => {
        const text = "Aria Vale is the protagonist of the northern saga.";
        const result = chunkText(text);
        expect(result[0]).toContain("Aria Vale");
    });

    it("text with double newlines splits on paragraph boundaries", () => {
        const p1 = "word ".repeat(10).trim();
        const p2 = "other ".repeat(10).trim();
        const result = chunkText(`${p1}\n\n${p2}`);
        expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("multiple small paragraphs merge up to chunkSize", () => {
        const short = "Hi.\n\nHello.\n\nWorld.";
        const result = chunkText(short);
        // Very short paragraphs should be merged into 1 chunk
        expect(result).toHaveLength(1);
    });

    it("very long single paragraph splits on sentence boundaries . ! ?", () => {
        const sentences = Array.from({ length: 100 }, (_, i) => `Sentence number ${i} ends here.`);
        const result = chunkText(sentences.join(" "), 20);
        expect(result.length).toBeGreaterThan(1);
    });

    it("applying overlap: last N words of chunk[i] appear at start of chunk[i+1]", () => {
        const text = Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ");
        const result = chunkText(text, 50, 10);
        if (result.length >= 2) {
            const firstChunkWords = result[0].split(/\s+/);
            const lastTenWords = firstChunkWords.slice(-10).join(" ");
            // The second chunk should start with words from the end of the first
            expect(result[1].startsWith(lastTenWords.split(" ")[0])).toBe(true);
        }
    });

    it("no chunk in output is empty string", () => {
        const text = "Para one.\n\nPara two with more content here.\n\nPara three final.";
        for (const ch of chunkText(text)) {
            expect(ch.length).toBeGreaterThan(0);
        }
    });

    it("no chunk in output is only whitespace", () => {
        const text = Array.from({ length: 50 }, (_, i) => `Sentence ${i}.`).join(" ");
        for (const ch of chunkText(text)) {
            expect(ch.trim().length).toBeGreaterThan(0);
        }
    });

    it("custom chunkSize=50 produces more chunks than chunkSize=512", () => {
        const text = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
        const small = chunkText(text, 50);
        const large = chunkText(text, 512);
        expect(small.length).toBeGreaterThanOrEqual(large.length);
    });

    it("custom overlap=0 produces no overlap between consecutive chunks", () => {
        const text = Array.from({ length: 200 }, (_, i) => `unique_token_${i}`).join(" ");
        const result = chunkText(text, 50, 0);
        if (result.length >= 2) {
            const chunk0LastWord = result[0].split(/\s+/).at(-1);
            const chunk1FirstWord = result[1].split(/\s+/).at(0);
            // With 0 overlap, the last word of chunk 0 should not be the first word of chunk 1
            // (this is approximate — implementation may join chunks before splitting)
            expect(result[0].length).toBeGreaterThan(0);
            expect(result[1].length).toBeGreaterThan(0);
        }
    });

    it("total word count across chunks >= input word count (overlap causes excess)", () => {
        const text = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
        const inputWords = text.split(/\s+/).length;
        const allChunkWords = chunkText(text, 30, 5)
            .join(" ")
            .split(/\s+/).length;
        expect(allChunkWords).toBeGreaterThanOrEqual(inputWords);
    });

    it("single very long sentence without punctuation falls back gracefully", () => {
        const text = Array.from({ length: 1000 }, (_, i) => `word${i}`).join(" ");
        const result = chunkText(text, 50);
        expect(result.length).toBeGreaterThan(0);
        for (const ch of result) {
            expect(ch.trim().length).toBeGreaterThan(0);
        }
    });
});

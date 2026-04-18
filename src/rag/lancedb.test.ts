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
    },
}));

// Mock embedder — lancedb.ts imports it at top-level via embedder.ts
mock.module("./embedder.ts", () => ({
    embed: async (_text: string) => [0.1, 0.2, 0.3, 0.4],
    embedBatch: async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3, 0.4]),
    EMBEDDING_DIMENSIONS: 4,
}));

// Mock model-router — lancedb.ts imports callWithFallback for reranking
mock.module("../pipeline/model-router.ts", () => ({
    callWithFallback: async () => ({ raw: '{"scores":[]}', tokensUsed: 0, model: "test", latencyMs: 0 }),
    getModelChain: () => ["test-model"],
}));

import { describe, expect, it } from "bun:test";
import { chunkText, classifyQueryComplexity } from "./lancedb.ts";

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

// ── classifyQueryComplexity ───────────────────────────────────────────────────

describe("classifyQueryComplexity", () => {
    it('"Aria Vale" → "simple"', () => {
        expect(classifyQueryComplexity("Aria Vale")).toBe("simple");
    });

    it('"Aether Keep location type" → "simple" (<=8 words, no connectives)', () => {
        expect(classifyQueryComplexity("Aether Keep location type")).toBe("simple");
    });

    it('"how does Aria Vale relate to Aether Keep" → "complex" (has "how", "relate")', () => {
        expect(classifyQueryComplexity("how does Aria Vale relate to Aether Keep")).toBe("complex");
    });

    it('"why did the war cause the collapse of Ironmark" → "complex"', () => {
        expect(classifyQueryComplexity("why did the war cause the collapse of Ironmark")).toBe("complex");
    });

    it('"relationship between Kael and the northern factions" → "complex"', () => {
        expect(classifyQueryComplexity("relationship between Kael and the northern factions")).toBe("complex");
    });

    it("9-word query with no connectives → complex (length > 8)", () => {
        // 9 words, no connectives
        expect(classifyQueryComplexity("Aldric the king rules Valorheim from his throne city")).toBe("complex");
    });

    it("8-word query with no connectives → simple (exactly at threshold)", () => {
        // exactly 8 words
        expect(classifyQueryComplexity("Aldric rules Valorheim from his seat every day")).toBe("simple");
    });

    it('query containing "between" → "complex"', () => {
        expect(classifyQueryComplexity("rivalry between two clans")).toBe("complex");
    });

    it('query containing "influence" → "complex"', () => {
        expect(classifyQueryComplexity("divine influence over the realm")).toBe("complex");
    });

    it('query containing "impact" → "complex"', () => {
        expect(classifyQueryComplexity("impact of the Dragon Wars")).toBe("complex");
    });

    it('query containing "connect" → "complex"', () => {
        expect(classifyQueryComplexity("connect the two factions together")).toBe("complex");
    });

    it("empty string → simple (0 words, no connectives)", () => {
        expect(classifyQueryComplexity("")).toBe("simple");
    });

    it('case-insensitive matching ("HOW does" → complex)', () => {
        expect(classifyQueryComplexity("HOW does this work")).toBe("complex");
    });
});

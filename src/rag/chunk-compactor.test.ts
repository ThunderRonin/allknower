import { mock } from "bun:test";

mock.module("../env.ts", () => ({
    env: {
        RAG_CHUNK_SUMMARY_THRESHOLD_TOKENS: 600,
        OPENROUTER_API_KEY: "test",
        LLM_TIMEOUT_MS: 5000,
        OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    },
}));

const mockCallWithFallback = mock(async () => ({
    raw: "A brief summary of the lore entry.",
    tokensUsed: 50,
    model: "test-model",
    latencyMs: 100,
}));

mock.module("../pipeline/model-router.ts", () => ({
    callWithFallback: mockCallWithFallback,
    getModelChain: () => ["test-model"],
}));

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { compactChunk, compactChunks } from "./chunk-compactor.ts";
import type { RagChunk } from "../types/lore.ts";

function chunk(content: string, noteTitle = "Test Note", noteId = "note-1"): RagChunk {
    return { noteId, noteTitle, content, score: 1.0 };
}

beforeEach(() => {
    mockCallWithFallback.mockClear();
    mockCallWithFallback.mockResolvedValue({
        raw: "A brief summary of the lore entry.",
        tokensUsed: 50,
        model: "test-model",
        latencyMs: 100,
    });
});

describe("compactChunk", () => {
    it("returns chunk unchanged when token count <= threshold", async () => {
        // Short content — well under 600-token threshold
        const c = chunk("Aldric is the king.");
        const result = await compactChunk(c);
        expect(result.content).toBe("Aldric is the king.");
        expect(mockCallWithFallback).not.toHaveBeenCalled();
    });

    it('calls callWithFallback("compact", ...) when token count > threshold', async () => {
        // Generate content long enough to exceed threshold (~600 tokens ≈ 2100+ chars)
        const longContent = "word ".repeat(700).trim(); // ~700 words / ~700 tokens
        const c = chunk(longContent);
        await compactChunk(c);
        expect(mockCallWithFallback).toHaveBeenCalledWith(
            "compact",
            expect.any(Array),
            expect.any(Object)
        );
    });

    it("returns chunk with summarized content when LLM succeeds", async () => {
        const longContent = "word ".repeat(700).trim();
        const c = chunk(longContent);
        const result = await compactChunk(c);
        expect(result.content).toBe("A brief summary of the lore entry.");
    });

    it('appends "[summarized]" to noteTitle on summary', async () => {
        const longContent = "word ".repeat(700).trim();
        const c = chunk(longContent, "Aldric the King");
        const result = await compactChunk(c);
        expect(result.noteTitle).toBe("Aldric the King [summarized]");
    });

    it("returns original chunk unchanged when LLM throws (never propagates error)", async () => {
        mockCallWithFallback.mockRejectedValue(new Error("LLM failed"));
        // Use unique content that wasn't seen in any prior test to bypass cache
        const longContent = "unique_throw_test_prefix " + "word ".repeat(700).trim();
        const c = chunk(longContent);
        const result = await compactChunk(c);
        expect(result.content).toBe(longContent);
    });

    it("caches summary: second call with same content does not call LLM again", async () => {
        const longContent = "unique_cache_test_content " + "word ".repeat(700).trim();
        const c = chunk(longContent);
        await compactChunk(c); // First call — LLM
        await compactChunk(c); // Second call — cache hit
        expect(mockCallWithFallback).toHaveBeenCalledTimes(1);
    });

    it("LLM response is trimmed before storing", async () => {
        mockCallWithFallback.mockResolvedValue({
            raw: "  Trimmed summary.  ",
            tokensUsed: 10,
            model: "test",
            latencyMs: 10,
        });
        const longContent = "unique_trim_test " + "word ".repeat(700).trim();
        const c = chunk(longContent);
        const result = await compactChunk(c);
        expect(result.content).toBe("Trimmed summary.");
    });
});

describe("compactChunks", () => {
    it("returns empty array for empty input", async () => {
        const result = await compactChunks([]);
        expect(result).toEqual([]);
    });

    it("processes all chunks", async () => {
        const chunks = [
            chunk("Short.", "Note 1", "note-1"),
            chunk("Also short.", "Note 2", "note-2"),
        ];
        const result = await compactChunks(chunks);
        expect(result).toHaveLength(2);
    });

    it("one chunk failure does not affect other chunks", async () => {
        // First call succeeds, subsequent may fail — but each is isolated
        mockCallWithFallback
            .mockRejectedValueOnce(new Error("LLM failed"))
            .mockResolvedValue({ raw: "Summary.", tokensUsed: 10, model: "test", latencyMs: 10 });

        const longContent = "word ".repeat(700).trim();
        const chunks = [
            chunk(longContent, "Note 1", "note-1"),
            chunk(longContent + " extra", "Note 2", "note-2"),
        ];
        // Should not throw
        const result = await compactChunks(chunks);
        expect(result).toHaveLength(2);
    });

    it("small chunks (below threshold) are returned unchanged without LLM call", async () => {
        const chunks = [
            chunk("Tiny chunk.", "Note 1"),
            chunk("Also tiny.", "Note 2"),
        ];
        await compactChunks(chunks);
        expect(mockCallWithFallback).not.toHaveBeenCalled();
    });

    it("mixed: some chunks compact, some pass through", async () => {
        const longContent = "word ".repeat(700).trim();
        const chunks = [
            chunk("Short.", "Note 1", "note-1"),
            chunk(longContent, "Note 2", "note-2"),
        ];
        const result = await compactChunks(chunks);
        expect(result[0].content).toBe("Short.");
        expect(result[1].content).toBe("A brief summary of the lore entry.");
    });
});

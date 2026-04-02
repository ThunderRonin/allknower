import { createHash } from "crypto";
import pLimit from "p-limit";
import type { RagChunk } from "../types/lore.ts";
import { env } from "../env.ts";
import { countTokens } from "../utils/tokens.ts";
import { callWithFallback } from "../pipeline/model-router.ts";
import { rootLogger } from "../logger.ts";

/**
 * Tier 2 — Chunk summarization for oversized RAG chunks.
 *
 * After Tier 1 budget enforcement, some admitted chunks might still be huge —
 * a 2,500-token location entry eats 40% of the budget for one entity.
 * Summarize anything over the threshold to its semantic essence.
 *
 * Uses the cheapest/fastest model (Haiku tier). The static system prompt
 * means it cache-hits on every call.
 */

// ── LRU Summary Cache ─────────────────────────────────────────────────────────

const summaryCache = new Map<string, { summary: string; cachedAt: number }>();
const CACHE_MAX_SIZE = 200;
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

function contentHash(content: string): string {
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function getCachedSummary(content: string): string | null {
    const hash = contentHash(content);
    const entry = summaryCache.get(hash);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
        summaryCache.delete(hash);
        return null;
    }
    return entry.summary;
}

function setCachedSummary(content: string, summary: string): void {
    const hash = contentHash(content);
    // Evict oldest entry if at capacity
    if (summaryCache.size >= CACHE_MAX_SIZE) {
        const oldestKey = summaryCache.keys().next().value;
        if (oldestKey) summaryCache.delete(oldestKey);
    }
    summaryCache.set(hash, { summary, cachedAt: Date.now() });
}

// ── Static compaction prompt (cache-friendly) ─────────────────────────────────

const COMPACT_SYSTEM = `You are a lore archivist for a fantasy worldbuilding grimoire.
Summarize the following lore entry into 3-4 sentences preserving:
- entity name and type (character, location, faction, event, etc.)
- key relationships to other named entities
- most important mechanical/narrative facts
- any unresolved contradictions or open questions
Omit backstory, flavor text, and secondary details.
Output plain prose only — no markdown, no headers.`;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Summarize a single RAG chunk if it exceeds the token threshold.
 * Returns the chunk unchanged if it's small enough or on failure.
 */
export async function compactChunk(chunk: RagChunk): Promise<RagChunk> {
    const tokens = countTokens(chunk.content);

    // Fast path: small enough, no compaction needed
    if (tokens <= env.RAG_CHUNK_SUMMARY_THRESHOLD_TOKENS) {
        return chunk;
    }

    // Cache path: already summarized this content
    const cached = getCachedSummary(chunk.content);
    if (cached) {
        return { ...chunk, content: cached, noteTitle: `${chunk.noteTitle} [summarized]` };
    }

    // Slow path: LLM summarization
    try {
        const messages: Array<{ role: "system" | "user"; content: string }> = [
            { role: "system", content: COMPACT_SYSTEM },
            { role: "user", content: chunk.content },
        ];

        const { raw } = await callWithFallback("compact", messages, {
            maxTokens: 512,
            temperature: 0.1,
        });

        const summary = raw.trim();
        setCachedSummary(chunk.content, summary);

        return { ...chunk, content: summary, noteTitle: `${chunk.noteTitle} [summarized]` };
    } catch (error) {
        // Never let compaction failure break the brain-dump pipeline
        rootLogger.warn("Chunk compaction failed, using original", {
            noteTitle: chunk.noteTitle,
            noteId: chunk.noteId,
            error: error instanceof Error ? error.message : String(error),
        });
        return chunk;
    }
}

/**
 * Summarize oversized chunks in parallel with concurrency control.
 * Each chunk is error-isolated — one failure doesn't block the rest.
 */
export async function compactChunks(
    chunks: RagChunk[],
    concurrency: number = 3,
): Promise<RagChunk[]> {
    const limit = pLimit(concurrency);
    return Promise.all(
        chunks.map((chunk) => limit(() => compactChunk(chunk))),
    );
}

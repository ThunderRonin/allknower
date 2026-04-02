import type { RagChunk } from "../types/lore.ts";
import { env } from "../env.ts";

/**
 * Tier 1.5 — Semantic deduplication for near-duplicate RAG chunks.
 *
 * Overlapping chunking strategies produce near-identical content. Two chunks
 * from the same long note with 70% overlap both get admitted, wasting budget.
 * The reranker doesn't catch this because both are independently relevant.
 *
 * Uses trigram Jaccard similarity — fast, no LLM calls, no embeddings.
 */

export function deduplicateChunks(
    chunks: RagChunk[],
    similarityThreshold: number = env.RAG_CHUNK_DEDUP_SIMILARITY_THRESHOLD,
): RagChunk[] {
    if (chunks.length <= 1) return chunks;

    const seen: RagChunk[] = [];
    const seenTrigrams: Set<string>[] = [];

    for (const chunk of chunks) {
        const chunkTri = trigrams(chunk.content);
        let isDuplicate = false;

        for (const existingTri of seenTrigrams) {
            if (jaccardSimilarity(chunkTri, existingTri) >= similarityThreshold) {
                isDuplicate = true;
                break;
            }
        }

        if (!isDuplicate) {
            seen.push(chunk);
            seenTrigrams.push(chunkTri);
        }
    }

    return seen;
}

function trigrams(text: string): Set<string> {
    const words = text.toLowerCase().split(/\s+/);
    const result = new Set<string>();
    for (let i = 0; i < words.length - 2; i++) {
        result.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }
    return result;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    let intersection = 0;
    for (const item of a) {
        if (b.has(item)) intersection++;
    }
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

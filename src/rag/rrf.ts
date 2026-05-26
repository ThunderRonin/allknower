import type { RagChunk } from "../types/lore.ts";

export interface RrfEntry {
    chunk: RagChunk;
    vectorRank?: number;
    keywordRank?: number;
}

export function computeRrf(
    entries: Map<string, RrfEntry>,
    rrfK: number
): RagChunk[] {
    const results: RagChunk[] = [];

    entries.forEach((info) => {
        let score = 0;
        if (info.vectorRank !== undefined) score += 1 / (rrfK + info.vectorRank);
        if (info.keywordRank !== undefined) score += 1 / (rrfK + info.keywordRank);
        results.push({ ...info.chunk, score });
    });

    return results.sort((a, b) => b.score - a.score);
}

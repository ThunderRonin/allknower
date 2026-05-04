import * as lancedb from "@lancedb/lancedb";
import { embed, embedBatch, EMBEDDING_DIMENSIONS } from "./embedder.ts";
import type { RagChunk } from "../types/lore.ts";
import { env } from "../env.ts";
import { rootLogger } from "../logger.ts";
import { mkdirSync } from "node:fs";

const TABLE_NAME = "lore_embeddings";

let _db: lancedb.Connection | null = null;
let _table: lancedb.Table | null = null;

/** For testing only — resets the singleton connection so the next
 *  getTable() call creates a fresh DB at the current LANCEDB_PATH. */
export function _resetConnection(): void {
    _db = null;
    _table = null;
}

/**
 * Get (or create) the LanceDB connection and lore_embeddings table.
 * LanceDB is embedded — no separate server needed.
 *
 * Reads env.LANCEDB_PATH dynamically so that _resetConnection() followed by
 * a mock.module("../env.ts", …) change in tests picks up the new path.
 */
export async function getTable(): Promise<lancedb.Table> {
    if (_table) return _table;

    const dbPath = env.LANCEDB_PATH;
    // Ensure the directory exists before LanceDB tries to connect
    mkdirSync(dbPath, { recursive: true });
    _db = await lancedb.connect(dbPath);

    const existingTables = await _db.tableNames();

    if (existingTables.includes(TABLE_NAME)) {
        _table = await _db.openTable(TABLE_NAME);
    } else {
        // Create table with schema inferred from a seed record
        _table = await _db.createTable(TABLE_NAME, [
            {
                noteId: "__seed__",
                noteTitle: "__seed__",
                chunkIndex: 0,
                content: "__seed__",
                vector: new Array(EMBEDDING_DIMENSIONS).fill(0),
            },
        ]);
        // Remove the seed record
        await _table.delete(`noteId = '${sanitizeFilterValue("__seed__")}'`);
    }

    return _table;
}

/**
 * Upsert lore chunks for a note.
 * Deletes existing chunks for the noteId, then inserts new ones.
 */
export async function upsertNoteChunks(
    noteId: string,
    noteTitle: string,
    chunks: string[]
): Promise<void> {
    const table = await getTable();

    // Remove existing chunks for this note
    await table.delete(`noteId = '${sanitizeFilterValue(noteId)}'`);

    if (chunks.length === 0) return;

    // True batch embed — single API call for all chunks
    const vectors = await embedBatch(chunks);

    const records = chunks.map((content, chunkIndex) => ({
        noteId,
        noteTitle,
        chunkIndex,
        content,
        vector: vectors[chunkIndex],
    }));

    await table.add(records);
}

/**
 * Rerank candidates via the native OpenRouter /rerank endpoint.
 * Uses a purpose-built reranking model (e.g. cohere/rerank-4-pro) which is
 * faster and more accurate than both the local Xenova cross-encoder (which
 * was broken on Bun) and the LLM-as-a-Judge approach (which was slow).
 *
 * Falls back gracefully to base vector similarity on any error.
 */
async function rerankWithOpenRouter(
    query: string,
    candidates: RagChunk[]
): Promise<RagChunk[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    try {
        const response = await fetch(`${env.OPENROUTER_BASE_URL}/rerank`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://allknower.local",
                "X-OpenRouter-Title": "AllKnower",
            },
            body: JSON.stringify({
                model: env.RERANK_MODEL,
                query,
                documents: candidates.map(c => c.content.slice(0, 512)),
                top_n: candidates.length,
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            const body = await response.text().catch(() => "");
            rootLogger.warn("OpenRouter rerank returned non-200", {
                status: response.status,
                body: body.slice(0, 200),
            });
            return candidates;
        }

        const data = await response.json() as {
            results: Array<{ index: number; relevance_score: number }>;
        };

        if (!data.results?.length) {
            rootLogger.warn("OpenRouter rerank returned empty results");
            return candidates;
        }

        return data.results
            .map(r => ({
                ...candidates[r.index],
                score: r.relevance_score,
            }))
            .sort((a, b) => b.score - a.score);
    } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") {
            rootLogger.warn("OpenRouter rerank timed out after 30s");
        } else {
            rootLogger.warn("OpenRouter rerank failed", {
                error: e instanceof Error ? e.message : String(e),
            });
        }
        return candidates;
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Semantic similarity search — returns top-k most relevant lore chunks.
 *
 * Uses OpenRouter's native rerank endpoint (cohere/rerank-4-pro) for
 * second-pass relevance scoring after initial vector similarity retrieval.
 */
export async function queryLore(
    queryText: string,
    topK: number = 10,
    options?: { includeNoteIds?: string[] }
): Promise<RagChunk[]> {
    const table = await getTable();
    const queryVector = await embed(queryText);

    // 1. Initial retrieval — grab a larger pool for reranking
    const RETRIEVAL_MULTIPLIER = 3;
    const initialResults = await table
        .vectorSearch(queryVector)
        .distanceType("cosine")
        .limit(topK * RETRIEVAL_MULTIPLIER)
        .select(["noteId", "noteTitle", "content", "_distance"])
        .toArray();

    // 2. Base similarity threshold (filter out immediate junk)
    const SIMILARITY_THRESHOLD = 0.3;
    const rawCandidates: RagChunk[] = initialResults.map((row: any) => ({
        noteId: row.noteId as string,
        noteTitle: row.noteTitle as string,
        content: row.content as string,
        score: 1 - (row._distance as number),
    }));
    let candidates = rawCandidates.filter(chunk => chunk.score >= SIMILARITY_THRESHOLD);

    // Apply allowlist filter if provided (e.g. "only search within statblock notes")
    if (options?.includeNoteIds && options.includeNoteIds.length > 0) {
        const allowlist = new Set(options.includeNoteIds);
        candidates = candidates.filter(c => allowlist.has(c.noteId));
    }

    rootLogger.info("queryLore threshold filter", {
        query: queryText.slice(0, 60),
        retrieved: initialResults.length,
        passedThreshold: candidates.length,
        threshold: SIMILARITY_THRESHOLD,
        topScore: rawCandidates[0]?.score?.toFixed(4),
        topDistance: initialResults[0] ? (initialResults[0] as any)._distance?.toFixed(4) : undefined,
    });

    if (candidates.length === 0) {
        rootLogger.warn("queryLore: all candidates below threshold", {
            query: queryText.slice(0, 60),
            retrieved: initialResults.length,
            threshold: SIMILARITY_THRESHOLD,
            topScore: rawCandidates[0]?.score?.toFixed(4),
        });
        return [];
    }

    // 3. Rerank via OpenRouter native rerank endpoint
    try {
        candidates = await rerankWithOpenRouter(queryText, candidates);
        rootLogger.info("Reranking complete", {
            strategy: "OpenRouter native rerank",
            model: env.RERANK_MODEL,
            query: queryText.slice(0, 60),
        });
    } catch (e: unknown) {
        rootLogger.warn("Reranking failed, falling back to base vector similarity", {
            error: e instanceof Error ? e.message : String(e),
        });
    }

    // 4. Deduplicate: group by noteId, keep highest-scoring chunk per note
    const bestPerNote = new Map<string, RagChunk>();
    for (const chunk of candidates) {
        const existing = bestPerNote.get(chunk.noteId);
        if (!existing || chunk.score > existing.score) {
            bestPerNote.set(chunk.noteId, chunk);
        }
    }
    candidates = Array.from(bestPerNote.values())
        .sort((a, b) => b.score - a.score);

    return candidates.slice(0, topK);
}

/**
 * Delete all chunks for a note (e.g. when note is deleted in AllCodex).
 */
export async function deleteNoteChunks(noteId: string): Promise<void> {
    const table = await getTable();
    await table.delete(`noteId = '${sanitizeFilterValue(noteId)}'`);
}

/**
 * Health check — verify LanceDB is accessible and table exists.
 */
export async function checkLanceDbHealth(): Promise<{ ok: boolean; error?: string }> {
    try {
        const table = await getTable();
        const count = await table.countRows();
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
}

/**
 * Sanitize a string value for use in LanceDB filter expressions.
 * AllCodex noteIds are cuid-format (alphanumeric + hyphens/underscores).
 * Throws on any input that looks like an injection attempt.
 */
function sanitizeFilterValue(value: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
        throw new Error(`Invalid filter value format: "${value}"`);
    }
    // Belt-and-suspenders: escape single quotes even though the pattern above
    // already rejects them — makes intent explicit.
    return value.replace(/'/g, "''");
}

/**
 * Semantic chunking — splits on structural boundaries first, then
 * windows within large paragraphs.
 *
 * Strategy:
 * 1. Split on double-newlines (paragraphs / section breaks)
 * 2. For paragraphs that exceed chunkSize, split on sentence boundaries
 * 3. Merge small adjacent paragraphs up to chunkSize
 * 4. Apply overlap between resulting chunks
 */
export function chunkText(text: string, chunkSize: number = 512, overlap: number = 64): string[] {
    const paragraphs = text
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

    if (paragraphs.length === 0) return [];

    // Split oversized paragraphs on sentence boundaries
    const segments: string[] = [];
    for (const para of paragraphs) {
        const words = para.split(/\s+/);
        if (words.length <= chunkSize) {
            segments.push(para);
        } else {
            // Split on sentence endings (. ! ? followed by space or end)
            const sentences = para.split(/(?<=[.!?])\s+/);
            let buffer: string[] = [];
            let bufferWordCount = 0;

            for (const sentence of sentences) {
                const sentenceWords = sentence.split(/\s+/).length;
                if (bufferWordCount + sentenceWords > chunkSize && buffer.length > 0) {
                    segments.push(buffer.join(" "));
                    const overlapText = buffer.join(" ").split(/\s+/).slice(-overlap);
                    buffer = [overlapText.join(" "), sentence];
                    bufferWordCount = overlapText.length + sentenceWords;
                } else {
                    buffer.push(sentence);
                    bufferWordCount += sentenceWords;
                }
            }
            if (buffer.length > 0) segments.push(buffer.join(" "));
        }
    }

    // Merge small adjacent segments up to chunkSize
    const chunks: string[] = [];
    let current: string[] = [];
    let currentWords = 0;

    for (const segment of segments) {
        const segWords = segment.split(/\s+/).length;
        if (currentWords + segWords > chunkSize && current.length > 0) {
            chunks.push(current.join("\n\n"));
            const overlapWords = current.join("\n\n").split(/\s+/).slice(-overlap);
            current = [overlapWords.join(" "), segment];
            currentWords = overlapWords.length + segWords;
        } else {
            current.push(segment);
            currentWords += segWords;
        }
    }
    if (current.length > 0) chunks.push(current.join("\n\n"));

    return chunks;
}

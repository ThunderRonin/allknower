import * as lancedb from "@lancedb/lancedb";
import { embed, embedBatch, EMBEDDING_DIMENSIONS } from "./embedder.ts";
import { computeRrf, type RrfEntry } from "./rrf.ts";
import type { RagChunk } from "../types/lore.ts";
import { env } from "../env.ts";
import { rootLogger } from "../logger.ts";
import { mkdirSync } from "node:fs";

const TABLE_NAME = "lore_embeddings";

let _db: lancedb.Connection | null = null;
let _table: lancedb.Table | null = null;
let _ftsIndexHealthy: boolean = true;

/** For testing only — resets the singleton connection so the next
 *  getTable() call creates a fresh DB at the current LANCEDB_PATH. */
export function _resetConnection(): void {
    _db = null;
    _table = null;
    _ftsIndexHealthy = true;
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
        try {
            // Verify schema by running a dummy search with userId filter.
            // If the schema does not have the userId column, this will throw.
            await _table.vectorSearch(new Array(EMBEDDING_DIMENSIONS).fill(0))
                .where("userId = '__test_schema__'")
                .limit(1)
                .toArray();
        } catch (e: any) {
            rootLogger.info("LanceDB schema mismatch or old schema detected. Recreating table...", { error: e.message });
            await _db.dropTable(TABLE_NAME);
            _table = null;
            return getTable();
        }
    } else {
        // Create table with schema inferred from a seed record containing new columns
        _table = await _db.createTable(TABLE_NAME, [
            {
                noteId: "__seed__",
                noteTitle: "__seed__",
                userId: "__seed__",
                loreType: "__seed__",
                labels: ["__seed__"],
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
    chunks: string[],
    userId: string = "default",
    options?: { loreType?: string; labels?: string[] }
): Promise<void> {
    const table = await getTable();

    // Remove existing chunks for this note for this user
    await table.delete(`noteId = '${sanitizeFilterValue(noteId)}' AND userId = '${sanitizeFilterValue(userId)}'`);

    if (chunks.length === 0) return;

    // True batch embed — single API call for all chunks
    const vectors = await embedBatch(chunks);

    const records = chunks.map((content, chunkIndex) => ({
        noteId,
        noteTitle,
        userId,
        loreType: options?.loreType ?? "",
        labels: options?.labels ?? [],
        chunkIndex,
        content,
        vector: vectors[chunkIndex],
    }));

    await table.add(records);

    try {
        // Recreate FTS index on the content column so that the text search works
        await table.createIndex("content", { config: lancedb.Index.fts(), replace: true });
        _ftsIndexHealthy = true;
    } catch (e: any) {
        _ftsIndexHealthy = false;
        rootLogger.warn("Failed to recreate FTS index on content", { error: e.message });
    }
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
): Promise<{ success: boolean; candidates: RagChunk[] }> {
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
                documents: candidates.map(c => c.content.slice(0, env.RAG_RERANK_DOC_MAX_CHARS)),
                top_n: Math.min(candidates.length, env.RAG_RERANK_TOP_N),
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            const body = await response.text().catch(() => "");
            rootLogger.warn("OpenRouter rerank returned non-200", {
                status: response.status,
                body: body.slice(0, 200),
            });
            return { success: false, candidates };
        }

        const data = await response.json() as {
            results: Array<{ index: number; relevance_score: number }>;
        };

        if (!data.results?.length) {
            rootLogger.warn("OpenRouter rerank returned empty results");
            return { success: false, candidates };
        }

        const rerankedCandidates = data.results
            .map(r => ({
                ...candidates[r.index],
                score: r.relevance_score,
            }))
            .sort((a, b) => b.score - a.score);

        return { success: true, candidates: rerankedCandidates };
    } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") {
            rootLogger.warn("OpenRouter rerank timed out after 30s");
        } else {
            rootLogger.warn("OpenRouter rerank failed", {
                error: e instanceof Error ? e.message : String(e),
            });
        }
        return { success: false, candidates };
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
    options?: { userId?: string; loreType?: string; includeNoteIds?: string[] }
): Promise<RagChunk[]> {
    const table = await getTable();
    const queryVector = await embed(queryText);

    const vectorRetrievalK = env.RAG_HYBRID_VECTOR_K > 0
        ? env.RAG_HYBRID_VECTOR_K
        : topK * 3;
    const bm25RetrievalK = env.RAG_HYBRID_BM25_K > 0
        ? env.RAG_HYBRID_BM25_K
        : topK * 3;

    const filterParts: string[] = [];
    if (options?.userId) {
        filterParts.push(`userId = '${sanitizeFilterValue(options.userId)}'`);
    }
    if (options?.loreType) {
        filterParts.push(`loreType = '${sanitizeFilterValue(options.loreType)}'`);
    }
    const filterStr = filterParts.length > 0 ? filterParts.join(" AND ") : undefined;

    // 1a. Vector Search
    let vectorQueryBuilder = table
        .vectorSearch(queryVector)
        .distanceType("cosine")
        .limit(vectorRetrievalK)
        .select(["noteId", "noteTitle", "content", "_distance"]);
    if (filterStr) {
        vectorQueryBuilder = vectorQueryBuilder.where(filterStr);
    }
    const vectorResults = await vectorQueryBuilder.toArray();

    const SIMILARITY_THRESHOLD = env.RAG_VECTOR_SIMILARITY_THRESHOLD;
    const vectorCandidates: RagChunk[] = vectorResults
        .map((row: any) => ({
            noteId: row.noteId as string,
            noteTitle: row.noteTitle as string,
            content: row.content as string,
            score: 1 - (row._distance as number),
        }))
        // Filter out immediate vector search noise
        .filter(chunk => chunk.score >= SIMILARITY_THRESHOLD);

    // 1b. Full-Text Search (FTS Keyword Search)
    let ftsResults: any[] = [];
    try {
        let ftsQueryBuilder = table
            .search(queryText)
            .limit(bm25RetrievalK)
            .select(["noteId", "noteTitle", "content"]);
        if (filterStr) {
            ftsQueryBuilder = ftsQueryBuilder.where(filterStr);
        }
        ftsResults = await ftsQueryBuilder.toArray();
    } catch (e: any) {
        rootLogger.warn("FTS keyword search failed", { error: e.message });
    }

    const ftsCandidates: RagChunk[] = ftsResults.map((row: any) => ({
        noteId: row.noteId as string,
        noteTitle: row.noteTitle as string,
        content: row.content as string,
        score: 0.0, // Rank-based merged score will override this
    }));

    // 2. Merge candidates using Reciprocal Rank Fusion (RRF)
    const rrfScores = new Map<string, RrfEntry>();

    vectorCandidates.forEach((c, idx) => {
        const key = `${c.noteId}::${c.content}`;
        rrfScores.set(key, {
            chunk: c,
            vectorRank: idx + 1,
        });
    });

    ftsCandidates.forEach((c, idx) => {
        const key = `${c.noteId}::${c.content}`;
        const existing = rrfScores.get(key);
        if (existing) {
            existing.keywordRank = idx + 1;
        } else {
            rrfScores.set(key, {
                chunk: c,
                keywordRank: idx + 1,
            });
        }
    });

    let candidates = computeRrf(rrfScores, env.RAG_HYBRID_RRF_K);

    // Limit to rerank pool size
    candidates = candidates.slice(0, env.RAG_RERANK_TOP_N);

    // Apply includeNoteIds allowlist filter if provided
    if (options?.includeNoteIds && options.includeNoteIds.length > 0) {
        const allowlist = new Set(options.includeNoteIds);
        candidates = candidates.filter(c => allowlist.has(c.noteId));
    }

    rootLogger.info("queryLore hybrid search retrieval complete", {
        query: queryText.slice(0, 60),
        vectorRetrievedCount: vectorCandidates.length,
        ftsRetrievedCount: ftsCandidates.length,
        mergedCandidateCount: candidates.length,
        vectorRetrievalK,
        bm25RetrievalK,
        rrfK: env.RAG_HYBRID_RRF_K,
        rerankEnabled: env.RAG_RERANK_ENABLED !== "false",
        rerankTopN: env.RAG_RERANK_TOP_N,
    });

    if (candidates.length === 0) {
        return [];
    }

    // 3. Rerank via OpenRouter native rerank endpoint
    let reranked = false;
    if (env.RAG_RERANK_ENABLED !== "false") {
        try {
            const rerankResult = await rerankWithOpenRouter(queryText, candidates);
            candidates = rerankResult.candidates;
            reranked = rerankResult.success;
            if (reranked) {
                rootLogger.info("Reranking complete", {
                    strategy: "OpenRouter native rerank",
                    model: env.RERANK_MODEL,
                    query: queryText.slice(0, 60),
                });
            }
        } catch (e: unknown) {
            rootLogger.warn("Reranking failed, falling back to RRF rankings", {
                error: e instanceof Error ? e.message : String(e),
            });
        }
    } else {
        rootLogger.info("Reranking skipped", {
            reason: "RAG_RERANK_ENABLED=false",
            query: queryText.slice(0, 60),
        });
    }

    // If reranked, filter out low relevance scores
    if (reranked) {
        candidates = candidates.filter(chunk => chunk.score >= SIMILARITY_THRESHOLD);
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
export async function deleteNoteChunks(noteId: string, userId: string = "default"): Promise<void> {
    const table = await getTable();
    await table.delete(`noteId = '${sanitizeFilterValue(noteId)}' AND userId = '${sanitizeFilterValue(userId)}'`);

    try {
        // Recreate FTS index after delete
        await table.createIndex("content", { config: lancedb.Index.fts(), replace: true });
        _ftsIndexHealthy = true;
    } catch (e: any) {
        _ftsIndexHealthy = false;
        rootLogger.warn("Failed to recreate FTS index on content after delete", { error: e.message });
    }
}

/**
 * Health check — verify LanceDB is accessible and table exists.
 */
export async function checkLanceDbHealth(): Promise<{ ok: boolean; ftsHealthy: boolean; error?: string }> {
    try {
        const table = await getTable();
        const count = await table.countRows();
        return { ok: true, ftsHealthy: _ftsIndexHealthy };
    } catch (e: any) {
        return { ok: false, ftsHealthy: false, error: e.message };
    }
}

/**
 * Wipes the entire LanceDB lore_embeddings table.
 */
export async function wipeDatabase(): Promise<void> {
    if (_db) {
        const tables = await _db.tableNames();
        if (tables.includes(TABLE_NAME)) {
            await _db.dropTable(TABLE_NAME);
            _table = null;
        }
    } else {
        const dbPath = env.LANCEDB_PATH;
        const tempDb = await lancedb.connect(dbPath);
        const tables = await tempDb.tableNames();
        if (tables.includes(TABLE_NAME)) {
            await tempDb.dropTable(TABLE_NAME);
        }
        _table = null;
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

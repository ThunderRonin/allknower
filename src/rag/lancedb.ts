import * as lancedb from "@lancedb/lancedb";
import { embed, EMBEDDING_DIMENSIONS } from "./embedder.ts";
import type { RagChunk } from "../types/lore.ts";
import { env } from "../env.ts";
import { pipeline } from "@xenova/transformers";
import { callWithFallback } from "../pipeline/model-router.ts";

const DB_PATH = env.LANCEDB_PATH;
const TABLE_NAME = "lore_embeddings";

let _db: lancedb.Connection | null = null;
let _table: lancedb.Table | null = null;

/**
 * Get (or create) the LanceDB connection and lore_embeddings table.
 * LanceDB is embedded — no separate server needed.
 */
export async function getTable(): Promise<lancedb.Table> {
    if (_table) return _table;

    _db = await lancedb.connect(DB_PATH);

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
        await _table.delete(`noteId = '__seed__'`);
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
    await table.delete(`noteId = '${noteId}'`);

    if (chunks.length === 0) return;

    // Embed all chunks
    const records = await Promise.all(
        chunks.map(async (content, chunkIndex) => ({
            noteId,
            noteTitle,
            chunkIndex,
            content,
            vector: await embed(content),
        }))
    );

    await table.add(records);
}

/**
 * Classify query complexity to decide reranking strategy.
 *
 * Simple → Xenova cross-encoder (fast, local)
 * Complex → LLM-as-a-Judge (holistic reasoning about relevance)
 */
const RELATIONAL_CONNECTIVES = new Set([
    "how", "why", "between", "affect", "affect", "relate",
    "relationship", "influence", "impact", "connect", "cause",
    "because", "through", "across", "within",
]);

export function classifyQueryComplexity(query: string): "simple" | "complex" {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length > 8) return "complex";
    if (words.some(w => RELATIONAL_CONNECTIVES.has(w))) return "complex";
    return "simple";
}

/**
 * Option A — Local cross-encoder reranker using Xenova/transformers.
 * Fast, no API call, good for entity lookups and short queries.
 */
async function rerankWithCrossEncoder(
    query: string,
    candidates: RagChunk[]
): Promise<RagChunk[]> {
    const reranker = await pipeline("text-classification", "Xenova/ms-marco-MiniLM-L-6-v2");

    const pairs = candidates.map(chunk => [query, chunk.content]);
    const rerankResults = await reranker(pairs as any);

    return candidates.map((chunk, i) => {
        const rawOutput = Array.isArray(rerankResults) ? rerankResults[i] : rerankResults;
        const rerankScore = (rawOutput as any).score !== undefined
            ? ((rawOutput as any).label === "LABEL_1" ? (rawOutput as any).score : 1 - (rawOutput as any).score)
            : 0;
        return { ...chunk, score: rerankScore };
    }).sort((a, b) => b.score - a.score);
}

/**
 * Option C — LLM-as-a-Judge reranker.
 * Better for complex, relational queries that need holistic reasoning.
 * Uses the existing model router for fallback chains + timeout logic.
 */
async function rerankWithLLM(
    query: string,
    candidates: RagChunk[]
): Promise<RagChunk[]> {
    const system = `You are a relevance judge for a fantasy worldbuilding knowledge base called All Reach.
Given a search query and a list of candidate documents, score each document's relevance to the query on a 0-1 scale.

Return JSON: { "scores": [0.95, 0.2, 0.8, ...] }

The scores array must have exactly the same length as the candidates list, in the same order.
Score based on semantic relevance, not just keyword overlap. Consider narrative connections, implied relationships, and contextual importance.`;

    const candidateBlock = candidates
        .map((c, i) => `[${i}] ${c.noteTitle}: ${c.content.slice(0, 300)}`)
        .join("\n\n");

    const user = `Query: "${query}"\n\nCandidates:\n${candidateBlock}`;

    const { raw } = await callWithFallback("rerank", [
        { role: "system", content: system },
        { role: "user", content: user },
    ], {
        temperature: 0.1,
        maxTokens: 512,
        responseFormat: { type: "json_object" },
    });

    try {
        const parsed = JSON.parse(raw);
        const scores: number[] = parsed.scores ?? [];

        if (scores.length !== candidates.length) {
            console.warn("[rerank] LLM returned wrong number of scores, falling back to vector scores");
            return candidates;
        }

        return candidates.map((chunk, i) => ({
            ...chunk,
            score: scores[i] ?? 0,
        })).sort((a, b) => b.score - a.score);
    } catch {
        console.warn("[rerank] Failed to parse LLM reranker response, falling back to vector scores");
        return candidates;
    }
}

/**
 * Semantic similarity search — returns top-k most relevant lore chunks.
 *
 * Uses a hybrid reranking strategy:
 * - Simple queries (≤8 words, no relational connectives) → Xenova cross-encoder
 * - Complex queries (>8 words or contains how/why/between/etc) → LLM-as-a-Judge
 */
export async function queryLore(
    queryText: string,
    topK: number = 10
): Promise<RagChunk[]> {
    const table = await getTable();
    const queryVector = await embed(queryText);

    // 1. Initial retrieval — grab a larger pool for reranking
    const RETRIEVAL_MULTIPLIER = 3;
    const initialResults = await table
        .search(queryVector)
        .limit(topK * RETRIEVAL_MULTIPLIER)
        .select(["noteId", "noteTitle", "content", "_distance"])
        .toArray();

    // 2. Base similarity threshold (filter out immediate junk)
    const SIMILARITY_THRESHOLD = 0.3;
    let candidates: RagChunk[] = initialResults.map((row: any) => ({
        noteId: row.noteId as string,
        noteTitle: row.noteTitle as string,
        content: row.content as string,
        score: 1 - (row._distance as number),
    })).filter(chunk => chunk.score >= SIMILARITY_THRESHOLD);

    if (candidates.length === 0) {
        return [];
    }

    // 3. Hybrid reranking — auto-dispatch based on query complexity
    const complexity = classifyQueryComplexity(queryText);

    try {
        if (complexity === "simple") {
            candidates = await rerankWithCrossEncoder(queryText, candidates);
        } else {
            candidates = await rerankWithLLM(queryText, candidates);
        }
        console.info(`[rerank] Used ${complexity === "simple" ? "Xenova cross-encoder" : "LLM-as-a-Judge"} for: "${queryText.slice(0, 60)}..."`);
    } catch (e) {
        console.warn(`[rerank] ${complexity} reranking failed, falling back to base vector similarity`, e);
    }

    return candidates.slice(0, topK);
}

/**
 * Delete all chunks for a note (e.g. when note is deleted in AllCodex).
 */
export async function deleteNoteChunks(noteId: string): Promise<void> {
    const table = await getTable();
    await table.delete(`noteId = '${noteId}'`);
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
 * Chunk a long text into overlapping segments for better RAG recall.
 * Simple sentence-aware chunking — good enough for lore entries.
 */
export function chunkText(text: string, chunkSize: number = 512, overlap: number = 64): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];

    const chunks: string[] = [];
    let start = 0;

    while (start < words.length) {
        const end = Math.min(start + chunkSize, words.length);
        chunks.push(words.slice(start, end).join(" "));
        if (end === words.length) break;
        start += chunkSize - overlap;
    }

    return chunks;
}

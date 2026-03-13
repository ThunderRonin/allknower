import OpenAI from "openai";
import { env } from "../env.ts";

/**
 * Embedder — generates vector embeddings for lore text.
 * Uses OpenRouter (EMBEDDING_CLOUD).
 *
 * Model env vars:
 *   EMBEDDING_CLOUD=google/gemini-embedding-001
 */

const EMBEDDING_CLOUD = env.EMBEDDING_CLOUD;

const openrouterClient = new OpenAI({
    baseURL: env.OPENROUTER_BASE_URL,
    apiKey: env.OPENROUTER_API_KEY,
    defaultHeaders: {
        "HTTP-Referer": "https://allknower.local",
        "X-Title": "AllKnower",
    },
});

// qwen3-embedding-8b produces 1536-dim vectors.
// LanceDB table is created with the dimension of the first embedding written —
// switching models requires a full reindex.
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Embed a single text string.
 * Uses OpenRouter EMBEDDING_CLOUD.
 */
export async function embed(text: string): Promise<number[]> {
    return embedViaOpenRouter(text);
}

/**
 * Embed multiple texts in batch.
 * Returns an array of embeddings in the same order as the input.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    // Sequential fallback if true batch is not robust
    for (const text of texts) {
        results.push(await embed(text));
    }
    return results;
}

async function embedViaOpenRouter(text: string): Promise<number[]> {
    const response = await openrouterClient.embeddings.create({
        model: EMBEDDING_CLOUD,
        input: text,
    });
    return response.data[0].embedding;
}

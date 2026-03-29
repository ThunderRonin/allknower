import OpenAI from "openai";
import { env } from "../env.ts";

/**
 * Embedder — generates vector embeddings for lore text.
 * Uses OpenRouter (EMBEDDING_CLOUD).
 *
 * Model env vars:
 *   EMBEDDING_CLOUD=google/gemini-embedding-001
 *   EMBEDDING_DIMENSIONS=4096  (must match model output; table is fixed at creation)
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

// Dimensions are env-configurable so switching models doesn't require a code change.
// LanceDB table schema is fixed at creation time — switching models requires
// dropping the table and running a full reindex (POST /rag/reindex).
export const EMBEDDING_DIMENSIONS = env.EMBEDDING_DIMENSIONS;

/**
 * Embed a single text string.
 */
export async function embed(text: string): Promise<number[]> {
    const embeddings = await embedBatch([text]);
    return embeddings[0];
}

/**
 * Embed multiple texts in a single batch API call.
 * Returns embeddings in the same order as the input.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // True batch: the OpenAI-compatible API accepts string[] as input
    const response = await openrouterClient.embeddings.create({
        model: EMBEDDING_CLOUD,
        input: texts,
    });

    // Sort by index to guarantee order matches input array
    return response.data
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);
}


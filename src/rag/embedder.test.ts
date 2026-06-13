/**
 * Embedder unit tests.
 */
import { describe, expect, it, mock, beforeAll } from "bun:test";
import { env } from "../env.ts";

export let constructorCalls: any[] = [];
export const mockEmbeddingsCreate = mock((params: any) => {
    return Promise.resolve({
        data: params.input.map((text: string, index: number) => ({
            index,
            embedding: Array(4096).fill(0.1)
        }))
    });
});

mock.module("openai", () => {
    return {
        default: class {
            constructor(options: any) {
                constructorCalls.push(options);
            }
            embeddings = {
                create: mockEmbeddingsCreate
            };
        }
    };
});

mock.module("../env.ts", () => ({
    env: {
        EMBEDDING_CLOUD: "ollama/nomic-embed-text",
        EMBEDDING_DIMENSIONS: 4096,
        LOCAL_PROVIDER_BASE_URL: "http://localhost:11434/v1",
        LOCAL_PROVIDER_API_KEY: "ollama",
        OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
        OPENROUTER_API_KEY: "test-cloud-key",
    }
}));

let embed: any;
let embedBatch: any;
let EMBEDDING_DIMENSIONS: any;

beforeAll(async () => {
    const mod = await import("./embedder.ts");
    embed = mod.embed;
    embedBatch = mod.embedBatch;
    EMBEDDING_DIMENSIONS = mod.EMBEDDING_DIMENSIONS;
});

describe("EMBEDDING_DIMENSIONS", () => {
    it("is a positive integer", () => {
        expect(Number.isInteger(EMBEDDING_DIMENSIONS)).toBe(true);
        expect(EMBEDDING_DIMENSIONS).toBeGreaterThan(0);
    });

    it("equals env.EMBEDDING_DIMENSIONS (default 4096)", () => {
        expect(EMBEDDING_DIMENSIONS).toBe(4096);
    });
});

describe("embedBatch short-circuit", () => {
    it("returns [] immediately for empty input (no network call)", async () => {
        const result = await embedBatch([]);
        expect(result).toEqual([]);
    });
});

describe("module shape", () => {
    it("exports embed as an async function", () => {
        expect(typeof embed).toBe("function");
        expect(embed.constructor.name).toBe("AsyncFunction");
    });

    it("exports embedBatch as an async function", () => {
        expect(typeof embedBatch).toBe("function");
        expect(embedBatch.constructor.name).toBe("AsyncFunction");
    });

    it("exports EMBEDDING_DIMENSIONS as a number", () => {
        expect(typeof EMBEDDING_DIMENSIONS).toBe("number");
    });
});

describe("local embeddings routing", () => {
    it("instantiates OpenAI clients correctly", () => {
        expect(constructorCalls).toHaveLength(2);
        
        // OpenRouter client
        expect(constructorCalls[0].baseURL).toBe("https://openrouter.ai/api/v1");
        expect(constructorCalls[0].apiKey).toBe("test-cloud-key");

        // Local client
        expect(constructorCalls[1].baseURL).toBe("http://localhost:11434/v1");
        expect(constructorCalls[1].apiKey).toBe("ollama");
    });

    it("routes local/ollama prefixed models to localClient and strips the prefix", async () => {
        mockEmbeddingsCreate.mockClear();

        const result = await embedBatch(["hello world"]);
        
        expect(result).toHaveLength(1);
        expect(result[0]).toHaveLength(4096);
        expect(mockEmbeddingsCreate).toHaveBeenCalled();

        const calledArgs = mockEmbeddingsCreate.mock.calls[0][0];
        expect(calledArgs.model).toBe("nomic-embed-text");
    });

    it("routes unprefixed models to cloud/OpenRouter client", async () => {
        mockEmbeddingsCreate.mockClear();
        
        const originalModel = env.EMBEDDING_CLOUD;
        (env as any).EMBEDDING_CLOUD = "google/gemini-embedding-001";
        
        try {
            const result = await embedBatch(["hello cloud"]);
            expect(result).toHaveLength(1);
            expect(mockEmbeddingsCreate).toHaveBeenCalled();
            
            const calledArgs = mockEmbeddingsCreate.mock.calls[0][0];
            expect(calledArgs.model).toBe("google/gemini-embedding-001");
        } finally {
            (env as any).EMBEDDING_CLOUD = originalModel;
        }
    });

    it("embed wrapper function correctly wraps embedBatch", async () => {
        mockEmbeddingsCreate.mockClear();
        
        const result = await embed("hello single");
        expect(result).toHaveLength(4096);
        expect(mockEmbeddingsCreate).toHaveBeenCalled();
        
        const calledArgs = mockEmbeddingsCreate.mock.calls[0][0];
        expect(calledArgs.input).toEqual(["hello single"]);
    });
});

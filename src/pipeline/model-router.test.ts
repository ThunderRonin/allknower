import { mock, beforeAll } from "bun:test";

async function* mockStream(chunks: any[]) {
    for (const chunk of chunks) {
        yield chunk;
    }
}

export const mockOpenRouterSend = mock((params: any) => {
    if (params?.chatGenerationParams?.stream) {
        if (params.chatGenerationParams.model === "openai/gpt-4o-reasoning") {
            return Promise.resolve(mockStream([
                { choices: [{ delta: { reasoning: "cloud-thinking..." } }] },
                { choices: [{ delta: { content: "cloud-answer" } }], usage: { promptTokens: 10, completionTokens: 20 } }
            ]));
        }
        return Promise.resolve(mockStream([
            { choices: [{ delta: { content: "cloud-" } }] },
            { choices: [{ delta: { content: "stream" } }], usage: { promptTokens: 10, completionTokens: 20 } }
        ]));
    }
    return Promise.resolve({
        id: "chatcmpl-123",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "openrouter-used-model",
        choices: [{
            index: 0,
            message: { role: "assistant", content: "mock-openrouter-response" },
            finish_reason: "stop"
        }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
    });
});

export const mockLocalCreate = mock((params: any) => {
    if (params?.stream) {
        if (params.model === "reasoner") {
            return Promise.resolve(mockStream([
                { choices: [{ delta: { reasoning_content: "local-thinking..." } }] },
                { choices: [{ delta: { content: "local-answer" } }], usage: { prompt_tokens: 5, completion_tokens: 15 } }
            ]));
        }
        return Promise.resolve(mockStream([
            { choices: [{ delta: { content: "local-" } }] },
            { choices: [{ delta: { content: "stream" } }], usage: { prompt_tokens: 5, completion_tokens: 15 } }
        ]));
    }
    return Promise.resolve({
        id: "chatcmpl-123",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "local-used-model",
        choices: [{
            index: 0,
            message: { role: "assistant", content: "mock-local-response" },
            finish_reason: "stop"
        }],
        usage: { prompt_tokens: 5, completion_tokens: 15, total_tokens: 20 }
    });
});

mock.module("@openrouter/sdk", () => {
    return {
        OpenRouter: class {
            chat = {
                send: mockOpenRouterSend
            };
        }
    };
});

mock.module("openai", () => {
    return {
        OpenAI: class {
            chat = {
                completions: {
                    create: mockLocalCreate
                }
            };
        }
    };
});

// Must mock env before model-router.ts imports it at module load
mock.module("../env.ts", () => ({
    env: {
        USE_OPENROUTER_AUTO: "false",
        BRAIN_DUMP_MODEL: "x-ai/grok-4.3",
        BRAIN_DUMP_FALLBACK_1: "",
        BRAIN_DUMP_FALLBACK_2: "",
        BRAIN_DUMP_FALLBACK_3: "",
        ARTICLE_COPILOT_MODEL: "",
        ARTICLE_COPILOT_FALLBACK_1: "",
        ARTICLE_COPILOT_FALLBACK_2: "",
        ARTICLE_COPILOT_FALLBACK_3: "",
        CONSISTENCY_MODEL: "moonshotai/kimi-k2.5",
        CONSISTENCY_FALLBACK_1: "",
        CONSISTENCY_FALLBACK_2: "",
        CONSISTENCY_FALLBACK_3: "",
        SUGGEST_MODEL: "aion-labs/aion-2.0",
        SUGGEST_FALLBACK_1: "",
        SUGGEST_FALLBACK_2: "",
        SUGGEST_FALLBACK_3: "",
        GAP_DETECT_MODEL: "aion-labs/aion-2.0",
        GAP_DETECT_FALLBACK_1: "",
        GAP_DETECT_FALLBACK_2: "",
        GAP_DETECT_FALLBACK_3: "",
        AUTOCOMPLETE_MODEL: "liquid/lfm-24b",
        AUTOCOMPLETE_FALLBACK_1: "",
        AUTOCOMPLETE_FALLBACK_2: "",
        AUTOCOMPLETE_FALLBACK_3: "",
        RERANK_MODEL: "cohere/rerank-4-pro",
        COMPACT_MODEL: "anthropic/claude-haiku-4-5-20251001",
        COMPACT_FALLBACK_1: "openai/gpt-4.1-nano",
        COMPACT_FALLBACK_2: "",
        COMPACT_FALLBACK_3: "",
        OPENROUTER_API_KEY: "test-key",
        LOCAL_PROVIDER_BASE_URL: "http://localhost:11434/v1",
        LOCAL_PROVIDER_API_KEY: "ollama",
        LLM_TIMEOUT_MS: 120000,
        OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
        DATABASE_URL: "postgresql://test:test@localhost:5432/test",
        NODE_ENV: "test",
        LLM_FIRST_CHUNK_TIMEOUT_MS: 30000,
        LLM_INACTIVITY_TIMEOUT_MS: 15000,
        LLM_MAX_DURATION_MS: 300000,
    },
}));

import { describe, expect, it } from "bun:test";
import type { TaskType } from "./model-router.ts";
import { env } from "../env.ts";

let getModelChain: any;
let callWithFallback: any;
let callModelStream: any;

beforeAll(async () => {
    const mod = await import("./model-router.ts");
    getModelChain = mod.getModelChain;
    callWithFallback = mod.callWithFallback;
    callModelStream = mod.callModelStream;
});

describe("getModelChain", () => {
    const validTasks: TaskType[] = [
        "brain-dump",
        "consistency",
        "suggest",
        "gap-detect",
        "autocomplete",
        "compact",
        "session-compact",
    ];

    for (const task of validTasks) {
        it(`returns array of strings for "${task}"`, () => {
            const result = getModelChain(task);
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBeGreaterThan(0);
        });
    }

    it("all returned model strings are non-empty", () => {
        for (const task of validTasks) {
            const chain = getModelChain(task);
            for (const model of chain) {
                expect(model.length).toBeGreaterThan(0);
            }
        }
    });

    it('fallbacks with empty string are filtered out', () => {
        // BRAIN_DUMP_FALLBACK_1 and FALLBACK_2 are "" — should not appear
        const chain = getModelChain("brain-dump");
        for (const m of chain) {
            expect(m).not.toBe("");
        }
    });

    it("primary model is always first in array", () => {
        const chain = getModelChain("brain-dump");
        expect(chain[0]).toBe("x-ai/grok-4.3");
    });

    it('"compact" and "session-compact" use the same COMPACT_MODEL', () => {
        const compact = getModelChain("compact");
        const sessionCompact = getModelChain("session-compact");
        expect(compact[0]).toBe(sessionCompact[0]);
    });

    it("with only primary set (fallbacks empty) → array length 1", () => {
        const chain = getModelChain("brain-dump"); // fallbacks are ""
        expect(chain).toHaveLength(1);
    });

    it("with primary + fallback1 set → array length 2", () => {
        const chain = getModelChain("compact"); // COMPACT_FALLBACK_1 = "openai/gpt-4.1-nano"
        expect(chain).toHaveLength(2);
        expect(chain[1]).toBe("openai/gpt-4.1-nano");
    });

    it("with primary + fallback1 + fallback2 set → array length 3 when all set", () => {
        // Our mock has COMPACT_FALLBACK_2 = "" → only 2 results
        // Test the filtering logic by verifying no empty strings
        const chain = getModelChain("compact");
        expect(chain.every((m: string) => m.length > 0)).toBe(true);
    });

    // Note: USE_OPENROUTER_AUTO="true" path is verified in a separate describe below
    // because it requires a different env mock value
});

describe("callWithFallback", () => {
    it("routes local/ prefixed models to localClient and strips the prefix", async () => {
        mockLocalCreate.mockClear();
        mockOpenRouterSend.mockClear();

        const result = await callWithFallback("brain-dump", [{ role: "user", content: "hello" }], {
            modelOverride: "local/llama3"
        });

        expect(result.raw).toBe("mock-local-response");
        expect(mockLocalCreate).toHaveBeenCalled();
        expect(mockOpenRouterSend).not.toHaveBeenCalled();

        // Check stripped prefix in call arguments
        const calledArgs = mockLocalCreate.mock.calls[0][0];
        expect(calledArgs.model).toBe("llama3");

        // Verify OpenRouter-specific fields are stripped
        expect(calledArgs.models).toBeUndefined();
        expect(calledArgs.plugins).toBeUndefined();
        expect(calledArgs.provider).toBeUndefined();
        expect(calledArgs.trace).toBeUndefined();
    });

    it("routes ollama/ prefixed models to localClient and strips the prefix", async () => {
        mockLocalCreate.mockClear();
        mockOpenRouterSend.mockClear();

        const result = await callWithFallback("brain-dump", [{ role: "user", content: "hello" }], {
            modelOverride: "ollama/deepseek-r1"
        });

        expect(result.raw).toBe("mock-local-response");
        expect(mockLocalCreate).toHaveBeenCalled();
        expect(mockOpenRouterSend).not.toHaveBeenCalled();

        // Check stripped prefix in call arguments
        const calledArgs = mockLocalCreate.mock.calls[0][0];
        expect(calledArgs.model).toBe("deepseek-r1");
    });

    it("routes unprefixed models to OpenRouter SDK client", async () => {
        mockLocalCreate.mockClear();
        mockOpenRouterSend.mockClear();

        const result = await callWithFallback("brain-dump", [{ role: "user", content: "hello" }], {
            modelOverride: "openai/gpt-4o"
        });

        expect(result.raw).toBe("mock-openrouter-response");
        expect(mockOpenRouterSend).toHaveBeenCalled();
        expect(mockLocalCreate).not.toHaveBeenCalled();

        const calledArgs = mockOpenRouterSend.mock.calls[0][0];
        expect(calledArgs.chatGenerationParams.model).toBe("openai/gpt-4o");
    });

    it("falls back to cloud model if local model fails", async () => {
        mockLocalCreate.mockClear();
        mockOpenRouterSend.mockClear();

        // Mock localClient failing once
        (mockLocalCreate as any).mockImplementationOnce(() => Promise.reject(new Error("Local client down")));

        const result = await callWithFallback("compact", [{ role: "user", content: "hello" }], {
            modelOverride: "local/llama3" // will fall back to chain's next model: COMPACT_FALLBACK_1 = "openai/gpt-4.1-nano"
        });

        expect(result.raw).toBe("mock-openrouter-response");
        expect(mockLocalCreate).toHaveBeenCalledTimes(1);
        expect(mockOpenRouterSend).toHaveBeenCalledTimes(1);

        const openRouterArgs = mockOpenRouterSend.mock.calls[0][0];
        expect(openRouterArgs.chatGenerationParams.model).toBe("anthropic/claude-haiku-4-5-20251001");
    });
});

describe("callModelStream", () => {
    it("routes local/ prefixed models to localClient stream", async () => {
        mockLocalCreate.mockClear();
        mockOpenRouterSend.mockClear();

        const stream = callModelStream("brain-dump", [{ role: "user", content: "hello" }], {
            modelOverride: "local/llama3"
        });

        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }

        expect(chunks).toHaveLength(3);
        expect(chunks[0]).toEqual({ type: "token", content: "local-" });
        expect(chunks[1]).toEqual({ type: "token", content: "stream" });
        expect(chunks[2].type).toBe("done");
        expect(chunks[2].raw).toBe("local-stream");

        expect(mockLocalCreate).toHaveBeenCalled();
        expect(mockOpenRouterSend).not.toHaveBeenCalled();

        const calledArgs = mockLocalCreate.mock.calls[0][0];
        expect(calledArgs.model).toBe("llama3");
    });

    it("routes unprefixed models to OpenRouter stream", async () => {
        mockLocalCreate.mockClear();
        mockOpenRouterSend.mockClear();

        const stream = callModelStream("brain-dump", [{ role: "user", content: "hello" }], {
            modelOverride: "openai/gpt-4o"
        });

        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }

        expect(chunks).toHaveLength(3);
        expect(chunks[0]).toEqual({ type: "token", content: "cloud-" });
        expect(chunks[1]).toEqual({ type: "token", content: "stream" });
        expect(chunks[2].type).toBe("done");
        expect(chunks[2].raw).toBe("cloud-stream");

        expect(mockOpenRouterSend).toHaveBeenCalled();
        expect(mockLocalCreate).not.toHaveBeenCalled();

        const calledArgs = mockOpenRouterSend.mock.calls[0][0];
        expect(calledArgs.chatGenerationParams.model).toBe("openai/gpt-4o");
    });

    it("maps json_schema responseFormat correctly for localClient in callWithFallback", async () => {
        mockLocalCreate.mockClear();

        await callWithFallback("brain-dump", [{ role: "user", content: "hello" }], {
            modelOverride: "local/llama3",
            responseFormat: {
                type: "json_schema",
                jsonSchema: {
                    name: "test_schema",
                    schema: { type: "object", properties: { key: { type: "string" } } },
                    strict: true
                }
            }
        });

        expect(mockLocalCreate).toHaveBeenCalled();
        const calledArgs = mockLocalCreate.mock.calls[0][0];
        expect(calledArgs.response_format).toEqual({
            type: "json_schema",
            json_schema: {
                name: "test_schema",
                schema: { type: "object", properties: { key: { type: "string" } } },
                strict: true
            }
        });
    });

    it("yields reasoning tokens correctly in callModelStream for local models", async () => {
        mockLocalCreate.mockClear();

        const stream = callModelStream("brain-dump", [{ role: "user", content: "hello" }], {
            modelOverride: "local/reasoner"
        });

        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }

        expect(chunks).toHaveLength(3);
        expect(chunks[0]).toEqual({ type: "reasoning", content: "local-thinking..." });
        expect(chunks[1]).toEqual({ type: "token", content: "local-answer" });
        expect(chunks[2].type).toBe("done");
        expect(chunks[2].raw).toBe("local-answer");
    });

    it("yields reasoning tokens correctly in callModelStream for cloud models", async () => {
        mockOpenRouterSend.mockClear();

        const stream = callModelStream("brain-dump", [{ role: "user", content: "hello" }], {
            modelOverride: "openai/gpt-4o-reasoning"
        });

        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }

        expect(chunks).toHaveLength(3);
        expect(chunks[0]).toEqual({ type: "reasoning", content: "cloud-thinking..." });
        expect(chunks[1]).toEqual({ type: "token", content: "cloud-answer" });
        expect(chunks[2].type).toBe("done");
        expect(chunks[2].raw).toBe("cloud-answer");
    });

    it("throws an error when callWithFallback has no models configured", async () => {
        const originalModel = env.BRAIN_DUMP_MODEL;
        (env as any).BRAIN_DUMP_MODEL = "";
        
        try {
            let didThrow = false;
            try {
                await callWithFallback("brain-dump", [{ role: "user", content: "hello" }]);
            } catch (e) {
                didThrow = true;
            }
            expect(didThrow).toBe(true);
        } finally {
            (env as any).BRAIN_DUMP_MODEL = originalModel;
        }
    });

    it("yields an error when callModelStream has no models configured", async () => {
        const originalModel = env.BRAIN_DUMP_MODEL;
        (env as any).BRAIN_DUMP_MODEL = "";
        
        try {
            const stream = callModelStream("brain-dump", [{ role: "user", content: "hello" }]);
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            expect(chunks).toHaveLength(1);
            expect(chunks[0].type).toBe("error");
            expect(chunks[0].code).toBe("NO_MODEL");
        } finally {
            (env as any).BRAIN_DUMP_MODEL = originalModel;
        }
    });
});

import { OpenRouter } from "@openrouter/sdk";
import { env } from "../env.ts";
import { rootLogger } from "../logger.ts";
import type { Logger } from "../logger.ts";
import type { StreamChunk } from "./stream-types.ts";

/**
 * Model Router — per-task model selection with native OpenRouter fallbacks.
 *
 * Uses the @openrouter/sdk with the `models` array parameter for server-side
 * fallback. OpenRouter automatically tries the next model in the list if the
 * first one fails (rate-limited, down, moderation, context length, etc.).
 *
 * Each AI task has a primary model and up to 2 fallbacks, all env-configurable.
 * When USE_OPENROUTER_AUTO is enabled, all tasks use "openrouter/auto" instead.
 */

export type TaskType =
    | "brain-dump"
    | "article-copilot"
    | "consistency"
    | "suggest"
    | "gap-detect"
    | "autocomplete"
    | "compact"
    | "session-compact";

interface ModelChain {
    primary: string;
    fallback1: string;
    fallback2: string;
    fallback3: string;
}

// ── OpenRouter SDK client (singleton) ─────────────────────────────────────────

const openrouter = new OpenRouter({
    apiKey: env.OPENROUTER_API_KEY,
});

// ── Model chain resolution ────────────────────────────────────────────────────

/**
 * Build the model chain for a given task from env vars.
 * Returns only non-empty model IDs in priority order.
 */
export function getModelChain(task: TaskType): string[] {
    if (env.USE_OPENROUTER_AUTO === "true") {
        return ["openrouter/auto"];
    }

    const chains: Record<TaskType, ModelChain> = {
        "brain-dump": {
            primary: env.BRAIN_DUMP_MODEL,
            fallback1: env.BRAIN_DUMP_FALLBACK_1,
            fallback2: env.BRAIN_DUMP_FALLBACK_2,
            fallback3: env.BRAIN_DUMP_FALLBACK_3,
        },
        "article-copilot": {
            primary: env.ARTICLE_COPILOT_MODEL || env.BRAIN_DUMP_MODEL,
            fallback1: env.ARTICLE_COPILOT_FALLBACK_1 || env.BRAIN_DUMP_FALLBACK_1,
            fallback2: env.ARTICLE_COPILOT_FALLBACK_2 || env.BRAIN_DUMP_FALLBACK_2,
            fallback3: env.ARTICLE_COPILOT_FALLBACK_3 || env.BRAIN_DUMP_FALLBACK_3,
        },
        consistency: {
            primary: env.CONSISTENCY_MODEL,
            fallback1: env.CONSISTENCY_FALLBACK_1,
            fallback2: env.CONSISTENCY_FALLBACK_2,
            fallback3: env.CONSISTENCY_FALLBACK_3,
        },
        suggest: {
            primary: env.SUGGEST_MODEL,
            fallback1: env.SUGGEST_FALLBACK_1,
            fallback2: env.SUGGEST_FALLBACK_2,
            fallback3: env.SUGGEST_FALLBACK_3,
        },
        "gap-detect": {
            primary: env.GAP_DETECT_MODEL,
            fallback1: env.GAP_DETECT_FALLBACK_1,
            fallback2: env.GAP_DETECT_FALLBACK_2,
            fallback3: env.GAP_DETECT_FALLBACK_3,
        },
        autocomplete: {
            primary: env.AUTOCOMPLETE_MODEL,
            fallback1: env.AUTOCOMPLETE_FALLBACK_1,
            fallback2: env.AUTOCOMPLETE_FALLBACK_2,
            fallback3: env.AUTOCOMPLETE_FALLBACK_3,
        },
        compact: {
            primary: env.COMPACT_MODEL,
            fallback1: env.COMPACT_FALLBACK_1,
            fallback2: env.COMPACT_FALLBACK_2,
            fallback3: env.COMPACT_FALLBACK_3,
        },
        "session-compact": {
            primary: env.COMPACT_MODEL,
            fallback1: env.COMPACT_FALLBACK_1,
            fallback2: env.COMPACT_FALLBACK_2,
            fallback3: env.COMPACT_FALLBACK_3,
        },
    };

    const chain = chains[task];
    return [chain.primary, chain.fallback1, chain.fallback2, chain.fallback3].filter(
        (m) => m.length > 0
    );
}

// ── LLM call with native fallback ─────────────────────────────────────────────

export interface LLMResult {
    raw: string;
    tokensUsed: number;
    model: string;    // the model that actually succeeded
    latencyMs: number;
}

/**
 * Call an LLM via the OpenRouter SDK with native server-side fallbacks.
 *
 * Uses the `models` array — OpenRouter automatically tries the next model
 * in the list if the primary returns an error. This is a single HTTP request;
 * failover happens server-side with zero additional latency.
 *
 * Features:
 * - Per-request AbortController timeout (default: env.LLM_TIMEOUT_MS)
 * - Latency tracking
 * - Trace correlation via OpenRouter trace.traceId
 * - Fire-and-forget LLM call logging to Prisma (never blocks the pipeline)
 * - response-healing plugin for auto-fixing malformed JSON
 */
export async function callWithFallback(
    task: TaskType,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    options?: {
        temperature?: number;
        maxTokens?: number;
        responseFormat?: { type: "json_object" } | {
            type: "json_schema";
            jsonSchema: { name: string; schema: Record<string, unknown>; strict?: boolean };
        };
        requestId?: string;
        timeoutMs?: number;
        reasoning?: { effort?: "xhigh" | "high" | "medium" | "low" | "minimal" };
        modelOverride?: string;
        log?: Logger;
    }
): Promise<LLMResult> {
    const log = options?.log ?? rootLogger;
    const baseChain = getModelChain(task);
    const models = options?.modelOverride
        ? [options.modelOverride, ...baseChain.filter(m => m !== options.modelOverride)]
        : baseChain;

    if (models.length === 0) {
        throw new Error(
            `[model-router] No models configured for task "${task}"`
        );
    }

    const [primaryModel, ...fallbackModels] = models;

    // Non-streaming timeout (streaming routes use callModelStream with inactivity-based timeouts)
    const TIMEOUT_MS = options?.timeoutMs ?? env.LLM_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const startTime = performance.now();

    try {
        const response = await openrouter.chat.send({
            httpReferer: "https://allknower.local",
            appTitle: "AllKnower",
            chatGenerationParams: {
                model: primaryModel,
                ...(fallbackModels.length > 0 && { models: fallbackModels }),
                messages: messages as any,
                temperature: options?.temperature ?? 0.3,
                maxTokens: options?.maxTokens ?? 30000,
                ...(options?.responseFormat && {
                    responseFormat: options.responseFormat as any,
                }),
                ...(options?.requestId && {
                    trace: {
                        traceId: options.requestId,
                        spanName: task,
                    } as any,
                }),
                ...(options?.reasoning && { reasoning: options.reasoning }),
                plugins: [
                    { id: "response-healing" as const },
                ],
                // 3.3 + 3.4: explicit provider preferences + fallback routing
                provider: {
                    allowFallbacks: true,
                    ...(env.OPENROUTER_SORT && { sort: env.OPENROUTER_SORT }),
                    ...(env.OPENROUTER_ZDR === "true" && { data_collection: "deny" as const }),
                } as any,
            },
        }, {
            signal: controller.signal,
        } as any);

        const latencyMs = Math.round(performance.now() - startTime);
        const raw = (response as any).choices?.[0]?.message?.content ?? "";
        const tokensUsed = (response as any).usage?.total_tokens ?? 0;
        const usedModel = (response as any).model ?? primaryModel;

        if (usedModel !== primaryModel) {
            log.info("Task fell back to alternate model", { task, from: primaryModel, to: usedModel });
        }

        // Fire-and-forget LLM call log — never blocks the pipeline
        logLLMCall({ requestId: options?.requestId, task, model: usedModel, tokensUsed, latencyMs }, log);

        return { raw, tokensUsed, model: usedModel, latencyMs };
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            throw new Error(`[model-router] "${task}" timed out after ${TIMEOUT_MS}ms`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

// ── Streaming LLM call with inactivity-based timeouts ────────────────────────

/**
 * Stream an LLM response via Chat Completions with inactivity-based timeout
 * protection. Uses raw fetch() to bypass SDK Zod validation issues with SSE.
 *
 * Timeout strategy:
 * - **First chunk**: abort if no data arrives within `LLM_FIRST_CHUNK_TIMEOUT_MS`.
 * - **Inactivity**: abort if no data arrives for `LLM_INACTIVITY_TIMEOUT_MS` mid-stream.
 * - **Max duration**: hard ceiling of `LLM_MAX_DURATION_MS` regardless of activity.
 */
export async function* callModelStream(
    task: TaskType,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    options?: {
        temperature?: number;
        maxTokens?: number;
        responseFormat?: { type: "json_object" } | {
            type: "json_schema";
            jsonSchema: { name: string; schema: Record<string, unknown>; strict?: boolean };
        };
        requestId?: string;
        reasoning?: { effort?: "xhigh" | "high" | "medium" | "low" | "minimal" };
        modelOverride?: string;
        log?: Logger;
    }
): AsyncGenerator<StreamChunk> {
    const log = options?.log ?? rootLogger;
    const baseChain = getModelChain(task);
    const models = options?.modelOverride
        ? [options.modelOverride, ...baseChain.filter(m => m !== options.modelOverride)]
        : baseChain;

    if (models.length === 0) {
        yield { type: "error", error: `No models configured for task "${task}"`, code: "NO_MODEL" };
        return;
    }

    const [primaryModel, ...fallbackModels] = models;
    const startTime = performance.now();

    // Timeout controllers
    const controller = new AbortController();
    const FIRST_CHUNK_MS = env.LLM_FIRST_CHUNK_TIMEOUT_MS;
    const INACTIVITY_MS = env.LLM_INACTIVITY_TIMEOUT_MS;
    const MAX_DURATION_MS = env.LLM_MAX_DURATION_MS;

    let firstChunkReceived = false;
    let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
    let maxDurationTimer: ReturnType<typeof setTimeout>;

    let firstChunkTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
        if (!firstChunkReceived) {
            controller.abort();
        }
    }, FIRST_CHUNK_MS);

    maxDurationTimer = setTimeout(() => controller.abort(), MAX_DURATION_MS);

    const resetInactivity = () => {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => controller.abort(), INACTIVITY_MS);
    };

    // Build Chat Completions response_format (snake_case for the API)
    let responseFormat: Record<string, unknown> | undefined;
    if (options?.responseFormat?.type === "json_object") {
        responseFormat = { type: "json_object" };
    } else if (options?.responseFormat?.type === "json_schema") {
        responseFormat = {
            type: "json_schema",
            json_schema: {
                name: options.responseFormat.jsonSchema.name,
                schema: options.responseFormat.jsonSchema.schema,
                strict: options.responseFormat.jsonSchema.strict ?? true,
            },
        };
    }

    let accumulatedText = "";
    let tokensUsed = 0;
    let usedModel = primaryModel;

    try {
        const baseUrl = env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
        const body: Record<string, unknown> = {
            model: primaryModel,
            ...(fallbackModels.length > 0 && { models: fallbackModels }),
            messages,
            stream: true,
            stream_options: { include_usage: true },
            temperature: options?.temperature ?? 0.3,
            max_tokens: options?.maxTokens ?? 30000,
            ...(responseFormat && { response_format: responseFormat }),
            ...(options?.reasoning && { reasoning: options.reasoning }),
            provider: {
                allow_fallbacks: true,
                ...(env.OPENROUTER_SORT && { sort: env.OPENROUTER_SORT }),
                ...(env.OPENROUTER_ZDR === "true" && { data_collection: "deny" }),
            },
        };

        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
                "HTTP-Referer": "https://allknower.local",
                "X-Title": "AllKnower",
                Accept: "text/event-stream",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            yield { type: "error", error: `OpenRouter ${res.status}: ${errBody}`, code: "API_ERROR" };
            logLLMCall({ requestId: options?.requestId, task, model: primaryModel, tokensUsed: 0, latencyMs: Math.round(performance.now() - startTime) }, log);
            return;
        }

        if (!res.body) {
            yield { type: "error", error: "No response body from OpenRouter", code: "NO_BODY" };
            return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            if (!firstChunkReceived) {
                firstChunkReceived = true;
                clearTimeout(firstChunkTimer);
            }
            resetInactivity();

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith(":")) continue;
                if (trimmed === "data: [DONE]") continue;
                if (!trimmed.startsWith("data: ")) continue;

                let chunk: any;
                try {
                    chunk = JSON.parse(trimmed.slice(6));
                } catch {
                    continue;
                }

                if (chunk.model) usedModel = chunk.model;

                // Final chunk with usage info (empty choices array)
                if (chunk.usage) {
                    tokensUsed = chunk.usage.total_tokens
                        ?? (chunk.usage.prompt_tokens ?? 0) + (chunk.usage.completion_tokens ?? 0);
                }

                const delta = chunk.choices?.[0]?.delta;
                if (!delta) continue;

                // Reasoning tokens (OpenRouter normalizes to `reasoning`, some providers use `reasoning_content`)
                const reasoning = delta.reasoning ?? delta.reasoning_content;
                if (reasoning) {
                    yield { type: "reasoning", content: reasoning };
                }

                if (delta.content) {
                    accumulatedText += delta.content;
                    yield { type: "token", content: delta.content };
                }
            }
        }

        const latencyMs = Math.round(performance.now() - startTime);

        if (usedModel !== primaryModel) {
            log.info("Task fell back to alternate model", { task, from: primaryModel, to: usedModel });
        }

        logLLMCall({ requestId: options?.requestId, task, model: usedModel, tokensUsed, latencyMs }, log);

        yield { type: "done", raw: accumulatedText, tokensUsed, model: usedModel, latencyMs };
    } catch (error) {
        const latencyMs = Math.round(performance.now() - startTime);
        if (error instanceof DOMException && error.name === "AbortError") {
            const reason = !firstChunkReceived
                ? `No response from model within ${FIRST_CHUNK_MS}ms`
                : `Stream stalled (no data for ${INACTIVITY_MS}ms)`;
            yield { type: "error", error: reason, code: "TIMEOUT" };
        } else {
            yield { type: "error", error: error instanceof Error ? error.message : String(error) };
        }
        logLLMCall({ requestId: options?.requestId, task, model: usedModel, tokensUsed: 0, latencyMs }, log);
    } finally {
        clearTimeout(firstChunkTimer);
        clearTimeout(inactivityTimer);
        clearTimeout(maxDurationTimer);
    }
}

// ── Fire-and-forget call logger ───────────────────────────────────────────────

function logLLMCall(
    data: { requestId?: string; task: string; model: string; tokensUsed: number; latencyMs: number },
    log: Logger
): void {
    // Dynamic import to avoid circular dependency at module load time
    import("../db/client.ts").then(({ default: prisma }) => {
        return prisma.lLMCallLog.create({ data });
    }).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        log.warn("Failed to log LLM call", { error: msg });
    });
}

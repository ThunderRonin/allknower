import { OpenRouter } from "@openrouter/sdk";
import { env } from "../env.ts";
import { rootLogger } from "../logger.ts";
import type { Logger } from "../logger.ts";

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
    | "consistency"
    | "suggest"
    | "gap-detect"
    | "autocomplete"
    | "rerank"
    | "compact"
    | "session-compact";

interface ModelChain {
    primary: string;
    fallback1: string;
    fallback2: string;
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
        },
        consistency: {
            primary: env.CONSISTENCY_MODEL,
            fallback1: env.CONSISTENCY_FALLBACK_1,
            fallback2: env.CONSISTENCY_FALLBACK_2,
        },
        suggest: {
            primary: env.SUGGEST_MODEL,
            fallback1: env.SUGGEST_FALLBACK_1,
            fallback2: env.SUGGEST_FALLBACK_2,
        },
        "gap-detect": {
            primary: env.GAP_DETECT_MODEL,
            fallback1: env.GAP_DETECT_FALLBACK_1,
            fallback2: env.GAP_DETECT_FALLBACK_2,
        },
        autocomplete: {
            primary: env.AUTOCOMPLETE_MODEL,
            fallback1: env.AUTOCOMPLETE_FALLBACK_1,
            fallback2: env.AUTOCOMPLETE_FALLBACK_2,
        },
        rerank: {
            primary: env.RERANK_MODEL,
            fallback1: env.RERANK_FALLBACK_1,
            fallback2: env.RERANK_FALLBACK_2,
        },
        compact: {
            primary: env.COMPACT_MODEL,
            fallback1: env.COMPACT_FALLBACK_1,
            fallback2: env.COMPACT_FALLBACK_2,
        },
        "session-compact": {
            primary: env.COMPACT_MODEL,
            fallback1: env.COMPACT_FALLBACK_1,
            fallback2: env.COMPACT_FALLBACK_2,
        },
    };

    const chain = chains[task];
    return [chain.primary, chain.fallback1, chain.fallback2].filter(
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
        log?: Logger;
    }
): Promise<LLMResult> {
    const log = options?.log ?? rootLogger;
    const models = getModelChain(task);

    if (models.length === 0) {
        throw new Error(
            `[model-router] No models configured for task "${task}"`
        );
    }

    const [primaryModel, ...fallbackModels] = models;

    // Request timeout via AbortController
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
                maxTokens: options?.maxTokens ?? 16384,
                ...(options?.responseFormat && {
                    responseFormat: options.responseFormat as any,
                }),
                ...(options?.requestId && {
                    trace: {
                        traceId: options.requestId,
                        spanName: task,
                    } as any,
                }),
                plugins: [
                    { id: "response-healing" as const, enabled: true },
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


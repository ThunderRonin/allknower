import { OpenRouter } from "@openrouter/sdk";
import { env } from "../env.ts";

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
    | "rerank";

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
    model: string; // the model that actually succeeded
}

/**
 * Call an LLM via the OpenRouter SDK with native server-side fallbacks.
 *
 * Uses the `models` array — OpenRouter automatically tries the next model
 * in the list if the primary returns an error. This is a single HTTP request;
 * failover happens server-side with zero additional latency.
 */
export async function callWithFallback(
    task: TaskType,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    options?: {
        temperature?: number;
        maxTokens?: number;
        responseFormat?: { type: string };
    }
): Promise<LLMResult> {
    const models = getModelChain(task);

    if (models.length === 0) {
        throw new Error(
            `[model-router] No models configured for task "${task}"`
        );
    }

    const [primaryModel, ...fallbackModels] = models;

    const response = await openrouter.chat.send({
        httpReferer: "https://allknower.local",
        xTitle: "AllKnower",
        chatGenerationParams: {
            model: primaryModel,
            ...(fallbackModels.length > 0 && { models: fallbackModels }),
            messages: messages as any,
            temperature: options?.temperature ?? 0.3,
            maxTokens: options?.maxTokens ?? 4096,
            ...(options?.responseFormat && {
                responseFormat: { type: "json_object" } as any,
            }),
        },
    });

    const raw = (response as any).choices?.[0]?.message?.content ?? "";
    const tokensUsed = (response as any).usage?.total_tokens ?? 0;
    // `response.model` tells us which model actually handled the request
    const usedModel = (response as any).model ?? primaryModel;

    if (usedModel !== primaryModel) {
        console.info(
            `[model-router] "${task}" fell back from ${primaryModel} to ${usedModel}`
        );
    }

    return { raw, tokensUsed, model: usedModel };
}

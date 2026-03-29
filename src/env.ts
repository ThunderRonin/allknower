import { z } from "zod";

/**
 * Typesafe environment variable schema for AllKnower.
 * Validated at startup via Zod.
 */
export const envSchema = z.object({
    PORT: z
        .string()
        .transform(Number)
        .default("3001")
        .pipe(z.number().positive()),
    NODE_ENV: z
        .union([z.literal("development"), z.literal("production"), z.literal("test")])
        .default("development"),

    // Database
    DATABASE_URL: z.string().min(1),

    // better-auth
    BETTER_AUTH_SECRET: z.string().min(16),
    BETTER_AUTH_URL: z.string().default("http://localhost:3001"),

    // OpenRouter
    OPENROUTER_API_KEY: z.string().min(1),
    OPENROUTER_BASE_URL: z.string().default("https://openrouter.ai/api/v1"),

    // OpenRouter auto-routing toggle — overrides all per-task models with "openrouter/auto"
    USE_OPENROUTER_AUTO: z.string().default("false"),

    // LLM Models — per-task primary + up to 2 fallbacks (empty string = disabled)
    BRAIN_DUMP_MODEL: z.string().default("x-ai/grok-4.1-fast"),
    BRAIN_DUMP_FALLBACK_1: z.string().default(""),
    BRAIN_DUMP_FALLBACK_2: z.string().default(""),

    CONSISTENCY_MODEL: z.string().default("moonshotai/kimi-k2.5"),
    CONSISTENCY_FALLBACK_1: z.string().default(""),
    CONSISTENCY_FALLBACK_2: z.string().default(""),

    SUGGEST_MODEL: z.string().default("aion-labs/aion-2.0"),
    SUGGEST_FALLBACK_1: z.string().default(""),
    SUGGEST_FALLBACK_2: z.string().default(""),

    GAP_DETECT_MODEL: z.string().default("aion-labs/aion-2.0"),
    GAP_DETECT_FALLBACK_1: z.string().default(""),
    GAP_DETECT_FALLBACK_2: z.string().default(""),

    AUTOCOMPLETE_MODEL: z.string().default("liquid/lfm-24b"),
    AUTOCOMPLETE_FALLBACK_1: z.string().default(""),
    AUTOCOMPLETE_FALLBACK_2: z.string().default(""),

    RERANK_MODEL: z.string().default("openai/gpt-5-nano"),
    RERANK_FALLBACK_1: z.string().default(""),
    RERANK_FALLBACK_2: z.string().default(""),

    // Embedding Models
    EMBEDDING_CLOUD: z.string().default("qwen/qwen3-embedding-8b"),
    EMBEDDING_DIMENSIONS: z
        .string()
        .transform(Number)
        .default("4096")
        .pipe(z.number().positive()),

    // LLM timeout — per-request AbortController limit in milliseconds
    LLM_TIMEOUT_MS: z
        .string()
        .transform(Number)
        .default("120000")
        .pipe(z.number().positive()),

    // LanceDB
    LANCEDB_PATH: z.string().default("./data/lancedb"),

    // AllCodex ETAPI
    ALLCODEX_URL: z.string().default("http://localhost:8080"),
    ALLCODEX_ETAPI_TOKEN: z.string().min(1),

    // Rate limiting
    BRAIN_DUMP_RATE_LIMIT_MAX: z
        .string()
        .transform(Number)
        .default("10")
        .pipe(z.number().positive()),
    BRAIN_DUMP_RATE_LIMIT_WINDOW_MS: z
        .string()
        .transform(Number)
        .default("60000")
        .pipe(z.number().positive()),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(): Env {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
        console.error("❌ Invalid environment variables:", JSON.stringify(result.error.format(), null, 2));
        process.exit(1);
    }
    return result.data;
}

export const env = parseEnv();

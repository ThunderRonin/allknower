import { z } from "zod";

/**
 * Typesafe environment variable schema for AllKnower.
 * Validated at startup via Zod.
 */
export const envSchema = z.object({
    PORT: z.coerce
        .number()
        .optional()
        .default(3001)
        .pipe(z.number().positive()),
    NODE_ENV: z
        .union([z.literal("development"), z.literal("production"), z.literal("test")])
        .default("development"),

    // Database
    DATABASE_URL: z.string().min(1),

    // better-auth
    BETTER_AUTH_SECRET: z.string().min(16),
    BETTER_AUTH_URL: z.string().default("http://localhost:3001"),
    PORTAL_INTERNAL_SECRET: z.string().default(
        process.env.NODE_ENV === "production" ? "" : "dev-portal-secret-32chars!!!"
    ),
    INTEGRATION_CREDENTIALS_KEY: z.string().default(""),

    // OpenRouter
    OPENROUTER_API_KEY: z.string().min(1),
    OPENROUTER_BASE_URL: z.string().default("https://openrouter.ai/api/v1"),

    // OpenRouter auto-routing toggle — overrides all per-task models with "openrouter/auto"
    USE_OPENROUTER_AUTO: z.string().default("false"),

    // LLM Models — per-task primary + up to 2 fallbacks (empty string = disabled)
    BRAIN_DUMP_MODEL: z.string().default("deepseek/deepseek-v4-pro"),
    BRAIN_DUMP_FALLBACK_1: z.string().default(""),
    BRAIN_DUMP_FALLBACK_2: z.string().default(""),
    BRAIN_DUMP_FALLBACK_3: z.string().default(""),

    ARTICLE_COPILOT_MODEL: z.string().default(""),
    ARTICLE_COPILOT_FALLBACK_1: z.string().default(""),
    ARTICLE_COPILOT_FALLBACK_2: z.string().default(""),
    ARTICLE_COPILOT_FALLBACK_3: z.string().default(""),

    CONSISTENCY_MODEL: z.string().default("deepseek/deepseek-v4-pro"),
    CONSISTENCY_FALLBACK_1: z.string().default(""),
    CONSISTENCY_FALLBACK_2: z.string().default(""),
    CONSISTENCY_FALLBACK_3: z.string().default(""),

    SUGGEST_MODEL: z.string().default("google/gemini-3.1-flash-lite"),
    SUGGEST_FALLBACK_1: z.string().default(""),
    SUGGEST_FALLBACK_2: z.string().default(""),
    SUGGEST_FALLBACK_3: z.string().default(""),

    GAP_DETECT_MODEL: z.string().default("deepseek/deepseek-v4-pro"),
    GAP_DETECT_FALLBACK_1: z.string().default(""),
    GAP_DETECT_FALLBACK_2: z.string().default(""),
    GAP_DETECT_FALLBACK_3: z.string().default(""),

    AUTOCOMPLETE_MODEL: z.string().default("openai/gpt-5-nano"),
    AUTOCOMPLETE_FALLBACK_1: z.string().default(""),
    AUTOCOMPLETE_FALLBACK_2: z.string().default(""),
    AUTOCOMPLETE_FALLBACK_3: z.string().default(""),

    RERANK_MODEL: z.string().default("cohere/rerank-4-pro"),
    RAG_HYBRID_VECTOR_K: z.coerce.number().optional().default(0),
    RAG_HYBRID_BM25_K: z.coerce.number().optional().default(0),
    RAG_HYBRID_RRF_K: z.coerce.number().optional().default(60),
    RAG_VECTOR_SIMILARITY_THRESHOLD: z.coerce.number().optional().default(0.3),
    RAG_RERANK_TOP_N: z.coerce.number().optional().default(10),
    RAG_RERANK_DOC_MAX_CHARS: z.coerce.number().optional().default(2048),
    RAG_RERANK_ENABLED: z.string().default("true"),

    // Embedding Models
    EMBEDDING_CLOUD: z.string().default("qwen/qwen3-embedding-8b"),
    EMBEDDING_DIMENSIONS: z.coerce
        .number()
        .optional()
        .default(4096)
        .pipe(z.number().positive()),

    // Streaming timeouts (user-facing pipelines)
    LLM_FIRST_CHUNK_TIMEOUT_MS: z.coerce.number().optional().default(30000).pipe(z.number().positive()),
    LLM_INACTIVITY_TIMEOUT_MS: z.coerce.number().optional().default(15000).pipe(z.number().positive()),
    LLM_MAX_DURATION_MS: z.coerce.number().optional().default(300000).pipe(z.number().positive()),

    // Legacy: non-streaming per-request timeout (used by callWithFallback only).
    // Streaming routes use LLM_FIRST_CHUNK_TIMEOUT_MS / LLM_INACTIVITY_TIMEOUT_MS / LLM_MAX_DURATION_MS.
    LLM_TIMEOUT_MS: z.coerce
        .number()
        .optional()
        .default(120000)
        .pipe(z.number().positive()),

    // OpenRouter provider routing preferences
    // OPENROUTER_SORT: route all tasks to the cheapest / fastest / highest-quality provider
    OPENROUTER_SORT: z
        .enum(["price", "throughput", "latency"])
        .optional(),
    // OPENROUTER_ZDR: "true" enables Zero Data Retention (only routes to ZDR providers)
    OPENROUTER_ZDR: z.string().default("false"),

    // Context compaction — Tier 1: RAG budget
    RAG_CONTEXT_MAX_TOKENS: z.coerce.number().default(6000),

    // Context compaction — Tier 1.5: dedup
    RAG_CHUNK_DEDUP_SIMILARITY_THRESHOLD: z.coerce.number().default(0.85),

    // Context compaction — Tier 2: chunk summarization
    RAG_CHUNK_SUMMARY_THRESHOLD_TOKENS: z.coerce.number().default(600),
    COMPACT_MODEL: z.string().default("qwen/qwen3.5-flash-02-23"),
    COMPACT_FALLBACK_1: z.string().default("openai/gpt-5-nano"),
    COMPACT_FALLBACK_2: z.string().default(""),
    COMPACT_FALLBACK_3: z.string().default(""),

    // Context compaction — Tier 3: session autocompact (future)
    SESSION_TOKEN_THRESHOLD: z.coerce.number().default(80000),

    // LanceDB
    LANCEDB_PATH: z.string().default("./data/lancedb"),

    // AllCodex ETAPI
    ALLCODEX_URL: z.string().default("http://localhost:8080"),
    ALLCODEX_ETAPI_TOKEN: z.string().min(1),
    ALLCODEX_PASSWORD: z.string().default(""),

    // Rate limiting
    BRAIN_DUMP_RATE_LIMIT_MAX: z.coerce
        .number()
        .optional()
        .default(10)
        .pipe(z.number().positive()),
    BRAIN_DUMP_RATE_LIMIT_WINDOW_MS: z.coerce
        .number()
        .optional()
        .default(60000)
        .pipe(z.number().positive()),

    AI_RATE_LIMIT_MAX: z.coerce
        .number()
        .optional()
        .default(20)
        .pipe(z.number().positive()),
    AI_RATE_LIMIT_WINDOW_MS: z.coerce
        .number()
        .optional()
        .default(60000)
        .pipe(z.number().positive()),

    // VAPID keys for web push notifications
    VAPID_PUBLIC_KEY: z.string().default(""),
    VAPID_PRIVATE_KEY: z.string().default(""),
    VAPID_SUBJECT: z.string().default("mailto:admin@example.com"),

    // Resend (email notifications)
    RESEND_API_KEY: z.string().default(""),
    RESEND_FROM_EMAIL: z.string().default("noreply@allcodex.local"),
}).superRefine((value, ctx) => {
    const rawKey = value.INTEGRATION_CREDENTIALS_KEY;
    const isValidKey =
        rawKey.length === 0 ||
        /^[0-9a-f]{64}$/i.test(rawKey) ||
        Buffer.from(rawKey, "base64").length === 32 ||
        Buffer.byteLength(rawKey, "utf8") === 32;

    if (!isValidKey) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["INTEGRATION_CREDENTIALS_KEY"],
            message: "Must be 32 bytes as utf8, 64 hex chars, or base64-encoded 32 bytes.",
        });
    }

    if (value.NODE_ENV === "production" && rawKey.length === 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["INTEGRATION_CREDENTIALS_KEY"],
            message: "Required in production.",
        });
    }

    if (value.NODE_ENV === "production" && value.PORTAL_INTERNAL_SECRET.length < 16) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["PORTAL_INTERNAL_SECRET"],
            message: "Must be at least 16 characters in production.",
        });
    }
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

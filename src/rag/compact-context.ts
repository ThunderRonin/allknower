import type { RagChunk } from "../types/lore.ts";
import type { TaskType } from "../pipeline/model-router.ts";
import { countTokens } from "../utils/tokens.ts";
import { deduplicateChunks } from "./chunk-dedup.ts";
import { compactChunks } from "./chunk-compactor.ts";
import { env } from "../env.ts";
import { rootLogger } from "../logger.ts";

/**
 * Per-task RAG token budgets.
 *
 * Each AI route has different context capacity needs:
 * - brain-dump: large budget — entity extraction benefits from rich context
 * - article-copilot / consistency: medium budget — focused analysis
 * - suggest: medium-low — relationship suggestions need less context
 * - autocomplete: minimal — speed is critical, context is supplementary
 * - gap-detect: moderate — needs enough to spot missing connections
 */
const DEFAULT_TASK_RAG_BUDGETS: Partial<Record<TaskType, number>> = {
    "brain-dump": 6000,
    "article-copilot": 4000,
    consistency: 4000,
    suggest: 3000,
    autocomplete: 1000,
    "gap-detect": 2000,
};

function getTaskBudget(task?: TaskType): number {
    if (task && DEFAULT_TASK_RAG_BUDGETS[task]) return DEFAULT_TASK_RAG_BUDGETS[task];
    return env.RAG_CONTEXT_MAX_TOKENS;
}

export interface CompactRagOptions {
    /** Which task is requesting context — selects per-task token budget. */
    task?: TaskType;
    /** Explicit token budget override — takes precedence over task-based budget. */
    maxTokens?: number;
    /** Skip Tier 2 LLM summarization (for latency-sensitive routes). */
    skipSummarization?: boolean;
}

/**
 * Compact RAG chunks through a multi-tier pipeline:
 *
 *   Tier 1.5 — Deduplicate near-identical chunks (trigram Jaccard)
 *   Tier 1   — Budget enforcement: admit chunks in relevance order
 *   Tier 2   — LLM summarization of oversized admitted chunks (optional)
 *
 * Chunks are assumed pre-sorted by relevance (highest score first).
 */
export async function compactRagContext(
    chunks: RagChunk[],
    options: CompactRagOptions = {},
): Promise<RagChunk[]> {
    if (chunks.length === 0) return [];

    const budget = options.maxTokens ?? getTaskBudget(options.task);

    // Tier 1.5: deduplicate near-identical chunks
    const deduped = deduplicateChunks(chunks);

    // Tier 1: budget enforcement — admit chunks in relevance order
    let budgetUsed = 0;
    const admitted: RagChunk[] = [];

    for (const chunk of deduped) {
        const chunkTokens = countTokens(chunk.content);
        if (budgetUsed + chunkTokens <= budget) {
            admitted.push(chunk);
            budgetUsed += chunkTokens;
        } else if (budgetUsed >= budget) {
            break; // hard stop once full
        }
        // else: skip this oversized chunk but continue looking for smaller ones
    }

    rootLogger.info("RAG compaction", {
        task: options.task ?? "unknown",
        totalChunks: chunks.length,
        afterDedup: deduped.length,
        admitted: admitted.length,
        budgetUsed,
        budget,
    });

    // Tier 2: LLM summarization (skip for latency-sensitive routes)
    if (options.skipSummarization) return admitted;

    const compacted = await compactChunks(admitted);

    const postBudget = compacted.reduce((sum, c) => sum + countTokens(c.content), 0);
    const freed = budgetUsed - postBudget;
    if (freed > 0) {
        rootLogger.info("Tier 2 freed tokens", { freed, postBudget, task: options.task });
    }

    return compacted;
}

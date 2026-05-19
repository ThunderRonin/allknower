// test/helpers/mock-llm.ts
// Side-effect file: mock.module() calls execute on import
import { mock } from "bun:test";

export const LLM_RESPONSES: Record<string, string> = {
    "brain-dump": JSON.stringify({
        entities: [
            {
                type: "character",
                title: "Aldric",
                content: "<p>Aldric is the king of Valorheim.</p>",
                action: "create",
                attributes: { role: "King", affiliation: "Valorheim" },
            },
        ],
        summary: "Extracted Aldric from brain dump.",
    }),
    "brain-dump-review": JSON.stringify({
        entities: [
            {
                type: "character",
                title: "Aldric",
                content: "<p>Aldric is the king of Valorheim.</p>",
                action: "create",
                status: "proposed",
                attributes: { role: "King", affiliation: "Valorheim" },
            },
        ],
        summary: "Review: found Aldric.",
    }),
    "session-compact": JSON.stringify({
        intent: "Building lore for Valorheim kingdom",
        loreTypesInPlay: ["character", "location"],
        noteIdsModified: ["note-1"],
        skippedEntities: [],
        rawInputsSummary: "User described Aldric as king of Valorheim.",
        unresolvedGaps: [],
        currentFocus: "Aldric",
        lastCompactedAt: new Date().toISOString(),
        totalTokensConsumed: 85000,
        schemaVersion: 1,
    }),
    "article-copilot": JSON.stringify({
        assistantMessage: "Aldric is a compelling character. Consider adding his lineage.",
        proposal: null,
        citations: [],
    }),
    "consistency-check": JSON.stringify({
        issues: [
            {
                noteId: "note-1",
                noteTitle: "Aldric",
                issue: "Missing birth year",
                severity: "low",
                suggestion: "Add birth year to character profile",
            },
        ],
    }),
    "gap-detect": JSON.stringify({
        areas: [
            {
                category: "character",
                gap: "No antagonist defined",
                suggestion: "Create a rival character",
            },
        ],
    }),
    "suggest-relations": JSON.stringify({
        suggestions: [
            {
                sourceNoteId: "note-1",
                targetNoteId: "note-2",
                type: "rulerOf",
                name: "rules",
                description: "Aldric rules Valorheim",
                confidence: 0.9,
            },
        ],
    }),
};

mock.module("../../src/pipeline/model-router.ts", () => ({
    callWithFallback: mock(async (task: string) => {
        const raw = LLM_RESPONSES[task] ?? LLM_RESPONSES["brain-dump"];
        return { raw, tokensUsed: 50, model: "test-model", latencyMs: 10 };
    }),
    getModelChain: mock((task: string) => [`test-model-${task}`]),
    callModelStream: mock(async function* (task: string) {
        const raw = LLM_RESPONSES[task] ?? LLM_RESPONSES["brain-dump"];
        yield { type: "done" as const, raw, tokensUsed: 50, model: "test-model", latencyMs: 10 };
    }),
}));

mock.module("../../src/pipeline/prompt.ts", () => ({
    buildBrainDumpPrompt: mock(() => ({
        system: "You are a lore extractor.",
        context: "World: Valorheim",
        user: "Aldric is the king.",
    })),
    callLLM: mock(async (task: string) => {
        const raw = LLM_RESPONSES[task] ?? LLM_RESPONSES["brain-dump"];
        return { raw, tokensUsed: 50, model: "test-model", latencyMs: 10 };
    }),
    callLLMStream: mock(async function* () {
        yield {
            type: "done" as const,
            raw: LLM_RESPONSES["brain-dump"],
            tokensUsed: 50,
            model: "test-model",
            latencyMs: 10,
        };
    }),
}));

import { mock } from "bun:test";

mock.module("../env.ts", () => ({
    env: {
        OPENROUTER_API_KEY: "test",
        LLM_TIMEOUT_MS: 5000,
        OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
        DATABASE_URL: "postgresql://test:test@localhost:5432/test",
        NODE_ENV: "test",
    },
}));

const mockSuggestRelationsForNote = mock(async () => [
    {
        targetNoteId: "note-b",
        targetTitle: "Aria Vale",
        relationshipType: "ally",
        description: "They fought together.",
        confidence: "high" as const,
    },
]);

mock.module("./relations.ts", () => ({
    suggestRelationsForNote: mockSuggestRelationsForNote,
    applyRelations: mock(async () => ({ applied: [], skipped: [], failed: [] })),
}));

const mockFindUnique = mock(async (): Promise<Record<string, unknown> | null> => null);
const mockUpsert = mock(async () => ({}));
const mockDeleteMany = mock(async () => ({ count: 0 }));

mock.module("../db/client.ts", () => ({
    default: {
        relationSuggestion: {
            findUnique: mockFindUnique,
            upsert: mockUpsert,
            deleteMany: mockDeleteMany,
        },
        relationHistory: { create: mock(async () => ({})) },
        ragIndexMeta: { upsert: mock(async () => ({})), findMany: mock(async () => []) },
    },
}));

mock.module("../rag/lancedb.ts", () => ({
    queryLore: mock(async () => []),
    upsertNoteChunks: mock(async () => {}),
    chunkText: mock(() => []),
    deleteNoteChunks: mock(async () => {}),
}));

mock.module("../rag/compact-context.ts", () => ({
    compactRagContext: mock(async (chunks: unknown[]) => chunks),
}));

mock.module("./prompt.ts", () => ({
    callLLM: mock(async () => ({
        raw: JSON.stringify({ suggestions: [] }),
        tokensUsed: 0,
        model: "test",
        latencyMs: 0,
    })),
}));

mock.module("../etapi/client.ts", () => ({
    createRelation: mock(async () => ({ relationName: "relAlly", skipped: false })),
    deleteNote: mock(async () => {}),
    getAllCodexNotes: mock(async () => []),
    getNote: mock(async () => ({ noteId: "n", attributes: [] })),
    getNoteContent: mock(async () => ""),
    createNote: mock(async () => ({ note: { noteId: "n" }, branch: {} })),
    tagNote: mock(async () => {}),
    setNoteTemplate: mock(async () => {}),
    setNoteContent: mock(async () => {}),
    updateNote: mock(async (id: string) => ({ noteId: id })),
    createAttribute: mock(async () => ({})),
    checkAllCodexHealth: mock(async () => ({ ok: true })),
    probeAllCodex: mock(async () => ({ ok: true })),
    invalidateCredentialCache: mock(() => {}),
}));

import { beforeEach, describe, expect, it } from "bun:test";
import {
    computeContentHash,
    getOrComputeSuggestions,
    invalidateSuggestionCache,
} from "./suggestion-cache.ts";

beforeEach(() => {
    mockSuggestRelationsForNote.mockClear();
    mockFindUnique.mockClear();
    mockUpsert.mockClear();
    mockDeleteMany.mockClear();

    mockSuggestRelationsForNote.mockResolvedValue([
        {
            targetNoteId: "note-b",
            targetTitle: "Aria Vale",
            relationshipType: "ally",
            description: "They fought together.",
            confidence: "high" as const,
        },
    ]);
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockResolvedValue({});
    mockDeleteMany.mockResolvedValue({ count: 0 });
});

describe("computeContentHash", () => {
    it("returns consistent hex string for same input", () => {
        const a = computeContentHash("[Aldric]\nA warrior king.");
        const b = computeContentHash("[Aldric]\nA warrior king.");
        expect(a).toBe(b);
        expect(a).toMatch(/^[a-f0-9]{64}$/);
    });

    it("returns different hash for different content", () => {
        const a = computeContentHash("[Aldric]\nA warrior king.");
        const b = computeContentHash("[Aldric]\nA peaceful monk.");
        expect(a).not.toBe(b);
    });

    it("returns different hash for different title same content", () => {
        const a = computeContentHash("[Aldric]\nRuler of the north.");
        const b = computeContentHash("[Seraphina]\nRuler of the north.");
        expect(a).not.toBe(b);
    });
});

describe("getOrComputeSuggestions", () => {
    const baseOpts = {
        noteId: "note-a",
        text: "[Aldric]\nA warrior king.",
        userId: "user-1",
    };

    it("returns cached suggestions when contentHash matches", async () => {
        const hash = computeContentHash("[Aldric]\nA warrior king.");
        mockFindUnique.mockResolvedValue({
            contentHash: hash,
            suggestions: [
                {
                    targetNoteId: "note-c",
                    targetTitle: "Cached",
                    relationshipType: "enemy",
                    description: "From cache.",
                    confidence: "medium",
                },
            ],
        });

        const result = await getOrComputeSuggestions(baseOpts);
        expect(result).toHaveLength(1);
        expect(result[0].targetTitle).toBe("Cached");
        expect(mockSuggestRelationsForNote).not.toHaveBeenCalled();
    });

    it("recomputes when contentHash differs (stale cache)", async () => {
        mockFindUnique.mockResolvedValue({
            contentHash: "stale-hash",
            suggestions: [{ targetNoteId: "old", relationshipType: "ally", description: "old" }],
        });

        const result = await getOrComputeSuggestions(baseOpts);
        expect(mockSuggestRelationsForNote).toHaveBeenCalledTimes(1);
        expect(result[0].targetNoteId).toBe("note-b");
    });

    it("recomputes when no cache entry exists", async () => {
        mockFindUnique.mockResolvedValue(null);

        const result = await getOrComputeSuggestions(baseOpts);
        expect(mockSuggestRelationsForNote).toHaveBeenCalledTimes(1);
        expect(result).toHaveLength(1);
    });

    it("force=true bypasses cache", async () => {
        const hash = computeContentHash("[Aldric]\nA warrior king.");
        mockFindUnique.mockResolvedValue({
            contentHash: hash,
            suggestions: [{ targetNoteId: "cached", relationshipType: "ally", description: "cached" }],
        });

        const result = await getOrComputeSuggestions({ ...baseOpts, force: true });
        expect(mockSuggestRelationsForNote).toHaveBeenCalledTimes(1);
        expect(result[0].targetNoteId).toBe("note-b");
    });

    it("persists suggestions after LLM compute", async () => {
        await getOrComputeSuggestions(baseOpts);
        expect(mockUpsert).toHaveBeenCalledTimes(1);
        expect(mockUpsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { noteId_userId: { noteId: "note-a", userId: "user-1" } },
                create: expect.objectContaining({
                    noteId: "note-a",
                    userId: "user-1",
                }),
            })
        );
    });

    it("deduplicates concurrent requests for same noteId+userId", async () => {
        let resolveCompute!: Function;
        (mockSuggestRelationsForNote as any).mockImplementation(
            () => new Promise((resolve: Function) => { resolveCompute = resolve; })
        );

        const p1 = getOrComputeSuggestions(baseOpts);
        // Yield so p1's findUnique await resolves and suggestRelationsForNote is invoked
        await new Promise((r) => setTimeout(r, 10));

        const p2 = getOrComputeSuggestions(baseOpts);

        resolveCompute([
            { targetNoteId: "note-b", targetTitle: "Aria", relationshipType: "ally", description: "test", confidence: "high" },
        ]);

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(mockSuggestRelationsForNote).toHaveBeenCalledTimes(1);
        expect(r1).toEqual(r2);
    });

    it("non-fatal: returns suggestions even when persist fails", async () => {
        mockUpsert.mockRejectedValue(new Error("DB write error"));

        const result = await getOrComputeSuggestions(baseOpts);
        expect(result).toHaveLength(1);
        expect(result[0].targetNoteId).toBe("note-b");
    });

    it("recomputes when cached JSON fails Zod validation", async () => {
        const hash = computeContentHash("[Aldric]\nA warrior king.");
        mockFindUnique.mockResolvedValue({
            contentHash: hash,
            suggestions: [{ bad: "shape" }],
        });

        const result = await getOrComputeSuggestions(baseOpts);
        expect(mockSuggestRelationsForNote).toHaveBeenCalledTimes(1);
        expect(result[0].targetNoteId).toBe("note-b");
    });
});

describe("invalidateSuggestionCache", () => {
    it("calls deleteMany with noteId filter", async () => {
        await invalidateSuggestionCache("note-a");
        expect(mockDeleteMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { noteId: "note-a" } })
        );
    });

    it("adds userId filter when provided", async () => {
        await invalidateSuggestionCache("note-a", "user-1");
        expect(mockDeleteMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { noteId: "note-a", userId: "user-1" } })
        );
    });

    it("non-fatal: does not throw on DB error", async () => {
        mockDeleteMany.mockRejectedValue(new Error("DB error"));
        await expect(invalidateSuggestionCache("note-a")).resolves.toBeUndefined();
    });
});

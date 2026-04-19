import { mock } from "bun:test";

mock.module("../env.ts", () => ({
    env: {
        OPENROUTER_API_KEY: "test",
        LLM_TIMEOUT_MS: 5000,
        OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    },
}));

const mockQueryLore = mock(async () => [
    { noteId: "note-b", noteTitle: "Aria Vale", content: "A ranger from the north.", score: 0.9 },
]);

const mockCallLLM = mock(async () => ({
    raw: JSON.stringify({
        suggestions: [
            { targetNoteId: "note-b", targetTitle: "Aria Vale", relationshipType: "ally", description: "They fought together.", confidence: "high" },
        ],
    }),
    tokensUsed: 100,
    model: "test",
    latencyMs: 50,
}));

const mockCreateRelation = mock(async () => {});
const mockRelationHistoryCreate = mock(async () => ({}));

mock.module("../rag/lancedb.ts", () => ({
    queryLore: mockQueryLore,
    upsertNoteChunks: mock(async () => {}),
    chunkText: mock(() => []),
    deleteNoteChunks: mock(async () => {}),
}));

mock.module("./prompt.ts", () => ({
    callLLM: mockCallLLM,
}));

mock.module("../etapi/client.ts", () => ({
    createRelation: mockCreateRelation,
    getAllCodexNotes: mock(async () => []),
    getNoteContent: mock(async () => ""),
    createNote: mock(async () => ({ note: { noteId: "n" }, branch: {} })),
    tagNote: mock(async () => {}),
    setNoteTemplate: mock(async () => {}),
    setNoteContent: mock(async () => {}),
    updateNote: mock(async (id: string) => ({ noteId: id })),
    probeAllCodex: mock(async () => ({ ok: true })),
}));

mock.module("../db/client.ts", () => ({
    default: {
        relationHistory: {
            create: mockRelationHistoryCreate,
        },
        ragIndexMeta: {
            upsert: mock(async () => ({})),
            findMany: mock(async () => []),
        },
    },
}));

import { beforeEach, describe, expect, it } from "bun:test";
import { suggestRelationsForNote, applyRelations } from "./relations.ts";

beforeEach(() => {
    mockQueryLore.mockClear();
    mockCallLLM.mockClear();
    mockCreateRelation.mockClear();
    mockRelationHistoryCreate.mockClear();

    mockQueryLore.mockResolvedValue([
        { noteId: "note-b", noteTitle: "Aria Vale", content: "A ranger from the north.", score: 0.9 },
    ]);
    mockCallLLM.mockResolvedValue({
        raw: JSON.stringify({
            suggestions: [
                { targetNoteId: "note-b", targetTitle: "Aria Vale", relationshipType: "ally", description: "They fought together.", confidence: "high" },
            ],
        }),
        tokensUsed: 100,
        model: "test",
        latencyMs: 50,
    });
    mockCreateRelation.mockResolvedValue(undefined);
    mockRelationHistoryCreate.mockResolvedValue({});
});

describe("suggestRelationsForNote", () => {
    it("calls queryLore with noteContent and limit=15", async () => {
        await suggestRelationsForNote("note-a", "Aldric is a warrior king.");
        expect(mockQueryLore).toHaveBeenCalledWith("Aldric is a warrior king.", 15);
    });

    it("returns [] when queryLore returns empty array", async () => {
        mockQueryLore.mockResolvedValue([]);
        const result = await suggestRelationsForNote("note-a", "Some content.");
        expect(result).toEqual([]);
    });

    it("calls callLLM with system message, user message, and suggest task", async () => {
        await suggestRelationsForNote("note-a", "Aldric is the king.");
        expect(mockCallLLM).toHaveBeenCalledWith(
            expect.any(String), // system
            expect.any(String), // user
            "suggest",          // task
            expect.any(String), // context
            expect.any(Object)  // options
        );
    });

    it("parses and validates LLM response against SuggestRelationsResponseSchema", async () => {
        const result = await suggestRelationsForNote("note-a", "Content.");
        expect(result).toHaveLength(1);
        expect(result[0].targetNoteId).toBe("note-b");
        expect(result[0].relationshipType).toBe("ally");
    });

    it("filters out self-referential suggestions when noteId !== 'unknown'", async () => {
        mockCallLLM.mockResolvedValue({
            raw: JSON.stringify({
                suggestions: [
                    { targetNoteId: "note-a", targetTitle: "Self", relationshipType: "ally", description: "Self-ref." },
                    { targetNoteId: "note-b", targetTitle: "Other", relationshipType: "enemy", description: "Enemy." },
                ],
            }),
            tokensUsed: 50,
            model: "test",
            latencyMs: 10,
        });
        const result = await suggestRelationsForNote("note-a", "Content.");
        expect(result.every((s) => s.targetNoteId !== "note-a")).toBe(true);
        expect(result).toHaveLength(1);
    });

    it("does NOT filter self-refs when noteId === 'unknown'", async () => {
        mockCallLLM.mockResolvedValue({
            raw: JSON.stringify({
                suggestions: [
                    { targetNoteId: "unknown", targetTitle: "Unknown", relationshipType: "ally", description: "Self." },
                ],
            }),
            tokensUsed: 10,
            model: "test",
            latencyMs: 5,
        });
        const result = await suggestRelationsForNote("unknown", "Content.");
        expect(result).toHaveLength(1);
    });

    it("returns [] when LLM response fails Zod validation", async () => {
        mockCallLLM.mockResolvedValue({
            raw: JSON.stringify({ suggestions: [{ bad: "shape" }] }),
            tokensUsed: 10,
            model: "test",
            latencyMs: 5,
        });
        const result = await suggestRelationsForNote("note-a", "Content.");
        expect(result).toEqual([]);
    });

    it("returns [] when LLM response is invalid JSON", async () => {
        mockCallLLM.mockResolvedValue({
            raw: "Not JSON at all",
            tokensUsed: 5,
            model: "test",
            latencyMs: 5,
        });
        const result = await suggestRelationsForNote("note-a", "Content.");
        expect(result).toEqual([]);
    });
});

describe("applyRelations", () => {
    const validRelations = [
        { targetNoteId: "note-b", relationshipType: "ally", description: "Fought together." },
    ];

    it("calls createRelation for each relation in array", async () => {
        await applyRelations("note-a", validRelations);
        expect(mockCreateRelation).toHaveBeenCalledTimes(1);
        expect(mockCreateRelation).toHaveBeenCalledWith(
            "note-a",
            "note-b",
            "ally",
            expect.objectContaining({ bidirectional: true, description: "Fought together." })
        );
    });

    it("calls prisma.relationHistory.create for each successful relation", async () => {
        await applyRelations("note-a", validRelations);
        expect(mockRelationHistoryCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ sourceNoteId: "note-a", targetNoteId: "note-b" }),
            })
        );
    });

    it("returns applied array with targetNoteId and type", async () => {
        const result = await applyRelations("note-a", validRelations);
        expect(result.applied).toHaveLength(1);
        expect(result.applied[0]).toEqual({ targetNoteId: "note-b", type: "ally" });
    });

    it("non-fatal: continues when one createRelation throws", async () => {
        mockCreateRelation.mockRejectedValue(new Error("ETAPI error"));
        const result = await applyRelations("note-a", validRelations);
        expect(result.failed).toHaveLength(1);
        expect(result.applied).toHaveLength(0);
    });

    it("failed relation goes to failed array with reason", async () => {
        mockCreateRelation.mockRejectedValue(new Error("Network timeout"));
        const result = await applyRelations("note-a", validRelations);
        expect(result.failed[0].reason).toContain("Network timeout");
    });

    it("failed relation does NOT write to RelationHistory", async () => {
        mockCreateRelation.mockRejectedValue(new Error("Error"));
        await applyRelations("note-a", validRelations);
        expect(mockRelationHistoryCreate).not.toHaveBeenCalled();
    });

    it("bidirectional=true passed to createRelation by default", async () => {
        await applyRelations("note-a", validRelations, {});
        expect(mockCreateRelation).toHaveBeenCalledWith(
            expect.any(String), expect.any(String), expect.any(String),
            expect.objectContaining({ bidirectional: true })
        );
    });

    it("bidirectional=false respected when provided", async () => {
        await applyRelations("note-a", validRelations, { bidirectional: false });
        expect(mockCreateRelation).toHaveBeenCalledWith(
            expect.any(String), expect.any(String), expect.any(String),
            expect.objectContaining({ bidirectional: false })
        );
    });

    it("empty relations array → returns { applied: [], failed: [] }", async () => {
        const result = await applyRelations("note-a", []);
        expect(result).toEqual({ applied: [], failed: [] });
    });
});

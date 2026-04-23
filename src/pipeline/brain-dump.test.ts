import { mock } from "bun:test";

// ── Mock refs — created before mock.module so factories can capture them ──────
const queryLoreMock = mock(async () => [] as Array<{ noteId: string; noteTitle: string; content: string; score: number }>);
const probeAllCodexMock = mock(async (): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true }));
const callLLMMock = mock(async () => ({
    raw: '{"entities":[],"summary":"no entities"}',
    tokensUsed: 0,
    model: "test",
    latencyMs: 0,
}));
const parseBrainDumpResponseMock = mock(() => ({ entities: [] as never[], summary: "no entities" }));
const createNoteMock = mock(async () => ({ note: { noteId: "new-note-id" }, branch: {} as unknown }));
const updateNoteMock = mock(async (id: string) => ({ noteId: id }));
const setNoteContentMock = mock(async () => {});
const setNoteTemplateMock = mock(async () => {});
const tagNoteMock = mock(async () => {});
const createAttributeMock = mock(async () => {});
const brainDumpFindFirstMock = mock(async () => null as null | Record<string, unknown>);
const brainDumpCreateMock = mock(async () => ({}));
const suggestRelationsMock = mock(async () => [] as never[]);
const applyRelationsMock = mock(async () => ({ applied: [] as never[], failed: [] as never[] }));

mock.module("../rag/lancedb.ts", () => ({
    queryLore: queryLoreMock,
    upsertNoteChunks: mock(async () => {}),
    chunkText: mock(() => []),
    deleteNoteChunks: mock(async () => {}),
    checkLanceDbHealth: mock(async () => ({ ok: true })),
}));

mock.module("./prompt.ts", () => ({
    buildBrainDumpPrompt: mock(async () => ({
        system: "sys",
        context: "ctx",
        user: "usr",
        admittedChunks: [],
    })),
    callLLM: callLLMMock,
}));

mock.module("./parser.ts", () => ({
    parseBrainDumpResponse: parseBrainDumpResponseMock,
}));

mock.module("../etapi/client.ts", () => ({
    probeAllCodex: probeAllCodexMock,
    createNote: createNoteMock,
    setNoteContent: setNoteContentMock,
    updateNote: updateNoteMock,
    setNoteTemplate: setNoteTemplateMock,
    tagNote: tagNoteMock,
    createAttribute: createAttributeMock,
    getAllCodexNotes: mock(async () => []),
    getNoteContent: mock(async () => ""),
    createRelation: mock(async () => {}),
    checkAllCodexHealth: mock(async () => ({ ok: true })),
    invalidateCredentialCache: mock(() => {}),
}));

mock.module("../db/client.ts", () => ({
    default: {
        appConfig: { findUnique: mock(async () => null) },
        brainDumpHistory: {
            findFirst: brainDumpFindFirstMock,
            create: brainDumpCreateMock,
        },
        ragIndexMeta: {
            upsert: mock(async () => ({})),
            findMany: mock(async () => []),
        },
        relationHistory: { create: mock(async () => ({})) },
    },
}));

mock.module("./relations.ts", () => ({
    suggestRelationsForNote: suggestRelationsMock,
    applyRelations: applyRelationsMock,
}));

mock.module("../logger.ts", () => ({
    rootLogger: {
        info: mock(() => {}),
        warn: mock(() => {}),
        error: mock(() => {}),
        debug: mock(() => {}),
    },
}));

// ── Imports after mocks ───────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from "bun:test";
import { runBrainDump, commitReviewedEntities } from "./brain-dump.ts";
import type { ProposedEntity } from "./brain-dump.ts";

// Minimal entity that brain-dump.ts's write path will process correctly
const DEFAULT_CREATE_ENTITY = {
    title: "Aldric the Bold",
    type: "character",
    action: "create" as const,
    content: "A brave warrior of the realm.",
    attributes: { alignment: "lawful good" },
    tags: ["protagonist"],
};

const ALL_MOCKS = [
    queryLoreMock, probeAllCodexMock, callLLMMock, parseBrainDumpResponseMock,
    createNoteMock, updateNoteMock, setNoteContentMock, setNoteTemplateMock,
    tagNoteMock, createAttributeMock, brainDumpFindFirstMock, brainDumpCreateMock,
    suggestRelationsMock, applyRelationsMock,
] as const;

beforeEach(() => {
    ALL_MOCKS.forEach((m) => m.mockClear());

    // Restore defaults so each test starts from a known-good state
    probeAllCodexMock.mockResolvedValue({ ok: true });
    queryLoreMock.mockResolvedValue([]);
    brainDumpFindFirstMock.mockResolvedValue(null);
    parseBrainDumpResponseMock.mockReturnValue({ entities: [] as never[], summary: "no entities" });
    callLLMMock.mockResolvedValue({ raw: '{"entities":[],"summary":"no entities"}', tokensUsed: 0, model: "test", latencyMs: 0 });
    createNoteMock.mockResolvedValue({ note: { noteId: "new-note-id" }, branch: {} });
    brainDumpCreateMock.mockResolvedValue({});
    suggestRelationsMock.mockResolvedValue([]);
    applyRelationsMock.mockResolvedValue({ applied: [], failed: [] });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("runBrainDump — inbox mode", () => {
    it("returns immediately without calling probeAllCodex or the LLM", async () => {
        const result = await runBrainDump("anything", "inbox");

        expect(result).toEqual({ mode: "inbox", queued: true });
        expect(probeAllCodexMock).not.toHaveBeenCalled();
        expect(callLLMMock).not.toHaveBeenCalled();
    });
});

describe("runBrainDump — preflight", () => {
    it("throws when AllCodex probe returns ok: false", async () => {
        probeAllCodexMock.mockResolvedValue({ ok: false, error: "connection refused" });

        await expect(
            runBrainDump("lore text about Aldric", "auto")
        ).rejects.toThrow("AllCodex is not connected");
    });
});

describe("runBrainDump — auto mode (cache)", () => {
    it("returns cached result and skips LLM when a history hash match exists", async () => {
        brainDumpFindFirstMock.mockResolvedValue({
            id: "history-1",
            notesCreated: ["note-1"],
            notesUpdated: [],
            parsedJson: { entities: [], summary: "a prior result" },
            model: "gpt-4",
        });

        const result = await runBrainDump("same lore text", "auto") as { summary: string };

        expect(result.summary).toMatch(/^\[cached\]/);
        expect(callLLMMock).not.toHaveBeenCalled();
    });

    it("does not use cache for review mode", async () => {
        brainDumpFindFirstMock.mockResolvedValue({
            id: "history-1",
            parsedJson: { entities: [], summary: "cached" },
            model: "test",
        });

        const result = await runBrainDump("same lore text", "review") as { mode: string };

        expect(result.mode).toBe("review");
        expect(callLLMMock).toHaveBeenCalled();
    });
});

describe("runBrainDump — review mode", () => {
    it("returns proposed entities without calling createNote", async () => {
        parseBrainDumpResponseMock.mockReturnValue({
            entities: [DEFAULT_CREATE_ENTITY as never],
            summary: "Review: one new character",
        });

        const result = await runBrainDump("lore text", "review") as {
            mode: string;
            proposedEntities: unknown[];
            summary: string;
        };

        expect(result.mode).toBe("review");
        expect(Array.isArray(result.proposedEntities)).toBe(true);
        expect(result.proposedEntities).toHaveLength(1);
        expect(createNoteMock).not.toHaveBeenCalled();
    });

    it("includes duplicates field when queryLore finds above-threshold matches for a proposed entity", async () => {
        queryLoreMock.mockResolvedValue([
            { noteId: "existing-1", noteTitle: "Aldric the Bold", content: "...", score: 0.95 },
        ]);
        parseBrainDumpResponseMock.mockReturnValue({
            entities: [DEFAULT_CREATE_ENTITY as never],
            summary: "Possible duplicate",
        });

        const result = await runBrainDump("lore text", "review") as {
            duplicates?: Array<{ proposedTitle: string; matches: unknown[] }>;
        };

        expect(result.duplicates).toBeDefined();
        expect(result.duplicates!.length).toBeGreaterThan(0);
        expect(result.duplicates![0].proposedTitle).toBe("Aldric the Bold");
    });

    it("omits duplicates field when no high-score matches found", async () => {
        queryLoreMock.mockResolvedValue([
            { noteId: "other-1", noteTitle: "Unrelated Note", content: "...", score: 0.3 },
        ]);
        parseBrainDumpResponseMock.mockReturnValue({
            entities: [DEFAULT_CREATE_ENTITY as never],
            summary: "Clean",
        });

        const result = await runBrainDump("lore text", "review") as {
            duplicates?: unknown[];
        };

        expect(result.duplicates).toBeUndefined();
    });
});

describe("runBrainDump — auto mode (write path)", () => {
    it("creates entity, applies template and tags, persists history", async () => {
        parseBrainDumpResponseMock.mockReturnValue({
            entities: [DEFAULT_CREATE_ENTITY as never],
            summary: "Created Aldric",
        });

        const result = await runBrainDump("lore text", "auto") as {
            created: unknown[];
            updated: unknown[];
            skipped: unknown[];
        };

        expect(result.created).toHaveLength(1);
        expect(result.updated).toHaveLength(0);
        expect(result.skipped).toHaveLength(0);
        expect(createNoteMock).toHaveBeenCalledTimes(1);
        expect(tagNoteMock).toHaveBeenCalled();
        expect(brainDumpCreateMock).toHaveBeenCalledTimes(1);
    });

    it("skips entity and omits history when an exact-title duplicate is found", async () => {
        queryLoreMock.mockResolvedValue([
            { noteId: "existing-1", noteTitle: "Aldric the Bold", content: "...", score: 0.95 },
        ]);
        parseBrainDumpResponseMock.mockReturnValue({
            entities: [DEFAULT_CREATE_ENTITY as never],
            summary: "Duplicate found",
        });

        const result = await runBrainDump("lore text", "auto") as {
            skipped: Array<{ title: string; reason: string }>;
            created: unknown[];
        };

        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0].title).toBe("Aldric the Bold");
        expect(result.created).toHaveLength(0);
        expect(createNoteMock).not.toHaveBeenCalled();
        expect(brainDumpCreateMock).not.toHaveBeenCalled();
    });

    it("routes update action through updateNote instead of createNote", async () => {
        parseBrainDumpResponseMock.mockReturnValue({
            entities: [{
                title: "Aldric the Bold",
                type: "character",
                action: "update" as const,
                existingNoteId: "existing-note-1",
                content: "Updated lore.",
            } as never],
            summary: "Updated Aldric",
        });

        const result = await runBrainDump("lore text", "auto") as {
            updated: unknown[];
            created: unknown[];
        };

        expect(result.updated).toHaveLength(1);
        expect(result.created).toHaveLength(0);
        expect(updateNoteMock).toHaveBeenCalledWith("existing-note-1", expect.any(Object));
        expect(createNoteMock).not.toHaveBeenCalled();
        expect(brainDumpCreateMock).toHaveBeenCalledTimes(1);
    });

    it("does not invoke auto-relate when no notes were created", async () => {
        parseBrainDumpResponseMock.mockReturnValue({
            entities: [{
                ...DEFAULT_CREATE_ENTITY,
                action: "update" as const,
                existingNoteId: "existing-1",
            } as never],
            summary: "Update only",
        });

        await runBrainDump("lore text", "auto");

        expect(suggestRelationsMock).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("commitReviewedEntities", () => {
    it("throws when AllCodex probe fails", async () => {
        probeAllCodexMock.mockResolvedValue({ ok: false, error: "offline" });

        await expect(
            commitReviewedEntities("original lore text", [])
        ).rejects.toThrow("AllCodex is not connected");
    });

    it("writes approved entities directly without calling the LLM or parser", async () => {
        const approved: ProposedEntity[] = [{
            title: "Aldric the Bold",
            type: "character",
            action: "create",
            content: "A brave warrior.",
        }];

        const result = await commitReviewedEntities("original lore text", approved);

        expect(result.created).toHaveLength(1);
        expect(createNoteMock).toHaveBeenCalledTimes(1);
        expect(callLLMMock).not.toHaveBeenCalled();
        expect(parseBrainDumpResponseMock).not.toHaveBeenCalled();
    });
});

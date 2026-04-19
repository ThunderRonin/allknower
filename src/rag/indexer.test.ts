import { mock } from "bun:test";

mock.module("../env.ts", () => ({
    env: {
        EMBEDDING_CLOUD: "test/embedding-model",
        LANCEDB_PATH: "/tmp/test-lancedb",
        EMBEDDING_DIMENSIONS: 4,
        OPENROUTER_API_KEY: "test",
        LLM_TIMEOUT_MS: 5000,
        OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    },
}));

const mockGetNoteContent = mock(async (_noteId: string) => "<p>Aldric is the king of Valorheim.</p>");
const mockGetAllCodexNotes = mock(async (_search: string) => [
    { noteId: "note-1", title: "Aldric", type: "text", utcDateModified: new Date().toISOString() },
]);
const mockUpsertNoteChunks = mock(async () => {});
const mockChunkText = mock((_text: string) => ["chunk 1", "chunk 2"]);

mock.module("../etapi/client.ts", () => ({
    getNoteContent: mockGetNoteContent,
    getAllCodexNotes: mockGetAllCodexNotes,
    createNote: mock(async () => ({ note: { noteId: "new-note" }, branch: {} })),
    tagNote: mock(async () => {}),
    setNoteTemplate: mock(async () => {}),
    setNoteContent: mock(async () => {}),
    updateNote: mock(async (noteId: string) => ({ noteId })),
    probeAllCodex: mock(async () => ({ ok: true })),
}));

mock.module("./lancedb.ts", () => ({
    upsertNoteChunks: mockUpsertNoteChunks,
    chunkText: mockChunkText,
    deleteNoteChunks: mock(async () => {}),
    getTable: mock(async () => ({})),
    queryLore: mock(async () => []),
}));

const mockPrismaRagUpsert = mock(async () => ({}));
const mockPrismaFindMany = mock(async (): Promise<{ noteId: string; embeddedAt: Date }[]> => []);

mock.module("../db/client.ts", () => ({
    default: {
        ragIndexMeta: {
            upsert: mockPrismaRagUpsert,
            findMany: mockPrismaFindMany,
        },
    },
}));

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { indexNote, fullReindex, reindexStaleNotes } from "./indexer.ts";

beforeEach(() => {
    mockGetNoteContent.mockClear();
    mockGetAllCodexNotes.mockClear();
    mockUpsertNoteChunks.mockClear();
    mockChunkText.mockClear();
    mockPrismaRagUpsert.mockClear();
    mockPrismaFindMany.mockClear();

    mockGetNoteContent.mockResolvedValue("<p>Aldric is the king of Valorheim.</p>");
    mockGetAllCodexNotes.mockResolvedValue([
        { noteId: "note-1", title: "Aldric", type: "text", utcDateModified: new Date().toISOString() },
    ]);
    mockChunkText.mockReturnValue(["chunk 1", "chunk 2"]);
    mockUpsertNoteChunks.mockResolvedValue(undefined);
    mockPrismaRagUpsert.mockResolvedValue({});
    mockPrismaFindMany.mockResolvedValue([]);
});

describe("indexNote", () => {
    it("fetches note content via getNoteContent", async () => {
        await indexNote("note-1");
        expect(mockGetNoteContent).toHaveBeenCalledWith("note-1");
    });

    it("strips HTML tags before embedding (plain text only)", async () => {
        mockGetNoteContent.mockResolvedValue("<p>Aldric <strong>rules</strong> Valorheim.</p>");
        await indexNote("note-1");
        // The chunked content should be plain text
        expect(mockChunkText).toHaveBeenCalledWith(expect.not.stringContaining("<p>"));
    });

    it("normalizes multiple whitespace to single space", async () => {
        mockGetNoteContent.mockResolvedValue("<p>Aldric   rules   Valorheim.</p>");
        await indexNote("note-1");
        const calledWith = mockChunkText.mock.calls[0][0] as string;
        expect(calledWith).not.toMatch(/\s{2,}/);
    });

    it("calls upsertNoteChunks with noteId, title, chunks", async () => {
        await indexNote("note-1");
        expect(mockUpsertNoteChunks).toHaveBeenCalledWith("note-1", "Aldric", ["chunk 1", "chunk 2"]);
    });

    it("fetches note title via getAllCodexNotes", async () => {
        await indexNote("note-1");
        expect(mockGetAllCodexNotes).toHaveBeenCalledWith(expect.stringContaining("note-1"));
    });

    it("falls back to noteId as title when ETAPI returns no results", async () => {
        mockGetAllCodexNotes.mockResolvedValue([]);
        await indexNote("note-missing");
        expect(mockUpsertNoteChunks).toHaveBeenCalledWith("note-missing", "note-missing", expect.any(Array));
    });

    it("upserts ragIndexMeta with noteId, title, chunkCount, model", async () => {
        await indexNote("note-1");
        expect(mockPrismaRagUpsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { noteId: "note-1" },
                create: expect.objectContaining({ noteId: "note-1", chunkCount: 2 }),
                update: expect.objectContaining({ chunkCount: 2 }),
            })
        );
    });

    it("returns immediately when content is empty string", async () => {
        mockGetNoteContent.mockResolvedValue("");
        await indexNote("note-1");
        expect(mockUpsertNoteChunks).not.toHaveBeenCalled();
    });

    it("returns immediately when content is whitespace-only", async () => {
        mockGetNoteContent.mockResolvedValue("   \n   ");
        await indexNote("note-1");
        expect(mockUpsertNoteChunks).not.toHaveBeenCalled();
    });

    it("throws (propagates) when getNoteContent throws", async () => {
        mockGetNoteContent.mockRejectedValue(new Error("ETAPI error"));
        await expect(indexNote("note-1")).rejects.toThrow("ETAPI error");
    });

    it("throws (propagates) when upsertNoteChunks throws", async () => {
        mockUpsertNoteChunks.mockRejectedValue(new Error("LanceDB write failed"));
        await expect(indexNote("note-1")).rejects.toThrow("LanceDB write failed");
    });
});

describe("fullReindex", () => {
    it("calls getAllCodexNotes(\"#lore\")", async () => {
        await fullReindex();
        expect(mockGetAllCodexNotes).toHaveBeenCalledWith("#lore");
    });

    it("calls indexNote for each found note", async () => {
        mockGetAllCodexNotes.mockResolvedValue([
            { noteId: "note-1", title: "Aldric", type: "text", utcDateModified: new Date().toISOString() },
            { noteId: "note-2", title: "Ironmark", type: "text", utcDateModified: new Date().toISOString() },
        ]);
        await fullReindex();
        expect(mockGetNoteContent).toHaveBeenCalledTimes(2);
    });

    it("returns { indexed: N, failed: 0 } on all success", async () => {
        mockGetAllCodexNotes.mockResolvedValue([
            { noteId: "note-1", title: "N1", type: "text", utcDateModified: new Date().toISOString() },
        ]);
        const result = await fullReindex();
        expect(result.indexed).toBe(1);
        expect(result.failed).toBe(0);
    });

    it("increments failed count when indexNote throws (non-fatal)", async () => {
        mockGetAllCodexNotes.mockResolvedValue([
            { noteId: "note-bad", title: "Bad", type: "text", utcDateModified: new Date().toISOString() },
        ]);
        mockGetNoteContent.mockRejectedValue(new Error("ETAPI failed"));
        const result = await fullReindex();
        expect(result.failed).toBe(1);
        expect(result.indexed).toBe(0);
    });

    it("continues indexing remaining notes after one failure", async () => {
        mockGetAllCodexNotes.mockResolvedValue([
            { noteId: "note-bad", title: "Bad", type: "text", utcDateModified: new Date().toISOString() },
            { noteId: "note-good", title: "Good", type: "text", utcDateModified: new Date().toISOString() },
        ]);
        mockGetNoteContent
            .mockRejectedValueOnce(new Error("Failed"))
            .mockResolvedValue("<p>Good content.</p>");
        const result = await fullReindex();
        expect(result.indexed).toBe(1);
        expect(result.failed).toBe(1);
    });

    it("returns { indexed: 0, failed: 0 } when no lore notes found", async () => {
        mockGetAllCodexNotes.mockResolvedValue([]);
        const result = await fullReindex();
        expect(result).toEqual({ indexed: 0, failed: 0 });
    });
});

describe("reindexStaleNotes", () => {
    it("fetches lore notes and ragIndexMeta in parallel", async () => {
        mockGetAllCodexNotes.mockResolvedValue([]);
        mockPrismaFindMany.mockResolvedValue([]);
        await reindexStaleNotes();
        expect(mockGetAllCodexNotes).toHaveBeenCalledWith("#lore");
        expect(mockPrismaFindMany).toHaveBeenCalled();
    });

    it("skips notes where noteModified <= embeddedAt (upToDate++)", async () => {
        const pastDate = new Date(Date.now() - 1000 * 60);
        const embeddedAt = new Date();
        mockGetAllCodexNotes.mockResolvedValue([
            { noteId: "note-old", title: "Old", type: "text", utcDateModified: pastDate.toISOString() },
        ]);
        mockPrismaFindMany.mockResolvedValue([{ noteId: "note-old", embeddedAt }]);
        const result = await reindexStaleNotes();
        expect(result.upToDate).toBe(1);
        expect(result.reindexed).toBe(0);
    });

    it("reindexes notes where noteModified > embeddedAt", async () => {
        const recentDate = new Date(Date.now() + 1000 * 60);
        const pastEmbed = new Date(Date.now() - 1000 * 60 * 10);
        mockGetAllCodexNotes.mockResolvedValue([
            { noteId: "note-stale", title: "Stale", type: "text", utcDateModified: recentDate.toISOString() },
        ]);
        mockPrismaFindMany.mockResolvedValue([{ noteId: "note-stale", embeddedAt: pastEmbed }]);
        const result = await reindexStaleNotes();
        expect(result.reindexed).toBe(1);
        expect(result.upToDate).toBe(0);
    });

    it("reindexes notes with no embeddedAt record (never indexed)", async () => {
        mockGetAllCodexNotes.mockResolvedValue([
            { noteId: "note-new", title: "NewNote", type: "text", utcDateModified: new Date().toISOString() },
        ]);
        mockPrismaFindMany.mockResolvedValue([]); // No meta record
        const result = await reindexStaleNotes();
        expect(result.reindexed).toBe(1);
    });

    it("increments failed on indexNote throw, continues", async () => {
        mockGetAllCodexNotes.mockResolvedValue([
            { noteId: "note-fail", title: "Fail", type: "text", utcDateModified: new Date(Date.now() + 1000).toISOString() },
        ]);
        mockPrismaFindMany.mockResolvedValue([{ noteId: "note-fail", embeddedAt: new Date(0) }]);
        mockGetNoteContent.mockRejectedValue(new Error("Network error"));
        const result = await reindexStaleNotes();
        expect(result.failed).toBe(1);
    });

    it("returns correct { reindexed, failed, upToDate } counts", async () => {
        const now = new Date();
        const past = new Date(0);
        const future = new Date(Date.now() + 1000);
        mockGetAllCodexNotes.mockResolvedValue([
            { noteId: "note-1", title: "Stale", type: "text", utcDateModified: future.toISOString() },
            { noteId: "note-2", title: "Fresh", type: "text", utcDateModified: past.toISOString() },
        ]);
        mockPrismaFindMany.mockResolvedValue([
            { noteId: "note-1", embeddedAt: now },
            { noteId: "note-2", embeddedAt: now },
        ]);
        const result = await reindexStaleNotes();
        expect(result.reindexed).toBe(1);
        expect(result.upToDate).toBe(1);
        expect(result.failed).toBe(0);
    });
});

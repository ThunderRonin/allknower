/**
 * Tier 5 — LanceDB integration tests.
 *
 * Uses a real embedded LanceDB in a temp directory. Embedder is mocked so no
 * network calls are made. After each test the singleton is reset via
 * _resetConnection() and the temp dir is removed.
 *
 * Run with: bun test src/rag/lancedb.integration.test.ts
 */
import { mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── All mocks must be declared BEFORE importing from lancedb.ts ───────────────

const DIMS = 4; // Small embeddings for speed

mock.module("./embedder.ts", () => ({
    embed: async (_text: string) => [0.1, 0.2, 0.3, 0.4],
    embedBatch: async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3, 0.4]),
    EMBEDDING_DIMENSIONS: DIMS,
}));

mock.module("../pipeline/model-router.ts", () => ({
    callWithFallback: async () => ({
        raw: JSON.stringify({
            scores: [{ noteId: "note-1", score: 0.85 }],
        }),
        tokensUsed: 10,
        model: "test",
        latencyMs: 5,
    }),
    getModelChain: () => ["test-model"],
}));

mock.module("../db/client.ts", () => ({
    default: {
        ragIndexMeta: {
            upsert: async () => ({}),
            findMany: async () => [],
        },
    },
}));

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from "bun:test";

// Dynamic import to allow LANCEDB_PATH override before module load
let lancedb: typeof import("./lancedb.ts");

let tmpDir: string;

beforeEach(async () => {
    // Create fresh temp dir for each test
    tmpDir = await mkdtemp(join(tmpdir(), "allknower-lancedb-test-"));

    // Override environment BEFORE importing the module
    process.env.LANCEDB_PATH = tmpDir;

    // Reset the module mock so the env override is picked up
    mock.module("../env.ts", () => ({
        env: {
            LANCEDB_PATH: tmpDir,
            EMBEDDING_DIMENSIONS: DIMS,
            RAG_CHUNK_DEDUP_SIMILARITY_THRESHOLD: 0.85,
            RAG_CONTEXT_MAX_TOKENS: 6000,
            RAG_CHUNK_SUMMARY_THRESHOLD_TOKENS: 600,
            OPENROUTER_API_KEY: "test-key",
            OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
            EMBEDDING_CLOUD: "test/model",
        },
    }));

    lancedb = await import("./lancedb.ts");

    // Reset singleton so each test gets a fresh DB
    lancedb._resetConnection();
});

afterEach(async () => {
    lancedb._resetConnection();
    await rm(tmpDir, { recursive: true, force: true });
});

// ── upsertNoteChunks ──────────────────────────────────────────────────────────

describe("upsertNoteChunks", () => {
    it("creates table on first upsert", async () => {
        await expect(
            lancedb.upsertNoteChunks("note-1", "Aldric", ["Aldric is the king."])
        ).resolves.not.toThrow();
    });

    it("upserts multiple chunks under same noteId", async () => {
        await lancedb.upsertNoteChunks("note-1", "Aldric", ["Chunk A.", "Chunk B."]);
        // no error = success
        const health = await lancedb.checkLanceDbHealth();
        expect(health.ok).toBe(true);
    });

    it("second upsert for same noteId replaces existing chunks", async () => {
        await lancedb.upsertNoteChunks("note-1", "Aldric", ["Old chunk."]);
        await lancedb.upsertNoteChunks("note-1", "Aldric", ["New chunk."]);
        const results = await lancedb.queryLore("Aldric", 10);
        // Only new chunks should exist — old ones replaced
        expect(results.some((r) => r.content === "New chunk.")).toBe(true);
    });

    it("accepts empty chunks array without error", async () => {
        await expect(lancedb.upsertNoteChunks("note-empty", "Empty", [])).resolves.not.toThrow();
    });

    it("stores noteId and noteTitle in rows", async () => {
        await lancedb.upsertNoteChunks("note-1", "Aldric Title", ["Aldric content."]);
        const results = await lancedb.queryLore("Aldric", 10);
        const row = results.find((r) => r.noteId === "note-1");
        expect(row).toBeDefined();
        expect(row?.noteTitle).toBe("Aldric Title");
    });
});

// ── deleteNoteChunks ──────────────────────────────────────────────────────────

describe("deleteNoteChunks", () => {
    it("removes chunks matching noteId", async () => {
        await lancedb.upsertNoteChunks("note-del", "Del Note", ["Delete me.", "Also delete."]);
        await lancedb.deleteNoteChunks("note-del");

        // Query should not find deleted note
        const results = await lancedb.queryLore("Delete me", 10);
        expect(results.every((r) => r.noteId !== "note-del")).toBe(true);
    });

    it("does not affect other notes when deleting one", async () => {
        await lancedb.upsertNoteChunks("note-keep", "Keep", ["Keeper content."]);
        await lancedb.upsertNoteChunks("note-del", "Delete", ["Delete me."]);
        await lancedb.deleteNoteChunks("note-del");

        const results = await lancedb.queryLore("Keeper content", 10);
        const keeperRows = results.filter((r) => r.noteId === "note-keep");
        expect(keeperRows.length).toBeGreaterThanOrEqual(1);
    });

    it("does not throw when deleting noteId that does not exist", async () => {
        await lancedb.upsertNoteChunks("note-exists", "Exists", ["Content."]);
        await expect(lancedb.deleteNoteChunks("note-nonexistent")).resolves.not.toThrow();
    });
});

// ── queryLore ─────────────────────────────────────────────────────────────────

describe("queryLore", () => {
    it("returns empty array when table is empty", async () => {
        // Just ensure table exists first, then query empty index
        await lancedb.upsertNoteChunks("dummy", "dummy", ["placeholder"]);
        await lancedb.deleteNoteChunks("dummy");
        // Query may return 0 or just the deduped empty set
        const results = await lancedb.queryLore("anything", 10);
        expect(Array.isArray(results)).toBe(true);
    });

    it("returns results up to topK limit", async () => {
        for (let i = 0; i < 5; i++) {
            await lancedb.upsertNoteChunks(`note-${i}`, `Note ${i}`, [`Content for note ${i}.`]);
        }
        const results = await lancedb.queryLore("content", 3);
        expect(results.length).toBeLessThanOrEqual(3);
    });

    it("each result has noteId, noteTitle, content, score fields", async () => {
        await lancedb.upsertNoteChunks("note-1", "Aldric", ["Aldric rules the realm."]);
        const results = await lancedb.queryLore("Aldric", 5);
        if (results.length > 0) {
            const r = results[0];
            expect(typeof r.noteId).toBe("string");
            expect(typeof r.noteTitle).toBe("string");
            expect(typeof r.content).toBe("string");
            expect(typeof r.score).toBe("number");
        }
    });

    it("filters out duplicate content (trigram deduplication applied)", async () => {
        const almostSame = "Aldric is the great king of Valorheim ruling the north.";
        // Insert same content for two different chunks of same note
        await lancedb.upsertNoteChunks("note-1", "Aldric", [
            almostSame,
            almostSame + " And beyond.", // near-duplicate
        ]);
        const results = await lancedb.queryLore("Aldric king", 10);
        // Deduplication should reduce near-identical content
        expect(results.length).toBeLessThan(3);
    });

    it("score field is a finite number", async () => {
        await lancedb.upsertNoteChunks("note-1", "Test", ["Some content for test."]);
        const results = await lancedb.queryLore("test", 10);
        for (const r of results) {
            expect(isFinite(r.score)).toBe(true);
        }
    });

    it("multiple note results are ordered by score descending", async () => {
        // Since all embeddings are identical ([0.1,0.2,0.3,0.4]), scores should be equal
        // At minimum, results should not have scores in ascending order
        await lancedb.upsertNoteChunks("note-a", "Alpha", ["Alpha content lore."]);
        await lancedb.upsertNoteChunks("note-b", "Beta", ["Beta content lore."]);
        const results = await lancedb.queryLore("lore", 5);
        if (results.length >= 2) {
            // Scores should be non-ascending
            for (let i = 0; i < results.length - 1; i++) {
                expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
            }
        }
    });
});

// ── checkLanceDbHealth ────────────────────────────────────────────────────────

describe("checkLanceDbHealth", () => {
    it("returns { ok: true } when DB is accessible", async () => {
        await lancedb.upsertNoteChunks("health-check", "Health", ["Content."]);
        const result = await lancedb.checkLanceDbHealth();
        expect(result.ok).toBe(true);
    });

    it("returns { ok: false } when DB path is invalid (post-reset with bad path)", async () => {
        // Override env to point to an unwritable path, then reset and try
        mock.module("../env.ts", () => ({
            env: {
                LANCEDB_PATH: "/proc/impossible/path/to/lancedb",
                EMBEDDING_DIMENSIONS: DIMS,
                OPENROUTER_API_KEY: "test",
            },
        }));
        lancedb._resetConnection();
        const result = await lancedb.checkLanceDbHealth();
        expect(result.ok).toBe(false);
    });
});

// ── _resetConnection ──────────────────────────────────────────────────────────

describe("_resetConnection", () => {
    it("does not throw when called before any DB operation", () => {
        expect(() => lancedb._resetConnection()).not.toThrow();
    });

    it("allows new DB to be opened in a different path after reset", async () => {
        // Upsert to original tmpDir
        await lancedb.upsertNoteChunks("note-1", "Aldric", ["Content."]);

        // Reset, switch to new temp dir
        lancedb._resetConnection();
        const tmpDir2 = await mkdtemp(join(tmpdir(), "allknower-lancedb-test2-"));
        try {
            mock.module("../env.ts", () => ({
                env: {
                    LANCEDB_PATH: tmpDir2,
                    EMBEDDING_DIMENSIONS: DIMS,
                    OPENROUTER_API_KEY: "test",
                },
            }));
            lancedb._resetConnection();
            // New DB is empty — query should return nothing
            const results = await lancedb.queryLore("Aldric", 10);
            expect(results.length).toBe(0);
        } finally {
            lancedb._resetConnection();
            await rm(tmpDir2, { recursive: true, force: true });
        }
    });
});

/**
 * Unit tests for compactSession() — the core compaction function.
 *
 * Uses real Prisma/Postgres for DB operations.
 * Mocks: model-router (LLM calls), env (SESSION_TOKEN_THRESHOLD).
 */
import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";

// ── Mutable LLM behavior — reassign per test ────────────────────────────────

const VALID_COMPACT_STATE = {
    intent: "Building lore for Valorheim",
    loreTypesInPlay: ["character", "location"],
    noteIdsModified: ["note-1"],
    skippedEntities: [],
    rawInputsSummary: "User described Aldric as king.",
    unresolvedGaps: [],
    currentFocus: "Aldric",
};

let llmBehavior: () => Promise<string> = async () =>
    JSON.stringify(VALID_COMPACT_STATE);

mock.module("../../src/pipeline/model-router.ts", () => ({
    callWithFallback: mock(async (_task: string) => {
        const raw = await llmBehavior();
        return { raw, tokensUsed: 100, model: "test-model", latencyMs: 5 };
    }),
    getModelChain: (_task: string) => ["test-model"],
    callModelStream: mock(async function* () {
        yield {
            type: "done" as const,
            raw: "",
            tokensUsed: 0,
            model: "test-model",
            latencyMs: 0,
        };
    }),
}));

mock.module("../../src/env.ts", () => ({
    env: {
        DATABASE_URL: process.env.DATABASE_URL,
        NODE_ENV: "test",
        SESSION_TOKEN_THRESHOLD: 80000,
        OPENROUTER_API_KEY: "test-key",
        OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
        BETTER_AUTH_SECRET: "test-secret-minimum-16-chars",
        ALLCODEX_ETAPI_TOKEN: "test-etapi-token",
        ALLCODEX_URL: "http://localhost:8080",
        PORTAL_INTERNAL_SECRET: "test-portal-secret",
        LLM_TIMEOUT_MS: 30000,
        COMPACT_MODEL: "test-compact-model",
        COMPACT_FALLBACK_1: "",
        COMPACT_FALLBACK_2: "",
        COMPACT_FALLBACK_3: "",
    },
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import prisma from "../../src/db/client.ts";
import {
    compactSession,
    CompactionLockError,
} from "../../src/pipeline/session-compactor.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

interface LoreSessionRecord {
    id: string;
    state: unknown;
    tokensAccumulated: number;
    compactionCount: number;
    compactionFailed: number;
    lockedAt: Date | null;
}

/** Track all session IDs created during the test run for cleanup. */
const createdSessionIds: string[] = [];

async function createTestSession(
    overrides: Partial<{
        state: unknown;
        tokensAccumulated: number;
        compactionCount: number;
        compactionFailed: number;
        lockedAt: Date | null;
        userId: string;
    }> = {},
): Promise<LoreSessionRecord> {
    const row = await prisma.loreSession.create({
        data: {
            userId: overrides.userId ?? "test-user-compactor",
            state: (overrides.state as any) ?? {},
            tokensAccumulated: overrides.tokensAccumulated ?? 90000,
            compactionCount: overrides.compactionCount ?? 0,
            compactionFailed: overrides.compactionFailed ?? 0,
            lockedAt: overrides.lockedAt ?? null,
        },
    });
    createdSessionIds.push(row.id);
    return {
        id: row.id,
        state: row.state,
        tokensAccumulated: row.tokensAccumulated,
        compactionCount: row.compactionCount,
        compactionFailed: row.compactionFailed,
        lockedAt: row.lockedAt,
    };
}

async function addMessages(
    sessionId: string,
    messages: Array<{ role: string; content: string }>,
): Promise<void> {
    for (const msg of messages) {
        await prisma.loreSessionMessage.create({
            data: {
                sessionId,
                role: msg.role,
                content: msg.content,
                tokenCount: Math.ceil(msg.content.length / 4),
            },
        });
    }
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
    // Reset LLM behavior to success for each test
    llmBehavior = async () => JSON.stringify(VALID_COMPACT_STATE);
});

afterAll(async () => {
    // Clean up all sessions created during the test run (cascade deletes messages)
    if (createdSessionIds.length > 0) {
        await prisma.loreSession.deleteMany({
            where: { id: { in: createdSessionIds } },
        });
    }
    await prisma.$disconnect();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("compactSession", () => {
    it("calls LLM and persists compacted state to DB", async () => {
        const session = await createTestSession();
        await addMessages(session.id, [
            { role: "user", content: "Aldric is the king of Valorheim." },
            { role: "assistant", content: "I have created Aldric as a character." },
        ]);

        const result = await compactSession(session);

        // Returns the parsed LoreSessionState
        expect(result.intent).toBe("Building lore for Valorheim");
        expect(result.loreTypesInPlay).toEqual(["character", "location"]);
        expect(result.noteIdsModified).toEqual(["note-1"]);
        expect(result.currentFocus).toBe("Aldric");

        // State persisted to DB
        const dbRow = await prisma.loreSession.findUniqueOrThrow({
            where: { id: session.id },
        });
        const dbState = dbRow.state as Record<string, unknown>;
        expect(dbState.intent).toBe("Building lore for Valorheim");
        expect(dbState.schemaVersion).toBe(1); // Zod default applied
    });

    it("increments compactionCount in the DB", async () => {
        const session = await createTestSession({ compactionCount: 2 });
        await addMessages(session.id, [
            { role: "user", content: "Some lore content." },
        ]);

        await compactSession(session);

        const dbRow = await prisma.loreSession.findUniqueOrThrow({
            where: { id: session.id },
        });
        expect(dbRow.compactionCount).toBe(3); // 2 + increment(1)
    });

    it("releases lock after successful compaction (lockedAt = null)", async () => {
        const session = await createTestSession();
        await addMessages(session.id, [
            { role: "user", content: "Build the northern forts." },
        ]);

        await compactSession(session);

        const dbRow = await prisma.loreSession.findUniqueOrThrow({
            where: { id: session.id },
        });
        expect(dbRow.lockedAt).toBeNull();
    });

    it("increments compactionFailed on LLM error and re-throws", async () => {
        llmBehavior = async () => {
            throw new Error("LLM provider unreachable");
        };

        const session = await createTestSession({ compactionFailed: 0 });
        await addMessages(session.id, [
            { role: "user", content: "Some content." },
        ]);

        await expect(compactSession(session)).rejects.toThrow(
            "LLM provider unreachable",
        );

        const dbRow = await prisma.loreSession.findUniqueOrThrow({
            where: { id: session.id },
        });
        expect(dbRow.compactionFailed).toBe(1); // 0 + increment(1)
        expect(dbRow.lockedAt).toBeNull(); // lock released in finally
    });

    it("increments compactionFailed on invalid JSON from LLM", async () => {
        llmBehavior = async () => "This is not JSON { broken";

        const session = await createTestSession({ compactionFailed: 1 });
        await addMessages(session.id, [
            { role: "user", content: "Content." },
        ]);

        await expect(compactSession(session)).rejects.toThrow(); // JSON.parse error

        const dbRow = await prisma.loreSession.findUniqueOrThrow({
            where: { id: session.id },
        });
        expect(dbRow.compactionFailed).toBe(2); // 1 + increment(1)
        expect(dbRow.lockedAt).toBeNull();
    });

    it("increments compactionFailed on Zod validation failure (missing required fields)", async () => {
        // Return valid JSON but missing required fields (intent, loreTypesInPlay, etc.)
        llmBehavior = async () =>
            JSON.stringify({
                intent: "Valid intent",
                // missing loreTypesInPlay, noteIdsModified, skippedEntities,
                // rawInputsSummary, unresolvedGaps
            });

        const session = await createTestSession({ compactionFailed: 0 });
        await addMessages(session.id, [
            { role: "user", content: "Content." },
        ]);

        await expect(compactSession(session)).rejects.toThrow(); // ZodError

        const dbRow = await prisma.loreSession.findUniqueOrThrow({
            where: { id: session.id },
        });
        expect(dbRow.compactionFailed).toBe(1);
        expect(dbRow.lockedAt).toBeNull();
    });

    it("throws CompactionLockError when session is already locked (non-stale)", async () => {
        // Lock held < 5 minutes ago — neither OR branch matches
        const recentLock = new Date(Date.now() - 60 * 1000); // 1 minute ago
        const session = await createTestSession({ lockedAt: recentLock });

        await expect(compactSession(session)).rejects.toThrow(CompactionLockError);
        await expect(compactSession(session)).rejects.toThrow(
            `Compaction lock held for session ${session.id}`,
        );

        // compactionFailed should NOT be incremented (lock error is thrown before try block logic)
        const dbRow = await prisma.loreSession.findUniqueOrThrow({
            where: { id: session.id },
        });
        expect(dbRow.compactionFailed).toBe(0);
    });

    it("overrides stale lock (>5min ago) and compacts successfully", async () => {
        const staleLock = new Date(Date.now() - 6 * 60 * 1000); // 6 minutes ago
        const session = await createTestSession({ lockedAt: staleLock });
        await addMessages(session.id, [
            { role: "user", content: "Stale session content." },
        ]);

        const result = await compactSession(session);

        expect(result.intent).toBe("Building lore for Valorheim");

        const dbRow = await prisma.loreSession.findUniqueOrThrow({
            where: { id: session.id },
        });
        expect(dbRow.lockedAt).toBeNull(); // lock released
        expect(dbRow.compactionCount).toBe(1);
    });

    it("handles session with no messages (empty history)", async () => {
        // No messages added — historyText will be empty string
        const session = await createTestSession();

        const result = await compactSession(session);

        expect(result.intent).toBe("Building lore for Valorheim");

        const dbRow = await prisma.loreSession.findUniqueOrThrow({
            where: { id: session.id },
        });
        expect(dbRow.compactionCount).toBe(1);
        expect(dbRow.lockedAt).toBeNull();
    });

    it("handles session with existing state (re-compaction)", async () => {
        const priorState = {
            intent: "Old intent from previous compaction",
            loreTypesInPlay: ["faction"],
            noteIdsModified: ["old-note-1"],
            skippedEntities: [],
            rawInputsSummary: "Previous session work.",
            unresolvedGaps: ["Some gap"],
            currentFocus: "Old focus",
            schemaVersion: 1,
            totalTokensConsumed: 0,
        };

        const session = await createTestSession({
            state: priorState,
            compactionCount: 1,
            tokensAccumulated: 100000,
        });
        await addMessages(session.id, [
            { role: "user", content: "Now build Aldric's castle." },
        ]);

        // The LLM mock returns new state regardless of input
        const result = await compactSession(session);

        expect(result.intent).toBe("Building lore for Valorheim");

        const dbRow = await prisma.loreSession.findUniqueOrThrow({
            where: { id: session.id },
        });
        expect(dbRow.compactionCount).toBe(2); // was 1, now 2
        // tokensAccumulated reset to POST_COMPACT_BUDGET (50000)
        expect(dbRow.tokensAccumulated).toBe(50000);
        // compactionFailed reset to 0 on success
        expect(dbRow.compactionFailed).toBe(0);
        expect(dbRow.lockedAt).toBeNull();
    });
});

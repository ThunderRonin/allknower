import { describe, expect, it } from "bun:test";
import { shouldCompact, rebuildContext } from "./session-compactor.ts";
import type { LoreSessionState } from "../types/lore.ts";

// ── shouldCompact ─────────────────────────────────────────────────────────────
// SESSION_TOKEN_THRESHOLD defaults to 80000 from env
// MAX_COMPACT_RETRIES = 3 (internal constant)

function makeSession(overrides: {
    tokensAccumulated?: number;
    compactionFailed?: number;
    lockedAt?: Date | null;
}) {
    return {
        id: "session-1",
        state: null,
        tokensAccumulated: overrides.tokensAccumulated ?? 0,
        compactionCount: 0,
        compactionFailed: overrides.compactionFailed ?? 0,
        lockedAt: overrides.lockedAt ?? null,
    };
}

describe("shouldCompact", () => {
    it("returns true when tokensAccumulated >= SESSION_TOKEN_THRESHOLD", () => {
        const session = makeSession({ tokensAccumulated: 80001 });
        expect(shouldCompact(session)).toBe(true);
    });

    it("returns false when tokensAccumulated < SESSION_TOKEN_THRESHOLD", () => {
        const session = makeSession({ tokensAccumulated: 79999 });
        expect(shouldCompact(session)).toBe(false);
    });

    it("returns false when compactionFailed >= MAX_COMPACT_RETRIES (3)", () => {
        const session = makeSession({ tokensAccumulated: 80001, compactionFailed: 3 });
        expect(shouldCompact(session)).toBe(false);
    });

    it("returns false when lockedAt is not null", () => {
        const session = makeSession({ tokensAccumulated: 80001, lockedAt: new Date() });
        expect(shouldCompact(session)).toBe(false);
    });

    it("returns true when all conditions met: tokens>=threshold, failed<3, lockedAt=null", () => {
        const session = makeSession({ tokensAccumulated: 80000, compactionFailed: 0, lockedAt: null });
        expect(shouldCompact(session)).toBe(true);
    });

    it("boundary: tokensAccumulated === SESSION_TOKEN_THRESHOLD → true", () => {
        const session = makeSession({ tokensAccumulated: 80000 });
        expect(shouldCompact(session)).toBe(true);
    });

    it("boundary: compactionFailed === 2 (< 3) → true", () => {
        const session = makeSession({ tokensAccumulated: 80001, compactionFailed: 2 });
        expect(shouldCompact(session)).toBe(true);
    });

    it("boundary: compactionFailed === 3 → false", () => {
        const session = makeSession({ tokensAccumulated: 80001, compactionFailed: 3 });
        expect(shouldCompact(session)).toBe(false);
    });
});

// ── rebuildContext ────────────────────────────────────────────────────────────

const validState: LoreSessionState = {
    intent: "Build worldbuilding lore for Valorheim",
    loreTypesInPlay: ["character", "location"],
    noteIdsModified: ["note-1", "note-2"],
    skippedEntities: [],
    rawInputsSummary: "Session covered Aldric and the northern forts.",
    unresolvedGaps: ["No backstory for Aria Vale"],
    currentFocus: "Ironmark fortress",
    schemaVersion: 1,
    totalTokensConsumed: 0,
};

describe("rebuildContext", () => {
    it("includes [SESSION COMPACTED] header", () => {
        const result = rebuildContext(validState, [], 1);
        expect(result).toContain("[SESSION COMPACTED");
    });

    it("includes compaction count in header", () => {
        const result = rebuildContext(validState, [], 3);
        expect(result).toContain("Compaction #3");
    });

    it("includes POST_COMPACT_BUDGET value", () => {
        const result = rebuildContext(validState, [], 1);
        expect(result).toContain("50000");
    });

    it("includes JSON-serialized state", () => {
        const result = rebuildContext(validState, [], 1);
        expect(result).toContain("Valorheim");
    });

    it('includes "Do not acknowledge this summary" instruction', () => {
        const result = rebuildContext(validState, [], 1);
        expect(result).toContain("Do not acknowledge this summary");
    });

    it("with 0 recentNotes → still produces valid context string", () => {
        const result = rebuildContext(validState, [], 1);
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
    });

    it("with recentNotes → includes noteTitle and truncated content", () => {
        const notes = [
            { noteId: "note-1", noteTitle: "Aldric", content: "Aldric is the king.", score: 1.0 },
        ];
        const result = rebuildContext(validState, notes, 1);
        expect(result).toContain("Aldric");
    });

    it("truncates note content to MAX_TOKENS_PER_REINJECTED_NOTE chars", () => {
        // MAX_TOKENS_PER_REINJECTED_NOTE = 5000 tokens → tokensToChars(5000) = 17500 chars
        const longContent = "x".repeat(100_000);
        const notes = [{ noteId: "n", noteTitle: "Big Note", content: longContent, score: 1.0 }];
        const result = rebuildContext(validState, notes, 1);
        // The injected content should be truncated — result shouldn't be 100k+ chars
        expect(result.length).toBeLessThan(longContent.length);
    });

    it("takes max MAX_RECENT_NOTES_REINJECT (5) notes even if more provided", () => {
        const notes = Array.from({ length: 10 }, (_, i) => ({
            noteId: `note-${i}`,
            noteTitle: `Note ${i}`,
            content: "Some content.",
            score: 1.0,
        }));
        const result = rebuildContext(validState, notes, 1);
        // Only first 5 notes should appear
        expect(result).toContain("Note 0");
        expect(result).toContain("Note 4");
        // Note 5-9 should not appear (beyond limit)
        expect(result).not.toContain("Note 9");
    });

    it("notes beyond MAX_RECENT_NOTES_REINJECT are silently dropped", () => {
        const notes = Array.from({ length: 10 }, (_, i) => ({
            noteId: `note-${i}`,
            noteTitle: `Title${i}`,
            content: "content",
            score: 1.0,
        }));
        const result = rebuildContext(validState, notes, 1);
        expect(result).not.toContain("Title8");
        expect(result).not.toContain("Title9");
    });
});

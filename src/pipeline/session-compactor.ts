import prisma from "../db/client.ts";
import { rootLogger } from "../logger.ts";
import { env } from "../env.ts";
import { countTokens, tokensToChars } from "../utils/tokens.ts";
import { callWithFallback } from "./model-router.ts";
import { LoreSessionStateSchema, type LoreSessionState, type RagChunk } from "../types/lore.ts";

/**
 * Tier 3 — Session State + AutoCompact.
 *
 * Manages multi-turn session context pressure through structured compaction.
 * When session history exceeds the token threshold, the compactor produces
 * a structured 7-section summary, then rebuilds context methodically.
 *
 * This is a pure service module — not wired into routes until multi-turn lands.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const COMPACT_RESERVE_TOKENS = 13_000;
const POST_COMPACT_BUDGET = 50_000;
const MAX_COMPACT_RETRIES = 3;
const MAX_RECENT_NOTES_REINJECT = 5;
const MAX_TOKENS_PER_REINJECTED_NOTE = 5_000;

// ── Error types ───────────────────────────────────────────────────────────────

export class CompactionLockError extends Error {
    constructor(sessionId: string) {
        super(`Compaction lock held for session ${sessionId}`);
        this.name = "CompactionLockError";
    }
}

// ── Locking ───────────────────────────────────────────────────────────────────

async function acquireCompactionLock(sessionId: string): Promise<boolean> {
    const staleThreshold = new Date(Date.now() - 5 * 60 * 1000); // 5min stale lock
    const result = await prisma.loreSession.updateMany({
        where: {
            id: sessionId,
            OR: [
                { lockedAt: null },
                { lockedAt: { lt: staleThreshold } },
            ],
        },
        data: { lockedAt: new Date() },
    });
    return result.count > 0;
}

async function releaseCompactionLock(sessionId: string): Promise<void> {
    await prisma.loreSession.update({
        where: { id: sessionId },
        data: { lockedAt: null },
    });
}

// ── Static compaction prompt ──────────────────────────────────────────────────

const SESSION_COMPACT_SYSTEM = `You are a lore session archivist for the fantasy world All Reach.
A worldbuilding session has accumulated too much context and must be compressed.
Produce a structured state object preserving ALL decisions made, ALL entities
touched, and ALL unresolved gaps. This summary REPLACES the session history —
anything omitted here cannot be recovered.

CRITICAL: Preserve relationship edges between entities. If entity A was connected
to entity B during this session, that connection MUST appear in the summary.

Return JSON matching this exact schema:
{ "intent": "string", "loreTypesInPlay": ["string"], "noteIdsModified": ["string"], "skippedEntities": [{"title": "string", "reason": "string"}], "rawInputsSummary": "string", "unresolvedGaps": ["string"], "currentFocus": "string or null" }`;

// ── Public API ────────────────────────────────────────────────────────────────

interface LoreSessionRecord {
    id: string;
    state: unknown;
    tokensAccumulated: number;
    compactionCount: number;
    compactionFailed: number;
    lockedAt: Date | null;
}

/**
 * Check whether a session has exceeded the token threshold and should compact.
 */
export function shouldCompact(session: LoreSessionRecord): boolean {
    return session.tokensAccumulated >= env.SESSION_TOKEN_THRESHOLD
        && session.compactionFailed < MAX_COMPACT_RETRIES
        && session.lockedAt === null;
}

/**
 * Compact a session's history into a structured 7-section state summary.
 *
 * Acquires an optimistic lock, calls the session-compact LLM task,
 * validates output via Zod, and persists the new state.
 *
 * Throws CompactionLockError if the lock is already held.
 * On LLM/parse failure, increments compactionFailed (circuit breaker).
 */
export async function compactSession(session: LoreSessionRecord): Promise<LoreSessionState> {
    const locked = await acquireCompactionLock(session.id);
    if (!locked) {
        rootLogger.info("Compaction skipped — lock held by another request", {
            sessionId: session.id,
        });
        throw new CompactionLockError(session.id);
    }

    try {
        // Fetch full message history for this session
        const messages = await prisma.loreSessionMessage.findMany({
            where: { sessionId: session.id },
            orderBy: { createdAt: "asc" },
        });

        const historyText = messages
            .map((m) => `[${m.role}]: ${m.content}`)
            .join("\n\n");

        const currentState = session.state
            ? JSON.stringify(session.state, null, 2)
            : "No prior state";

        const userMessage = `## Current Session State\n${currentState}\n\n## Full Message History\n${historyText}`;

        const llmMessages: Array<{ role: "system" | "user"; content: string }> = [
            { role: "system", content: SESSION_COMPACT_SYSTEM },
            { role: "user", content: userMessage },
        ];

        const { raw } = await callWithFallback("session-compact", llmMessages, {
            maxTokens: 4096,
            temperature: 0.1,
        });

        // Validate output
        const parsed = LoreSessionStateSchema.parse(JSON.parse(raw));

        // Persist compacted state
        await prisma.loreSession.update({
            where: { id: session.id },
            data: {
                state: parsed as any,
                tokensAccumulated: POST_COMPACT_BUDGET,
                compactionCount: { increment: 1 },
                compactionFailed: 0,
            },
        });

        rootLogger.info("Session compacted successfully", {
            sessionId: session.id,
            compactionNumber: session.compactionCount + 1,
            preCompactTokens: session.tokensAccumulated,
            postCompactTokens: POST_COMPACT_BUDGET,
        });

        return parsed;
    } catch (error) {
        // Increment circuit breaker on failure
        await prisma.loreSession.update({
            where: { id: session.id },
            data: { compactionFailed: { increment: 1 } },
        }).catch(() => {}); // Don't let the increment fail mask the original error

        rootLogger.error("Session compaction failed", {
            sessionId: session.id,
            error: error instanceof Error ? error.message : String(error),
            failCount: session.compactionFailed + 1,
        });

        throw error;
    } finally {
        await releaseCompactionLock(session.id);
    }
}

/**
 * Build the continuation message after compaction.
 *
 * This is the "continuation message" pattern — the most critical detail
 * from the Claude Code architecture. Without it, the LLM opens the next
 * response with a recap the user doesn't want.
 */
export function rebuildContext(
    state: LoreSessionState,
    recentNotes: RagChunk[],
    compactionCount: number,
): string {
    const noteSection = recentNotes
        .slice(0, MAX_RECENT_NOTES_REINJECT)
        .map((n) => {
            const maxChars = tokensToChars(MAX_TOKENS_PER_REINJECTED_NOTE);
            return `### ${n.noteTitle}\n${n.content.slice(0, maxChars)}`;
        })
        .join("\n\n");

    return `[SESSION COMPACTED — ${new Date().toISOString()}]
Compaction #${compactionCount} | Tokens reset to ${POST_COMPACT_BUDGET}

## Session State
${JSON.stringify(state, null, 2)}

## Recently Modified Lore (re-injected for continuity)
${noteSection}

---
You are actively building lore for the fantasy world All Reach.
Do not acknowledge this summary. Do not recap what has been done.
Continue the session exactly where it left off.`;
}

/**
 * Prune sessions older than 30 days with no activity.
 */
export async function pruneStaleSession(): Promise<number> {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const { count } = await prisma.loreSession.deleteMany({
        where: { updatedAt: { lt: cutoff } },
    });
    rootLogger.info("Pruned stale sessions", { count });
    return count;
}

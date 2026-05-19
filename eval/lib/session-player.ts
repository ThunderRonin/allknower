import prisma from "../../src/db/client.ts";
import { compactSession, rebuildContext } from "../../src/pipeline/session-compactor.ts";
import type { LoreSessionState, RagChunk } from "../../src/types/lore.ts";
import { countTokens } from "../../src/utils/tokens.ts";

const COMPACTION_TOKEN_THRESHOLD = 80_000;
const COMPACTION_TOKEN_FORCE = 85_000;

interface Turn {
    role: string;
    content: string;
}

interface GoldenSession {
    id: string;
    turns: Turn[];
}

export interface PlayedSession {
    sessionId: string;
    dbSessionId: string;
    preCompactionTokens: number;
    postCompactionState: Record<string, unknown> | null;
    rebuiltContext: string;
    compactionCount: number;
}

/**
 * Create a new lore session from a golden session and persist each turn with token counts.
 *
 * Persists a new `loreSession`, inserts every turn from `golden.turns` as `loreSessionMessage` rows while summing token counts, updates the session's `tokensAccumulated`, and returns a `PlayedSession` summary with pre-compaction metrics and empty post-compaction fields.
 *
 * @param golden - The golden session to play back; must include `id` and an ordered `turns` array of role/content pairs
 * @param userId - The user ID to attribute the created session to (defaults to `"eval-user"`)
 * @returns A `PlayedSession` containing the original `sessionId`, the created `dbSessionId`, the total tokens counted before compaction, and placeholders for post-compaction state, rebuilt context, and compaction count
 */
export async function playSession(golden: GoldenSession, userId = "eval-user"): Promise<PlayedSession> {
    const dbSession = await prisma.loreSession.create({
        data: {
            userId,
            title: `Eval: ${golden.id}`,
            state: {},
            tokensAccumulated: 0,
        },
    });

    let totalTokens = 0;

    for (const turn of golden.turns) {
        const tokens = countTokens(turn.content);
        totalTokens += tokens;

        await prisma.loreSessionMessage.create({
            data: {
                sessionId: dbSession.id,
                role: turn.role,
                content: turn.content,
                tokenCount: tokens,
            },
        });
    }

    await prisma.loreSession.update({
        where: { id: dbSession.id },
        data: { tokensAccumulated: totalTokens },
    });

    return {
        sessionId: golden.id,
        dbSessionId: dbSession.id,
        preCompactionTokens: totalTokens,
        postCompactionState: null,
        rebuiltContext: "",
        compactionCount: 0,
    };
}

/**
 * Trigger compaction for the DB session referenced by `played` and return updated compaction results.
 *
 * @param played - The PlayedSession whose underlying database session should be compacted
 * @returns An updated PlayedSession with `postCompactionState` set to the session state after compaction (or `null`), `rebuiltContext` containing the rebuilt context string (empty if no state), and `compactionCount` set to the session's compaction count; other fields from `played` are preserved.
 * @throws Error if the referenced database session cannot be found
 */
export async function forceCompaction(played: PlayedSession): Promise<PlayedSession> {
    const session = await prisma.loreSession.findUnique({ where: { id: played.dbSessionId } });
    if (!session) throw new Error(`Session ${played.dbSessionId} not found`);

    // Force tokens above threshold if needed
    if (session.tokensAccumulated < COMPACTION_TOKEN_THRESHOLD) {
        await prisma.loreSession.update({
            where: { id: played.dbSessionId },
            data: { tokensAccumulated: COMPACTION_TOKEN_FORCE },
        });
    }

    // Build the LoreSessionRecord that compactSession expects
    const record = {
        id: session.id,
        state: session.state,
        tokensAccumulated: Math.max(session.tokensAccumulated, COMPACTION_TOKEN_FORCE),
        compactionCount: session.compactionCount,
        compactionFailed: session.compactionFailed,
        lockedAt: session.lockedAt,
    };

    await compactSession(record);

    const updated = await prisma.loreSession.findUnique({ where: { id: played.dbSessionId } });
    const state = updated?.state as Record<string, unknown> | null;

    const context = state ? rebuildContext(
        state as unknown as LoreSessionState,
        [] as RagChunk[],
        updated!.compactionCount,
    ) : "";

    return {
        ...played,
        postCompactionState: state,
        rebuiltContext: context,
        compactionCount: updated?.compactionCount ?? 0,
    };
}

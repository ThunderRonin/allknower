import prisma from "../../src/db/client.ts";
import { compactSession, rebuildContext } from "../../src/pipeline/session-compactor.ts";
import type { LoreSessionState, RagChunk } from "../../src/types/lore.ts";
import { countTokens } from "../../src/utils/tokens.ts";

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

export async function forceCompaction(played: PlayedSession): Promise<PlayedSession> {
    const session = await prisma.loreSession.findUnique({ where: { id: played.dbSessionId } });
    if (!session) throw new Error(`Session ${played.dbSessionId} not found`);

    // Force tokens above threshold if needed
    if (session.tokensAccumulated < 80000) {
        await prisma.loreSession.update({
            where: { id: played.dbSessionId },
            data: { tokensAccumulated: 85000 },
        });
    }

    // Build the LoreSessionRecord that compactSession expects
    const record = {
        id: session.id,
        state: session.state,
        tokensAccumulated: Math.max(session.tokensAccumulated, 85000),
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

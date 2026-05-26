import { createHash } from "node:crypto";
import prisma from "../db/client.ts";
import { suggestRelationsForNote } from "./relations.ts";
import type { RelationSuggestion } from "../types/lore.ts";
import { RelationSuggestionSchema } from "../types/lore.ts";
import type { EtapiCredentials } from "../etapi/client.ts";
import { rootLogger } from "../logger.ts";
import { z } from "zod";

const inflight = new Map<string, Promise<RelationSuggestion[]>>();

export function computeContentHash(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

function inflightKey(noteId: string, userId: string, contentHash: string): string {
    return `${noteId}::${userId}::${contentHash}`;
}

export interface GetOrComputeOptions {
    noteId: string;
    text: string;
    userId?: string;
    credentials?: EtapiCredentials;
    force?: boolean;
}

export async function getOrComputeSuggestions(
    opts: GetOrComputeOptions
): Promise<RelationSuggestion[]> {
    const { noteId, text, userId = "", credentials, force } = opts;
    const hash = computeContentHash(text);

    if (!force) {
        const cached = await prisma.relationSuggestion.findUnique({
            where: { noteId_userId: { noteId, userId } },
        });

        if (cached?.contentHash === hash) {
            const parsed = z.array(RelationSuggestionSchema).safeParse(cached.suggestions);
            if (parsed.success) {
                rootLogger.info("suggestion-cache HIT", { noteId, userId });
                return parsed.data;
            }
            rootLogger.warn("suggestion-cache corrupt JSON, recomputing", { noteId });
        }
    }

    const key = inflightKey(noteId, userId, hash);
    const existing = inflight.get(key);
    if (existing) {
        rootLogger.info("suggestion-cache dedup — joining inflight request", { noteId });
        return existing;
    }

    const promise = computeAndPersist(noteId, text, hash, userId, credentials);
    inflight.set(key, promise);

    try {
        return await promise;
    } finally {
        inflight.delete(key);
    }
}

async function computeAndPersist(
    noteId: string,
    text: string,
    contentHash: string,
    userId: string,
    credentials?: EtapiCredentials,
): Promise<RelationSuggestion[]> {
    const start = performance.now();
    const suggestions = await suggestRelationsForNote(noteId, text, credentials, userId);
    const latencyMs = Math.round(performance.now() - start);

    try {
        await prisma.relationSuggestion.upsert({
            where: { noteId_userId: { noteId, userId } },
            create: {
                noteId,
                userId,
                contentHash,
                suggestions: structuredClone(suggestions),
                model: "suggest",
                tokensUsed: null,
                latencyMs,
            },
            update: {
                contentHash,
                suggestions: structuredClone(suggestions),
                model: "suggest",
                tokensUsed: null,
                latencyMs,
            },
        });
    } catch (err) {
        rootLogger.warn("suggestion-cache write failed (non-fatal)", {
            noteId,
            error: err instanceof Error ? err.message : String(err),
        });
    }

    return suggestions;
}

export async function invalidateSuggestionCache(noteId: string, userId?: string): Promise<void> {
    try {
        await prisma.relationSuggestion.deleteMany({
            where: { noteId, ...(userId ? { userId } : {}) },
        });
    } catch (err) {
        rootLogger.warn("suggestion-cache invalidate failed", {
            noteId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

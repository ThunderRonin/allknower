import { Elysia, t } from "elysia";
import { execFileSync } from "child_process";
import { requireAuth } from "../plugins/auth-guard.ts";
import prisma from "../db/client.ts";
import { invalidateCredentialCache, getAllCodexNotes, deleteNote } from "../etapi/client.ts";
import { resolveAllCodexCredentials } from "../integrations/allcodex.ts";
import { rootLogger } from "../logger.ts";

function isDevBranch(): boolean {
    try {
        return execFileSync("git", ["branch", "--show-current"], { encoding: "utf-8" }).trim() === "dev";
    } catch {
        return false;
    }
}

/**
 * POST /config/allcodex
 *
 * Accepts AllCodex URL and ETAPI token, persists them to AppConfig, and
 * invalidates the in-memory credential cache so the next ETAPI call picks
 * them up immediately. Call this whenever the portal connects AllCodex.
 */
export function createConfigRoute({
    requireAuthImpl = requireAuth,
}: { requireAuthImpl?: typeof requireAuth } = {}) {
    return new Elysia({ name: "config" })
        .use(requireAuthImpl)
        .post(
            "/config/allcodex",
            async ({ body }) => {
                await Promise.all([
                    prisma.appConfig.upsert({
                        where: { key: "allcodexUrl" },
                        update: { value: body.url },
                        create: { key: "allcodexUrl", value: body.url },
                    }),
                    prisma.appConfig.upsert({
                        where: { key: "allcodexToken" },
                        update: { value: body.token },
                        create: { key: "allcodexToken", value: body.token },
                    }),
                ]);
                invalidateCredentialCache();
                rootLogger.info("AllCodex credentials updated via API");
                return { ok: true };
            },
            {
                body: t.Object({
                    url: t.String({ minLength: 1 }),
                    token: t.String({ minLength: 1 }),
                }),
                detail: {
                    tags: ["System"],
                    summary: "Update AllCodex connection credentials",
                },
            }
        )
        .post(
            "/config/wipe",
            async ({ set, session }) => {
                if (process.env.NODE_ENV === "production" || !isDevBranch()) {
                    set.status = 404;
                    return { error: "Not found" };
                }

                // 1. Delete lore notes from AllCodex Core via ETAPI
                let coreDeleted = 0;
                try {
                    const credentials = await resolveAllCodexCredentials(session!.user.id);
                    const loreNotes = await getAllCodexNotes("#lore", credentials);
                    for (const note of loreNotes) {
                        try {
                            await deleteNote(note.noteId, credentials);
                            coreDeleted++;
                        } catch (err) {
                            rootLogger.warn("Failed to delete Core note", { noteId: note.noteId, error: String(err) });
                        }
                    }
                } catch (err) {
                    rootLogger.warn("Could not wipe Core lore notes (ETAPI unavailable or no credentials)", { error: String(err) });
                }

                // 2. Wipe AllKnower RAG + Postgres
                const { wipeDatabase } = await import("../rag/lancedb.ts");
                await wipeDatabase();

                await prisma.loreSessionMessage.deleteMany();
                await prisma.loreSession.deleteMany();
                await prisma.lLMCallLog.deleteMany();
                await prisma.ragIndexMeta.deleteMany();
                await prisma.brainDumpHistory.deleteMany();
                await prisma.relationHistory.deleteMany();

                rootLogger.info("Full wipe complete", { coreDeleted });
                return { ok: true, coreDeleted };
            },
            {
                detail: {
                    tags: ["System"],
                    summary: "Wipe all RAG data and LLM logs",
                },
            }
        );
}

export const configRoute = createConfigRoute();

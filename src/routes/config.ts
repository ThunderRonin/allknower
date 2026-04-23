import { Elysia, t } from "elysia";
import { requireAuth } from "../plugins/auth-guard.ts";
import prisma from "../db/client.ts";
import { invalidateCredentialCache } from "../etapi/client.ts";
import { rootLogger } from "../logger.ts";

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
        );
}

export const configRoute = createConfigRoute();

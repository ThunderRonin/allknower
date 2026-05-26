import Elysia, { t } from "elysia";
import prisma from "../db/client.ts";
import { requireAuth } from "../plugins/auth-guard.ts";
import { env } from "../env.ts";

export function createNotificationsRoute({ requireAuthImpl = requireAuth } = {}) {
    return new Elysia({ prefix: "/notifications" })
        .use(requireAuthImpl)
        .get("/vapid-public-key", () => ({
            publicKey: env.VAPID_PUBLIC_KEY || null,
        }))
        .post(
            "/subscribe",
            async ({ body, session, set }) => {
                if (!env.VAPID_PUBLIC_KEY) {
                    set.status = 503;
                    return { error: "PUSH_NOT_CONFIGURED", message: "Push notifications not configured." };
                }
                const userId = session!.user.id;
                await prisma.pushSubscription.upsert({
                    where: { endpoint_userId: { endpoint: body.endpoint, userId } },
                    update: {
                        p256dh: body.keys.p256dh,
                        auth: body.keys.auth,
                    },
                    create: {
                        userId,
                        endpoint: body.endpoint,
                        p256dh: body.keys.p256dh,
                        auth: body.keys.auth,
                    },
                });
                return { ok: true };
            },
            {
                body: t.Object({
                    endpoint: t.String({ minLength: 1 }),
                    keys: t.Object({
                        p256dh: t.String({ minLength: 1 }),
                        auth: t.String({ minLength: 1 }),
                    }),
                }),
            }
        )
        .delete(
            "/unsubscribe",
            async ({ body, session }) => {
                const userId = session!.user.id;
                await prisma.pushSubscription.deleteMany({
                    where: {
                        endpoint: body.endpoint,
                        userId,
                    },
                });
                return { ok: true };
            },
            {
                body: t.Object({
                    endpoint: t.String({ minLength: 1 }),
                }),
            }
        );
}

export const notificationsRoute = createNotificationsRoute();

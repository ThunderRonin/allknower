import webpush from "web-push";
import prisma from "../db/client.ts";
import { env } from "../env.ts";
import { rootLogger } from "../logger.ts";

const log = rootLogger.child({ module: "push-notify" });

export interface PushPayload {
    title: string;
    body: string;
    href?: string;
}

let vapidConfigured = false;
if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    vapidConfigured = true;
}

export async function firePushNotifications(userId: string, payload: PushPayload): Promise<void> {
    if (!vapidConfigured) return;
    let subs;
    try {
        subs = await prisma.pushSubscription.findMany({
            where: { userId },
            select: { id: true, endpoint: true, p256dh: true, auth: true },
        });
    } catch (e) {
        log.warn("Failed to fetch subscriptions", { userId, error: String(e) });
        return;
    }
    if (subs.length === 0) return;
    await Promise.allSettled(
        subs.map(async (sub) => {
            try {
                await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    JSON.stringify(payload)
                );
            } catch (e: unknown) {
                const code = (e as { statusCode?: number }).statusCode;
                if (code === 410 || code === 404) {
                    log.info("Removing expired subscription", { subscriptionId: sub.id });
                    await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
                } else {
                    log.warn("Push send failed", { subscriptionId: sub.id, error: String(e) });
                }
            }
        })
    );
}

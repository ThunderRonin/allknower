// test/e2e/notifications.e2e.test.ts
import "../helpers/e2e-mock-setup.ts";
import { describe, expect, it, afterAll, beforeAll } from "bun:test";
import { createNotificationsRoute } from "../../src/routes/notifications.ts";
import { requireAuthBypass } from "../helpers/auth.ts";
import { cleanupLanceDb } from "../helpers/e2e-harness.ts";
import { requestJson } from "../helpers/http.ts";
import { Elysia } from "elysia";
import { env } from "../../src/env.ts";

const notificationsApp = new Elysia().use(
    createNotificationsRoute({
        requireAuthImpl: requireAuthBypass,
    })
);

describe("E2E: Notifications", () => {
    let originalVapidPublicKey: string;

    beforeAll(async () => {
        // Save original key (or default it to empty string if undefined)
        originalVapidPublicKey = env.VAPID_PUBLIC_KEY || "";

        // Clean up any test-user push subscriptions
        const { default: prisma } = await import("../../src/db/client.ts");
        await prisma.pushSubscription.deleteMany({
            where: { userId: "test-user" },
        });
    });

    afterAll(async () => {
        // Restore original key
        env.VAPID_PUBLIC_KEY = originalVapidPublicKey;

        // Clean up test-user push subscriptions again
        const { default: prisma } = await import("../../src/db/client.ts");
        await prisma.pushSubscription.deleteMany({
            where: { userId: "test-user" },
        });

        await cleanupLanceDb();
    });

    describe("GET /notifications/vapid-public-key", () => {
        it("returns the configured public key", async () => {
            env.VAPID_PUBLIC_KEY = "e2e-vapid-public-key";
            const { status, json } = await requestJson(notificationsApp, "/notifications/vapid-public-key");
            expect(status).toBe(200);
            expect(json).toEqual({ publicKey: "e2e-vapid-public-key" });
        });

        it("returns null when not configured", async () => {
            env.VAPID_PUBLIC_KEY = "";
            const { status, json } = await requestJson(notificationsApp, "/notifications/vapid-public-key");
            expect(status).toBe(200);
            expect(json).toEqual({ publicKey: null });
        });
    });

    describe("POST /notifications/subscribe", () => {
        const payload = {
            endpoint: "https://example.com/e2e-endpoint",
            keys: {
                p256dh: "e2e-p256dh",
                auth: "e2e-auth",
            },
        };

        it("returns 503 if VAPID_PUBLIC_KEY is not set", async () => {
            env.VAPID_PUBLIC_KEY = "";
            const { status, json } = await requestJson(notificationsApp, "/notifications/subscribe", {
                method: "POST",
                json: payload,
            });
            expect(status).toBe(503);
            expect(json).toEqual({
                error: "PUSH_NOT_CONFIGURED",
                message: "Push notifications not configured.",
            });
        });

        it("successfully saves a subscription in the real database and updates it when sent again", async () => {
            env.VAPID_PUBLIC_KEY = "e2e-vapid-public-key";

            const { default: prisma } = await import("../../src/db/client.ts");

            // Make sure subscription doesn't exist
            await prisma.pushSubscription.deleteMany({
                where: { endpoint: payload.endpoint, userId: "test-user" },
            });

            // Call route to subscribe
            const { status, json } = await requestJson(notificationsApp, "/notifications/subscribe", {
                method: "POST",
                json: payload,
            });
            expect(status).toBe(200);
            expect(json).toEqual({ ok: true });

            // Verify in DB directly
            let record = await prisma.pushSubscription.findUnique({
                where: { endpoint_userId: { endpoint: payload.endpoint, userId: "test-user" } },
            });
            expect(record).not.toBeNull();
            expect(record?.userId).toBe("test-user");
            expect(record?.p256dh).toBe("e2e-p256dh");
            expect(record?.auth).toBe("e2e-auth");

            // Send subscription again with updated keys to check upsert (update)
            const updatedPayload = {
                endpoint: payload.endpoint,
                keys: {
                    p256dh: "e2e-p256dh-updated",
                    auth: "e2e-auth-updated",
                },
            };
            const { status: updateStatus, json: updateJson } = await requestJson(notificationsApp, "/notifications/subscribe", {
                method: "POST",
                json: updatedPayload,
            });
            expect(updateStatus).toBe(200);
            expect(updateJson).toEqual({ ok: true });

            // Verify DB record got updated
            record = await prisma.pushSubscription.findUnique({
                where: { endpoint_userId: { endpoint: payload.endpoint, userId: "test-user" } },
            });
            expect(record).not.toBeNull();
            expect(record?.userId).toBe("test-user");
            expect(record?.p256dh).toBe("e2e-p256dh-updated");
            expect(record?.auth).toBe("e2e-auth-updated");
        });
    });

    describe("DELETE /notifications/unsubscribe", () => {
        const payload = {
            endpoint: "https://example.com/e2e-endpoint",
        };

        it("deletes the subscription from the real database", async () => {
            const { default: prisma } = await import("../../src/db/client.ts");

            // Upsert a test record first
            await prisma.pushSubscription.upsert({
                where: { endpoint_userId: { endpoint: payload.endpoint, userId: "test-user" } },
                update: {
                    userId: "test-user",
                    p256dh: "e2e-p256dh",
                    auth: "e2e-auth",
                },
                create: {
                    userId: "test-user",
                    endpoint: payload.endpoint,
                    p256dh: "e2e-p256dh",
                    auth: "e2e-auth",
                },
            });

            // Call route to unsubscribe
            const { status, json } = await requestJson(notificationsApp, "/notifications/unsubscribe", {
                method: "DELETE",
                json: payload,
            });
            expect(status).toBe(200);
            expect(json).toEqual({ ok: true });

            // Verify it was deleted
            const record = await prisma.pushSubscription.findUnique({
                where: { endpoint_userId: { endpoint: payload.endpoint, userId: "test-user" } },
            });
            expect(record).toBeNull();
        });
    });
});

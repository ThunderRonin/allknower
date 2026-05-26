import { mock, describe, it, expect, beforeEach, afterEach } from "bun:test";

// ── Mock DB client ────────────────────────────────────────────────────────────
const upsertMock = mock(async () => ({}));
const deleteManyMock = mock(async () => ({ count: 0 }));

mock.module("../db/client.ts", () => ({
    default: {
        pushSubscription: {
            upsert: upsertMock,
            deleteMany: deleteManyMock,
        },
    },
}));

// ── Imports after mocks ───────────────────────────────────────────────────────
import { Elysia } from "elysia";
import { createNotificationsRoute } from "./notifications.ts";
import { requireAuthBypass } from "../../test/helpers/auth.ts";
import { requestJson } from "../../test/helpers/http.ts";
import { env } from "../env.ts";

const app = new Elysia().use(createNotificationsRoute({ requireAuthImpl: requireAuthBypass }));

describe("Notifications Route", () => {
    let originalVapidPublicKey: string;

    beforeEach(() => {
        originalVapidPublicKey = env.VAPID_PUBLIC_KEY;
        upsertMock.mockClear();
        deleteManyMock.mockClear();
    });

    afterEach(() => {
        env.VAPID_PUBLIC_KEY = originalVapidPublicKey;
    });

    describe("GET /notifications/vapid-public-key", () => {
        it("returns the public key when configured", async () => {
            env.VAPID_PUBLIC_KEY = "test-vapid-public-key";
            const { status, json } = await requestJson(app, "/notifications/vapid-public-key");

            expect(status).toBe(200);
            expect(json).toEqual({ publicKey: "test-vapid-public-key" });
        });

        it("returns null when not configured", async () => {
            env.VAPID_PUBLIC_KEY = "";
            const { status, json } = await requestJson(app, "/notifications/vapid-public-key");

            expect(status).toBe(200);
            expect(json).toEqual({ publicKey: null });
        });
    });

    describe("POST /notifications/subscribe", () => {
        it("returns 503 if VAPID_PUBLIC_KEY is not configured", async () => {
            env.VAPID_PUBLIC_KEY = "";
            const { status, json } = await requestJson(app, "/notifications/subscribe", {
                method: "POST",
                json: {
                    endpoint: "https://example.com/endpoint",
                    keys: {
                        p256dh: "p256dh-key",
                        auth: "auth-secret",
                    },
                },
            });

            expect(status).toBe(503);
            expect(json).toEqual({
                error: "PUSH_NOT_CONFIGURED",
                message: "Push notifications not configured.",
            });
            expect(upsertMock).not.toHaveBeenCalled();
        });

        it("saves/upserts subscription successfully when configured", async () => {
            env.VAPID_PUBLIC_KEY = "test-vapid-public-key";
            const { status, json } = await requestJson(app, "/notifications/subscribe", {
                method: "POST",
                json: {
                    endpoint: "https://example.com/endpoint",
                    keys: {
                        p256dh: "p256dh-key",
                        auth: "auth-secret",
                    },
                },
            });

            expect(status).toBe(200);
            expect(json).toEqual({ ok: true });
            expect(upsertMock).toHaveBeenCalledTimes(1);
            expect(upsertMock).toHaveBeenCalledWith({
                where: { endpoint_userId: { endpoint: "https://example.com/endpoint", userId: "test-user" } },
                update: {
                    p256dh: "p256dh-key",
                    auth: "auth-secret",
                },
                create: {
                    userId: "test-user",
                    endpoint: "https://example.com/endpoint",
                    p256dh: "p256dh-key",
                    auth: "auth-secret",
                },
            });
        });

        it("validates body schemas and returns 422 if endpoint is empty", async () => {
            env.VAPID_PUBLIC_KEY = "test-vapid-public-key";
            const { status } = await requestJson(app, "/notifications/subscribe", {
                method: "POST",
                json: {
                    endpoint: "",
                    keys: {
                        p256dh: "p256dh-key",
                        auth: "auth-secret",
                    },
                },
            });

            expect(status).toBe(422);
            expect(upsertMock).not.toHaveBeenCalled();
        });

        it("validates body schemas and returns 422 if keys are missing", async () => {
            env.VAPID_PUBLIC_KEY = "test-vapid-public-key";
            const { status } = await requestJson(app, "/notifications/subscribe", {
                method: "POST",
                json: {
                    endpoint: "https://example.com/endpoint",
                },
            });

            expect(status).toBe(422);
            expect(upsertMock).not.toHaveBeenCalled();
        });
    });

    describe("DELETE /notifications/unsubscribe", () => {
        it("deletes user subscription successfully", async () => {
            const { status, json } = await requestJson(app, "/notifications/unsubscribe", {
                method: "DELETE",
                json: {
                    endpoint: "https://example.com/endpoint",
                },
            });

            expect(status).toBe(200);
            expect(json).toEqual({ ok: true });
            expect(deleteManyMock).toHaveBeenCalledTimes(1);
            expect(deleteManyMock).toHaveBeenCalledWith({
                where: {
                    endpoint: "https://example.com/endpoint",
                    userId: "test-user",
                },
            });
        });

        it("returns 422 if endpoint is empty", async () => {
            const { status } = await requestJson(app, "/notifications/unsubscribe", {
                method: "DELETE",
                json: {
                    endpoint: "",
                },
            });

            expect(status).toBe(422);
            expect(deleteManyMock).not.toHaveBeenCalled();
        });
    });

    describe("Unauthorized Requests", () => {
        const requireAuthUnauthorized = new Elysia({ name: "allknower/test-require-auth-unauthorized" })
            .resolve({ as: "scoped" }, () => ({
                session: null,
            }))
            .onBeforeHandle({ as: "scoped" }, ({ session, set }) => {
                if (!session) {
                    set.status = 401;
                    return { error: "Unauthorized" };
                }
            }) as any;

        const unauthorizedApp = new Elysia().use(createNotificationsRoute({ requireAuthImpl: requireAuthUnauthorized }));

        it("returns 401 for /subscribe if not authenticated", async () => {
            const { status, json } = await requestJson(unauthorizedApp, "/notifications/subscribe", {
                method: "POST",
                json: {
                    endpoint: "https://example.com/endpoint",
                    keys: {
                        p256dh: "p256dh-key",
                        auth: "auth-secret",
                    },
                },
            });

            expect(status).toBe(401);
            expect(json).toEqual({ error: "Unauthorized" });
            expect(upsertMock).not.toHaveBeenCalled();
        });

        it("returns 401 for /unsubscribe if not authenticated", async () => {
            const { status, json } = await requestJson(unauthorizedApp, "/notifications/unsubscribe", {
                method: "DELETE",
                json: {
                    endpoint: "https://example.com/endpoint",
                },
            });

            expect(status).toBe(401);
            expect(json).toEqual({ error: "Unauthorized" });
            expect(deleteManyMock).not.toHaveBeenCalled();
        });
    });
});


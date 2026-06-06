import "../helpers/e2e-mock-setup.ts";
import { mock } from "bun:test";

// Mock auth/index.ts so the internal route's auth.api.getSession resolves a user
// without hitting real better-auth + Postgres.
mock.module("../../src/auth/index.ts", () => ({
    auth: {
        api: {
            getSession: mock(async () => ({
                user: { id: "test-user", email: "test@example.com" },
                session: { id: "test-session" },
            })),
        },
        handler: mock(async () => new Response("", { status: 200 })),
    },
}));

mock.module("../../src/auth/owner.ts", () => ({
    OWNER_USER_ID_KEY: "ownerUserId",
    ensureOwnerUserId: mock(async (userId: string) => userId),
    getOwnerUserId: mock(async () => "test-user"),
    isOwnerUserId: mock(async (userId: string | null | undefined) => userId === "test-user"),
}));

import { describe, expect, it, afterAll, beforeAll } from "bun:test";
import { cleanupLanceDb } from "../helpers/e2e-harness.ts";
import { requestJson, type RouteApp } from "../helpers/http.ts";

let app: RouteApp;

beforeAll(async () => {
    const mod = await import("../../src/app.ts");
    app = mod.app;
});

afterAll(async () => { await cleanupLanceDb(); });

describe("E2E: POST /integrations/allcodex/connect", () => {
    it("connects AllCodex integration", async () => {
        const { status, json } = await requestJson(app, "/integrations/allcodex/connect", {
            method: "POST",
            json: { baseUrl: "http://localhost:8080", token: "test-token" },
        });
        expect(status).toBe(200);
        const body = json as Record<string, unknown>;
        expect(body.ok).toBe(true);
    });
});

describe("E2E: GET /integrations/allcodex/status", () => {
    it("returns connection status", async () => {
        const { status, json } = await requestJson(app, "/integrations/allcodex/status");
        expect(status).toBe(200);
        const body = json as Record<string, unknown>;
        expect("connected" in body).toBe(true);
    });
});

describe("E2E: DELETE /integrations/allcodex", () => {
    it("disconnects AllCodex integration", async () => {
        const { status } = await requestJson(app, "/integrations/allcodex", {
            method: "DELETE",
        });
        expect(status).toBe(200);
    });
});

describe("E2E: POST /internal/integrations/allcodex/credentials", () => {
    it("rejects without portal secret header", async () => {
        const { status } = await requestJson(app, "/internal/integrations/allcodex/credentials", {
            method: "POST",
        });
        expect(status).toBeGreaterThanOrEqual(400);
    });

    it("returns credentials with valid secret header", async () => {
        const res = await app.handle(
            new Request("http://localhost/internal/integrations/allcodex/credentials", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-portal-internal-secret": "test-portal-secret",
                },
            })
        );
        expect(res.status).toBe(200);
    });
});

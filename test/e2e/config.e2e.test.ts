// test/e2e/config.e2e.test.ts
import "../helpers/e2e-mock-setup.ts";
import { describe, expect, it, afterAll } from "bun:test";
import { createConfigRoute } from "../../src/routes/config.ts";
import { requireAuthBypass } from "../helpers/auth.ts";
import { cleanupLanceDb } from "../helpers/e2e-harness.ts";
import { requestJson } from "../helpers/http.ts";
import { Elysia } from "elysia";

const configApp = new Elysia().use(createConfigRoute({ requireAuthImpl: requireAuthBypass }));

afterAll(async () => {
    await cleanupLanceDb();
});

describe("E2E: GET /config/models", () => {
    it("returns model chain configuration object", async () => {
        const { status, json } = await requestJson(configApp, "/config/models");
        expect(status).toBe(200);
        const body = json as Record<string, unknown>;
        expect(typeof body).toBe("object");
    });
});

describe("E2E: POST /config/allcodex", () => {
    it("upserts AllCodex configuration to real DB", async () => {
        const { status, json } = await requestJson(configApp, "/config/allcodex", {
            method: "POST",
            json: { url: "http://localhost:8080", token: "test-token" },
        });
        expect(status).toBe(200);
        const body = json as Record<string, unknown>;
        expect(body.ok).toBe(true);
    });

    it("rejects missing url field", async () => {
        const { status } = await requestJson(configApp, "/config/allcodex", {
            method: "POST",
            json: { token: "test-token" },
        });
        expect(status).toBeGreaterThanOrEqual(400);
    });
});

describe("E2E: POST /config/wipe", () => {
    it("rejects in production mode with 404", async () => {
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        try {
            const { status } = await requestJson(configApp, "/config/wipe", {
                method: "POST",
            });
            expect(status).toBe(404);
        } finally {
            process.env.NODE_ENV = prev;
        }
    });
});

// test/e2e/health.e2e.test.ts
import "../helpers/e2e-mock-setup.ts";
import { describe, expect, it, afterAll } from "bun:test";
import { app } from "../../src/app.ts";
import { cleanupLanceDb } from "../helpers/e2e-harness.ts";
import { requestJson } from "../helpers/http.ts";

afterAll(async () => {
    await cleanupLanceDb();
});

describe("E2E: GET /health", () => {
    it("returns 200 with status and nested checks fields", async () => {
        const { status, json } = await requestJson(app, "/health");
        expect(status).toBe(200);
        const body = json as Record<string, unknown>;
        expect(body.status).toBeDefined();
        const checks = body.checks as Record<string, unknown>;
        expect(checks).toBeDefined();
        expect(checks.database).toBeDefined();
        expect(checks.lancedb).toBeDefined();
        expect(checks.allcodex).toBeDefined();
        expect(checks.bootstrap).toBeDefined();
    });

    it("database field reflects real DB connectivity", async () => {
        const { json } = await requestJson(app, "/health");
        const body = json as Record<string, unknown>;
        const checks = body.checks as Record<string, any>;
        expect(checks.database.ok).toBe(true);
    });

    it("lancedb field reflects real LanceDB connectivity", async () => {
        const { json } = await requestJson(app, "/health");
        const body = json as Record<string, unknown>;
        const checks = body.checks as Record<string, any>;
        expect(checks.lancedb.ok).toBe(true);
    });
});

describe("E2E: GET /", () => {
    it("returns 200 with service info", async () => {
        const { status, json } = await requestJson(app, "/");
        expect(status).toBe(200);
        const body = json as Record<string, unknown>;
        expect(body.name).toBe("AllKnower");
    });
});

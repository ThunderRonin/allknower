import { mock } from "bun:test";

const unusedModel = {};

mock.module("../env.ts", () => ({
    env: {
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://allknower:allknower@localhost:5436/allknower",
        PORTAL_INTERNAL_SECRET: "test-secret",
        BETTER_AUTH_URL: "http://localhost:3001",
    },
}));

mock.module("../db/client.ts", () => ({
    default: {
        account: unusedModel,
        appConfig: unusedModel,
        brainDumpHistory: unusedModel,
        brainDumpJob: unusedModel,
        brainDumpRevisionLink: unusedModel,
        lLMCallLog: unusedModel,
        loreSession: unusedModel,
        loreSessionMessage: unusedModel,
        modelPricing: unusedModel,
        pushSubscription: unusedModel,
        ragIndexMeta: unusedModel,
        relationHistory: unusedModel,
        relationSuggestion: unusedModel,
        verification: unusedModel,
        user: {
            findFirst: mock(async () => ({ id: "owner-1", email: "owner@example.com", name: "Owner" })),
        },
        userIntegration: unusedModel,
        session: {
            findFirst: mock(async () => null),
            create: mock(async () => ({})),
        },
    },
}));

mock.module("../bootstrap/index.ts", () => ({
    getBootstrapStatus: () => ({ ran: true, userReady: true, etapiReady: true }),
    runBootstrap: mock(async () => {}),
}));

import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { requestJson } from "../../test/helpers/http.ts";

const { autoProvisionRoute } = await import("./auto-provision.ts");

const app = new Elysia().use(autoProvisionRoute);

describe("POST /internal/auto-provision", () => {
    it("is disabled in production", async () => {
        const { status, json } = await requestJson(app, "/internal/auto-provision", {
            method: "POST",
            headers: { "X-Portal-Internal-Secret": "test-secret" },
        });

        expect(status).toBe(404);
        expect((json as any).error).toBe("Not found");
    });
});

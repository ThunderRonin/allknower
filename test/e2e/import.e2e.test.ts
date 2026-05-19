import "../helpers/e2e-mock-setup.ts";
import { describe, expect, it, afterAll } from "bun:test";
import { createImportRoute } from "../../src/routes/import.ts";
import { createSetupRoute } from "../../src/routes/setup.ts";
import { requireAuthBypass } from "../helpers/auth.ts";
import { cleanupLanceDb } from "../helpers/e2e-harness.ts";
import { requestJson } from "../helpers/http.ts";
import { Elysia } from "elysia";
import azgaarFixture from "../fixtures/azgaar-map-minimal.json";

const importApp = new Elysia()
    .use(createImportRoute({ requireAuthImpl: requireAuthBypass }))
    .use(createSetupRoute({ requireAuthImpl: requireAuthBypass }));

afterAll(async () => { await cleanupLanceDb(); });

describe("E2E: POST /import/system-pack", () => {
    it("creates system template notes via ETAPI", async () => {
        const { status } = await requestJson(importApp, "/import/system-pack", {
            method: "POST",
            json: {
                notes: [
                    { name: "Goblin", cr: "1/4", type: "Humanoid", ac: 15, hp: 7 },
                ],
            },
        });
        expect(status).toBe(200);
    }, 30_000);
});

describe("E2E: POST /import/azgaar/preview", () => {
    it("returns preview of Azgaar map entities", async () => {
        const { status } = await requestJson(importApp, "/import/azgaar/preview", {
            method: "POST",
            json: azgaarFixture,
        });
        expect([200, 501]).toContain(status);
    }, 15_000);
});

describe("E2E: POST /import/azgaar", () => {
    it("imports Azgaar map data", async () => {
        const { status } = await requestJson(importApp, "/import/azgaar", {
            method: "POST",
            json: azgaarFixture,
        });
        expect(status).toBe(200);
    }, 60_000);
});

describe("E2E: POST /setup/seed-templates", () => {
    it("seeds lore templates", async () => {
        const { status } = await requestJson(importApp, "/setup/seed-templates", {
            method: "POST",
        });
        expect(status).toBe(200);
    }, 30_000);
});

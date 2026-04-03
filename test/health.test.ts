import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import { requestJson } from "./helpers/http.ts";

let allcodexOk = true;
let lancedbOk = true;
let databaseOk = true;

mock.module("../src/etapi/client.ts", () => ({
    checkAllCodexHealth: mock(async () => ({ ok: allcodexOk }))
}));

mock.module("../src/rag/lancedb.ts", () => ({
    checkLanceDbHealth: mock(async () => ({ ok: lancedbOk }))
}));

mock.module("../src/db/client.ts", () => ({
    default: {
        $queryRaw: mock(async () => {
            if (!databaseOk) {
                throw new Error("database unavailable");
            }

            return [{ ok: 1 }];
        })
    }
}));

const { healthRoute } = await import("../src/routes/health.ts");

const app = new Elysia().use(healthRoute);

describe("GET /health", () => {
    beforeEach(() => {
        allcodexOk = true;
        lancedbOk = true;
        databaseOk = true;
    });

    it("returns the documented health shape when dependencies are healthy", async () => {
        const { status, json } = await requestJson(app, "/health");

        expect(status).toBe(200);
        expect(json).toEqual({
            status: "ok",
            checks: {
                allcodex: { ok: true },
                lancedb: { ok: true },
                database: { ok: true },
            },
        });
    });

    it("returns 503 with degraded status when a dependency check fails", async () => {
        lancedbOk = false;

        const { status, json } = await requestJson(app, "/health");
        const body = json as {
            status: string;
            checks: Record<string, { ok: boolean }>;
        };

        expect(status).toBe(503);
        expect(body.status).toBe("degraded");
        expect(body.checks.allcodex.ok).toBe(true);
        expect(body.checks.lancedb.ok).toBe(false);
        expect(body.checks.database.ok).toBe(true);
    });
});
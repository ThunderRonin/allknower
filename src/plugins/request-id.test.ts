import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { requestIdPlugin } from "./request-id.ts";
import { requestJson } from "../../test/helpers/http.ts";

// Build test app that exposes requestId and log in response body for inspection
const app = new Elysia()
    .use(requestIdPlugin)
    .get("/test", ({ requestId, log }) => ({
        requestId,
        hasLog: !!log,
        logHasInfo: typeof log?.info === "function",
    }));

describe("requestIdPlugin", () => {
    it("provides requestId in handler context", async () => {
        const { json } = await requestJson(app, "/test");
        const body = json as any;
        expect(typeof body.requestId).toBe("string");
        expect(body.requestId.length).toBeGreaterThan(0);
    });

    it("requestId is 8 characters (UUID slice 0-8)", async () => {
        const { json } = await requestJson(app, "/test");
        const body = json as any;
        expect(body.requestId).toHaveLength(8);
    });

    it("requestId is unique per request", async () => {
        const r1 = await requestJson(app, "/test");
        const r2 = await requestJson(app, "/test");
        expect((r1.json as any).requestId).not.toBe((r2.json as any).requestId);
    });

    it("requestId is alphanumeric hex (UUID slice format: [0-9a-f-])", async () => {
        const { json } = await requestJson(app, "/test");
        const { requestId } = json as any;
        expect(requestId).toMatch(/^[0-9a-f-]+$/);
    });

    it("provides log child logger in handler context", async () => {
        const { json } = await requestJson(app, "/test");
        const body = json as any;
        expect(body.hasLog).toBe(true);
    });

    it("log has .info() method", async () => {
        const { json } = await requestJson(app, "/test");
        const body = json as any;
        expect(body.logHasInfo).toBe(true);
    });

    it("returns 200 on /test (plugin does not block requests)", async () => {
        const { status } = await requestJson(app, "/test");
        expect(status).toBe(200);
    });
});

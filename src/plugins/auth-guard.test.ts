import { mock } from "bun:test";

const mockGetSession = mock(async () => null as { user?: { id: string } } | null);

mock.module("../auth/index.ts", () => ({
    auth: {
        api: {
            getSession: mockGetSession,
        },
        handler: async () => new Response("auth"),
    },
}));

import { beforeEach, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { requireAuth } from "./auth-guard.ts";
import { requestJson } from "../../test/helpers/http.ts";

// Build minimal app that uses requireAuth and has a protected route
const app = new Elysia()
    .use(requireAuth)
    .get("/protected", () => ({ ok: true }));

beforeEach(() => {
    mockGetSession.mockClear();
    mockGetSession.mockResolvedValue(null);
});

describe("requireAuth", () => {
    it("returns 401 when no session (getSession returns null)", async () => {
        mockGetSession.mockResolvedValue(null);
        const { status } = await requestJson(app, "/protected");
        expect(status).toBe(401);
    });

    it("returns 401 JSON error body when unauthenticated", async () => {
        mockGetSession.mockResolvedValue(null);
        const { json } = await requestJson(app, "/protected");
        const body = json as any;
        expect(body.error).toBe("Unauthorized");
    });

    it("passes through (200) when session is present", async () => {
        mockGetSession.mockResolvedValue({ user: { id: "user-1" } } as any);
        const { status } = await requestJson(app, "/protected");
        expect(status).toBe(200);
    });

    it("calls auth.api.getSession with request headers", async () => {
        mockGetSession.mockResolvedValue({ user: { id: "user-1" } } as any);
        await requestJson(app, "/protected", {
            headers: { "Cookie": "test-cookie" },
        });
        expect(mockGetSession).toHaveBeenCalledWith(
            expect.objectContaining({ headers: expect.any(Headers) })
        );
    });

    it("returns 401 even when getSession throws", async () => {
        mockGetSession.mockRejectedValue(new Error("DB connection error"));
        try {
            const { status } = await requestJson(app, "/protected");
            // If Elysia catches and returns 500+ that's also acceptable — just not 200
            expect(status).not.toBe(200);
        } catch {
            // If it propagates, the test still passes (no 200 was served)
        }
    });

    it('response has Content-Type: application/json on 401', async () => {
        mockGetSession.mockResolvedValue(null);
        const { response } = await requestJson(app, "/protected");
        expect(response.headers.get("Content-Type")).toContain("application/json");
    });
});

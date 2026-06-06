import { mock } from "bun:test";

const mockGetSession = mock(async () => null as { user?: { id: string } } | null);
const mockGetOwnerUserId = mock(async () => "owner-1" as string | null);

mock.module("../auth/index.ts", () => ({
    auth: {
        api: {
            getSession: mockGetSession,
        },
        handler: async () => new Response("auth"),
    },
}));

mock.module("../auth/owner.ts", () => ({
    OWNER_USER_ID_KEY: "ownerUserId",
    ensureOwnerUserId: mock(async (userId: string) => userId),
    getOwnerUserId: mockGetOwnerUserId,
    isOwnerUserId: mock(async (userId: string | null | undefined) => userId === await mockGetOwnerUserId()),
}));

import { beforeEach, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { requestJson } from "../../test/helpers/http.ts";

const { requireAuth, requireOwnerAuth, requireSessionAuth } = await import("./auth-guard.ts");

// Build minimal app that uses requireAuth and has a protected route
const app = new Elysia()
    .use(requireAuth)
    .get("/protected", () => ({ ok: true }));

const sessionApp = new Elysia()
    .use(requireSessionAuth)
    .get("/session-only", () => ({ ok: true }));

const ownerApp = new Elysia()
    .use(requireOwnerAuth)
    .get("/owner-only", ({ session }) => ({ ok: true, userId: session!.user.id }));

beforeEach(() => {
    mockGetSession.mockClear();
    mockGetSession.mockResolvedValue(null);
    mockGetOwnerUserId.mockClear();
    mockGetOwnerUserId.mockResolvedValue("owner-1");
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

    it("passes through (200) when owner session is present", async () => {
        mockGetSession.mockResolvedValue({ user: { id: "owner-1" } } as any);
        const { status } = await requestJson(app, "/protected");
        expect(status).toBe(200);
    });

    it("calls auth.api.getSession with request headers", async () => {
        mockGetSession.mockResolvedValue({ user: { id: "owner-1" } } as any);
        await requestJson(app, "/protected", {
            headers: { "Cookie": "test-cookie" },
        });
        expect(mockGetSession).toHaveBeenCalledWith(
            expect.objectContaining({ headers: expect.any(Headers) })
        );
    });

    it("returns 503 when getSession throws", async () => {
        mockGetSession.mockRejectedValue(new Error("DB connection error"));
        const { status, json } = await requestJson(app, "/protected");
        expect(status).toBe(503);
        expect((json as any).error).toBe("Auth unavailable");
    });

    it('response has Content-Type: application/json on 401', async () => {
        mockGetSession.mockResolvedValue(null);
        const { response } = await requestJson(app, "/protected");
        expect(response.headers.get("Content-Type")).toContain("application/json");
    });
});

describe("requireSessionAuth", () => {
    it("returns 503 when session lookup throws", async () => {
        mockGetSession.mockRejectedValue(new Error("DB connection error"));
        const { status, json } = await requestJson(sessionApp, "/session-only");
        expect(status).toBe(503);
        expect((json as any).error).toBe("Auth unavailable");
    });
});

describe("requireOwnerAuth", () => {
    it("returns 401 when no session is present", async () => {
        mockGetSession.mockResolvedValue(null);
        const { status, json } = await requestJson(ownerApp, "/owner-only");
        expect(status).toBe(401);
        expect((json as any).error).toBe("Unauthorized");
    });

    it("returns 403 when authenticated user is not owner", async () => {
        mockGetSession.mockResolvedValue({ user: { id: "viewer-1" } } as any);
        const { status, json } = await requestJson(ownerApp, "/owner-only");
        expect(status).toBe(403);
        expect((json as any).error).toBe("Forbidden");
    });

    it("passes through when authenticated user is owner", async () => {
        mockGetSession.mockResolvedValue({ user: { id: "owner-1" } } as any);
        const { status, json } = await requestJson(ownerApp, "/owner-only");
        expect(status).toBe(200);
        expect((json as any).userId).toBe("owner-1");
    });

    it("returns 503 when owner is not configured", async () => {
        mockGetOwnerUserId.mockResolvedValue(null);
        mockGetSession.mockResolvedValue({ user: { id: "owner-1" } } as any);
        const { status, json } = await requestJson(ownerApp, "/owner-only");
        expect(status).toBe(503);
        expect((json as any).error).toBe("Owner not configured");
    });

    it("returns 503 when owner lookup throws", async () => {
        mockGetOwnerUserId.mockRejectedValue(new Error("DB connection error"));
        mockGetSession.mockResolvedValue({ user: { id: "owner-1" } } as any);
        const { status, json } = await requestJson(ownerApp, "/owner-only");
        expect(status).toBe(503);
        expect((json as any).error).toBe("Auth unavailable");
    });
});

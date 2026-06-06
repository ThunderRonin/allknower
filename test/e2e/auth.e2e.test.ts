import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import type { PrismaClient } from "@prisma/client";
import type { App } from "../../src/app.ts";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ||= "postgresql://allknower:allknower@localhost:5436/allknower";
process.env.BETTER_AUTH_SECRET ||= "test-better-auth-secret-32chars";
process.env.OPENROUTER_API_KEY ||= "test-openrouter-key";
process.env.ALLCODEX_ETAPI_TOKEN ||= "test-etapi-token";

const runId = randomUUID().replace(/-/g, "").slice(0, 12);
const ownerEmail = `auth-owner-${runId}@example.com`;
const blockedEmail = `auth-blocked-${runId}@example.com`;
const ownerPassword = `AuthOwner-${runId}-Password1!`;

let app: App;
let prisma: PrismaClient;
let baseUrl = "http://localhost:3001";
let bootstrapSecret = "";
let ownerUserIdKey = "";
let previousOwnerUserId: string | null = null;

async function cleanupAuthUsers(emails: string[]) {
    const users = await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    if (userIds.length === 0) return;

    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userIntegration.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

function setCookieHeader(response: Response): string {
    const headersWithCookies = response.headers as Headers & { getSetCookie?: () => string[] };
    const setCookies = headersWithCookies.getSetCookie?.() ?? [];
    const rawCookies = setCookies.length > 0
        ? setCookies
        : (response.headers.get("set-cookie") ?? "")
            .split(/,\s*(?=[^=;,\s]+=)/)
            .filter(Boolean);

    return rawCookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

function request(path: string, init: RequestInit = {}) {
    return app.handle(new Request(`${baseUrl}${path}`, init));
}

function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
    return request(path, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Origin: baseUrl,
            ...headers,
        },
        body: JSON.stringify(body),
    });
}

beforeAll(async () => {
    const envModule = await import("../../src/env.ts");
    const appModule = await import("../../src/app.ts");
    const prismaModule = await import("../../src/db/client.ts");
    const ownerModule = await import("../../src/auth/owner.ts");

    app = appModule.app;
    prisma = prismaModule.default;
    baseUrl = envModule.env.BETTER_AUTH_URL;
    bootstrapSecret = envModule.env.PORTAL_INTERNAL_SECRET;
    ownerUserIdKey = ownerModule.OWNER_USER_ID_KEY;

    const previousOwner = await prisma.appConfig.findUnique({
        where: { key: ownerUserIdKey },
        select: { value: true },
    });
    previousOwnerUserId = previousOwner?.value ?? null;

    await cleanupAuthUsers([ownerEmail, blockedEmail]);
    await prisma.appConfig.deleteMany({ where: { key: ownerUserIdKey } });
});

afterAll(async () => {
    if (previousOwnerUserId) {
        await prisma.appConfig.upsert({
            where: { key: ownerUserIdKey },
            update: { value: previousOwnerUserId },
            create: { key: ownerUserIdKey, value: previousOwnerUserId },
        });
    } else {
        await prisma.appConfig.deleteMany({ where: { key: ownerUserIdKey } });
    }

    await cleanupAuthUsers([ownerEmail, blockedEmail]);
});

describe("real better-auth integration", () => {
    test("bootstrap sign-up becomes owner and can sign in with a real session cookie", async () => {
        const signUpResponse = await postJson(
            "/api/auth/sign-up/email",
            { email: ownerEmail, password: ownerPassword, name: "Auth Owner" },
            { "X-AllCodex-Bootstrap-Secret": bootstrapSecret }
        );
        expect(signUpResponse.status).toBeLessThan(300);

        const user = await prisma.user.findUnique({
            where: { email: ownerEmail },
            select: { id: true },
        });
        expect(user).not.toBeNull();

        const ownerConfig = await prisma.appConfig.findUnique({
            where: { key: ownerUserIdKey },
            select: { value: true },
        });
        expect(ownerConfig?.value).toBe(user?.id);

        const signInResponse = await postJson(
            "/api/auth/sign-in/email",
            { email: ownerEmail, password: ownerPassword },
        );
        expect(signInResponse.status).toBeLessThan(300);

        const cookieHeader = setCookieHeader(signInResponse);
        expect(cookieHeader.length).toBeGreaterThan(0);

        const ownerSessionResponse = await request("/auth/owner-session", {
            headers: { Cookie: cookieHeader },
        });
        expect(ownerSessionResponse.status).toBe(200);
        await expect(ownerSessionResponse.json()).resolves.toEqual(expect.objectContaining({
            ok: true,
            user: expect.objectContaining({ email: ownerEmail }),
        }));
    });

    test("email sign-up without bootstrap secret is forbidden", async () => {
        const response = await postJson("/api/auth/sign-up/email", {
            email: blockedEmail,
            password: ownerPassword,
            name: "Blocked User",
        });

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            error: "FORBIDDEN",
        }));
    });
});

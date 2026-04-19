import { Elysia } from "elysia";
import type { requireAuth } from "../../src/plugins/auth-guard.ts";

export const requireAuthBypass = new Elysia({ name: "allknower/test-require-auth" })
    .resolve({ as: "scoped" }, () => ({ session: null as null }))
    .onBeforeHandle({ as: "scoped" }, () => {
        // always passes — bypass for tests
        return undefined as { error: string } | undefined;
    }) as unknown as typeof requireAuth;

export const REAL_AUTH_BLOCKER = "Real better-auth sign-in integration is blocked because the repository only provides .env.example and no seeded owner credentials or deterministic auth bootstrap for tests.";
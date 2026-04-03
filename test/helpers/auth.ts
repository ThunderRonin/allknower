import { Elysia } from "elysia";

export const requireAuthBypass = new Elysia({ name: "allknower/test-require-auth" });

export const REAL_AUTH_BLOCKER = "Real better-auth sign-in integration is blocked because the repository only provides .env.example and no seeded owner credentials or deterministic auth bootstrap for tests.";
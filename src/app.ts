import { Elysia } from "elysia";
import { openapi } from "@elysiajs/openapi";
import { logixlysia } from "logixlysia";
import { plugins } from "./plugins/index.ts";
import { requestIdPlugin } from "./plugins/request-id.ts";
import { brainDumpRoute } from "./routes/brain-dump.ts";
import { ragRoute } from "./routes/rag.ts";
import { consistencyRoute } from "./routes/consistency.ts";
import { suggestRoute } from "./routes/suggest.ts";
import { healthRoute } from "./routes/health.ts";
import { setupRoute } from "./routes/setup.ts";
import { importRoute } from "./routes/import.ts";
import { configRoute } from "./routes/config.ts";
import { copilotRoute } from "./routes/copilot.ts";
import { metricsRoute } from "./routes/metrics.ts";
import { integrationsRoute, internalIntegrationsRoute } from "./routes/integrations.ts";
import { autoProvisionRoute } from "./routes/auto-provision.ts";
import { notificationsRoute } from "./routes/notifications.ts";
import { usageRoute } from "./routes/usage.ts";
import { auth } from "./auth/index.ts";
import { ensureOwnerUserId, isOwnerUserId } from "./auth/owner.ts";
import { hasBootstrapSecret, isEmailSignUpRequest } from "./auth/sign-up-gate.ts";
import { env } from "./env.ts";
import prisma from "./db/client.ts";

async function readSignUpEmail(request: Request): Promise<string | null> {
    try {
        const body = await request.clone().json() as { email?: unknown };
        return typeof body.email === "string" ? body.email : null;
    } catch {
        return null;
    }
}

async function ensureBootstrapOwner(email: string) {
    const normalized = email.trim();
    if (!normalized) {
        throw new Error("Bootstrap sign-up email missing.");
    }

    const candidateEmails = Array.from(new Set([normalized, normalized.toLowerCase()]));
    const user = await prisma.user.findFirst({
        where: { email: { in: candidateEmails } },
        select: { id: true },
    });

    if (!user) {
        throw new Error(`Bootstrap user not found after sign-up: ${normalized}`);
    }

    await ensureOwnerUserId(user.id);
}

async function handleAuthRequest(request: Request): Promise<Response> {
    const isEmailSignUp = isEmailSignUpRequest(request);
    if (isEmailSignUp && !hasBootstrapSecret(request, env.PORTAL_INTERNAL_SECRET)) {
        return Response.json(
            { error: "FORBIDDEN", message: "Sign-up is disabled. Use the owner account." },
            { status: 403 }
        );
    }

    const signUpEmail = isEmailSignUp ? await readSignUpEmail(request) : null;
    const response = await auth.handler(request);

    if (isEmailSignUp && response.ok && signUpEmail) {
        await ensureBootstrapOwner(signUpEmail);
    }

    return response;
}

export const app = new Elysia()
    // ── Request logging ───────────────────────────────────────────────────────
    .use(
        logixlysia({
            config: {
                showStartupMessage: true,
                startupMessageFormat: "simple",
                timestamp: { translateTime: "HH:MM:ss" },
                ip: true,
                logFilePath: "./logs/allknower.log",
                customLogFormat:
                    "🧠 {now} {level} {duration} {method} {pathname} {status} {message} {ip}",
            },
        } as any)
    )
    // ── Infrastructure plugins ────────────────────────────────────────────────
    .use(plugins)
    .use(requestIdPlugin)

    // ── API documentation (Scalar via @elysiajs/openapi) ─────────────────────
    .use(
        openapi({
            documentation: {
                info: {
                    title: "AllKnower API",
                    version: "0.1.0",
                    description:
                        "The intelligence layer behind AllCodex — AI orchestration, RAG, and lore management for the All Reach grimoire.",
                },
                tags: [
                    { name: "Brain Dump", description: "AI-powered lore extraction pipeline" },
                    { name: "RAG", description: "Retrieval-augmented generation index management" },
                    { name: "Intelligence", description: "Consistency checking, relationship suggestions, and autocomplete" },
                    { name: "System", description: "Health and system status" },
                ],
            },
            path: "/reference",
        })
    )

    // ── better-auth handler ───────────────────────────────────────────────────
    .all("/api/auth/*", ({ request }) => handleAuthRequest(request), {
        parse: "none",
        detail: { hide: true },
    })
    .get("/auth/owner-session", async ({ request, set }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        const userId = session?.user?.id;
        if (!session || !userId) {
            set.status = 401;
            return { error: "Unauthorized" };
        }
        if (!(await isOwnerUserId(userId))) {
            set.status = 403;
            return { error: "Forbidden" };
        }
        return { ok: true, user: session.user };
    }, {
        detail: { hide: true },
    })

    // ── Routes ────────────────────────────────────────────────────────────────
    .use(healthRoute)
    .use(brainDumpRoute)
    .use(ragRoute)
    .use(consistencyRoute)
    .use(suggestRoute)
    .use(copilotRoute)
    .use(metricsRoute)
    .use(setupRoute)
    .use(importRoute)
    .use(configRoute)
    .use(integrationsRoute)
    .use(internalIntegrationsRoute)
    .use(autoProvisionRoute)
    .use(notificationsRoute)
    .use(usageRoute)

    // ── Root ──────────────────────────────────────────────────────────────────
    .get("/", () => ({
        name: "AllKnower",
        version: "0.1.0",
        description: "The brain behind AllCodex — AI orchestration for All Reach",
        docs: "/reference",
        health: "/health",
    }));

export type App = typeof app;

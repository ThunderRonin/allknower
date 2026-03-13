import { Elysia } from "elysia";
import { openapi } from "@elysiajs/openapi";
import { logixlysia } from "logixlysia";
import { plugins } from "./plugins/index.ts";
import { brainDumpRoute } from "./routes/brain-dump.ts";
import { ragRoute } from "./routes/rag.ts";
import { consistencyRoute } from "./routes/consistency.ts";
import { suggestRoute } from "./routes/suggest.ts";
import { healthRoute } from "./routes/health.ts";
import { setupRoute } from "./routes/setup.ts";
import { auth } from "./auth/index.ts";
import { env } from "./env.ts";

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
    .all("/api/auth/*", ({ request }) => auth.handler(request), {
        parse: "none",
        detail: { hide: true },
    })

    // ── Routes ────────────────────────────────────────────────────────────────
    .use(healthRoute)
    .use(brainDumpRoute)
    .use(ragRoute)
    .use(consistencyRoute)
    .use(suggestRoute)
    .use(setupRoute)

    // ── Root ──────────────────────────────────────────────────────────────────
    .get("/", () => ({
        name: "AllKnower",
        version: "0.1.0",
        description: "The brain behind AllCodex — AI orchestration for All Reach",
        docs: "/reference",
        health: "/health",
    }));

export type App = typeof app;

// test/helpers/e2e-mock-setup.ts
import { mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Elysia from "elysia";
import "./mock-llm.ts"; // registers LLM mocks as side effect

const DIMS = 4;
export const E2E_LANCEDB_DIR = mkdtempSync(join(tmpdir(), "allknower-e2e-lancedb-"));

mock.module("../../src/rag/embedder.ts", () => ({
    embed: async () => Array.from({ length: DIMS }, () => Math.random()),
    embedBatch: async (texts: string[]) =>
        texts.map(() => Array.from({ length: DIMS }, () => Math.random())),
    EMBEDDING_DIMENSIONS: DIMS,
}));

mock.module("../../src/etapi/client.ts", () => ({
    createNote: mock(async () => ({ note: { noteId: `note-${Date.now()}` } })),
    setNoteTemplate: mock(async () => {}),
    tagNote: mock(async () => {}),
    createAttribute: mock(async () => {}),
    getNote: mock(async () => ({
        noteId: "note-1",
        title: "Aldric",
        type: "text",
        attributes: [],
    })),
    checkAllCodexHealth: mock(async () => ({ ok: true, appVersion: "0.1.0" })),
    probeAllCodex: mock(async () => ({ ok: true })),
    invalidateCredentialCache: mock(() => {}),
    getAllCodexNotes: mock(async () => [
        { noteId: "note-1", title: "Aldric", type: "text" },
    ]),
    getNoteContent: mock(async () => "<p>Aldric is the king of Valorheim.</p>"),
    setNoteContent: mock(async () => {}),
    updateNote: mock(async (id: string) => ({ noteId: id })),
    createRelation: mock(async () => {}),
    deleteNote: mock(async () => {}),
}));

mock.module("../../src/integrations/allcodex.ts", () => ({
    resolveAllCodexCredentials: mock(async () => ({
        baseUrl: "http://localhost:8080",
        token: "test-etapi-token",
    })),
    connectAllCodexIntegration: mock(async () => ({ ok: true })),
    getAllCodexIntegrationStatus: mock(async () => ({
        connected: true,
        provider: "allcodex",
    })),
    deleteAllCodexIntegration: mock(async () => ({ ok: true })),
    IntegrationNotConnectedError: class extends Error {
        constructor() { super("Not connected"); this.name = "IntegrationNotConnectedError"; }
    },
}));

mock.module("../../src/plugins/auth-guard.ts", () => ({
    requireAuth: new Elysia({ name: "allknower/require-auth" })
        .resolve({ as: "scoped" }, () => ({
            session: {
                session: { id: "test-session" },
                user: { id: "test-user", email: "test@example.com" },
            },
        }))
        .onBeforeHandle({ as: "scoped" }, () => undefined),
}));

mock.module("../../src/bootstrap/index.ts", () => ({
    getBootstrapStatus: mock(() => ({
        ran: true,
        userReady: true,
        etapiReady: true,
    })),
    runBootstrap: mock(async () => {}),
}));

mock.module("../../src/env.ts", () => ({
    env: {
        LANCEDB_PATH: E2E_LANCEDB_DIR,
        EMBEDDING_DIMENSIONS: DIMS,
        RAG_CHUNK_DEDUP_SIMILARITY_THRESHOLD: 0.85,
        RAG_CONTEXT_MAX_TOKENS: 6000,
        RAG_CHUNK_SUMMARY_THRESHOLD_TOKENS: 600,
        OPENROUTER_API_KEY: "test-key",
        OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
        RERANK_MODEL: "test/rerank",
        EMBEDDING_CLOUD: "test/model",
        DATABASE_URL: process.env.DATABASE_URL,
        NODE_ENV: "test",
        SESSION_TOKEN_THRESHOLD: 80000,
        BETTER_AUTH_SECRET: "test-secret-minimum-16-chars",
        ALLCODEX_ETAPI_TOKEN: "test-etapi-token",
        ALLCODEX_URL: "http://localhost:8080",
        PORTAL_INTERNAL_SECRET: "test-portal-secret",
    },
}));

import { mock } from "bun:test";

// ── Mock refs ─────────────────────────────────────────────────────────────────
const upsertMock = mock(async () => ({}));
const invalidateMock = mock(() => {});

mock.module("../db/client.ts", () => ({
    default: {
        appConfig: { upsert: upsertMock },
    },
}));

mock.module("../etapi/client.ts", () => ({
    invalidateCredentialCache: invalidateMock,
    getAllCodexNotes: mock(async () => []),
    getNoteContent: mock(async () => ""),
    createNote: mock(async () => ({ note: { noteId: "n" }, branch: {} })),
    setNoteContent: mock(async () => {}),
    updateNote: mock(async (id: string) => ({ noteId: id })),
    tagNote: mock(async () => {}),
    setNoteTemplate: mock(async () => {}),
    createAttribute: mock(async () => {}),
    createRelation: mock(async () => {}),
    checkAllCodexHealth: mock(async () => ({ ok: true })),
    probeAllCodex: mock(async () => ({ ok: true })),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from "bun:test";
import { Elysia } from "elysia";
import { createConfigRoute } from "./config.ts";
import { requireAuthBypass } from "../../test/helpers/auth.ts";
import { requestJson } from "../../test/helpers/http.ts";

const app = new Elysia().use(createConfigRoute({ requireAuthImpl: requireAuthBypass }));

beforeEach(() => {
    upsertMock.mockClear();
    invalidateMock.mockClear();
    upsertMock.mockResolvedValue({});
    invalidateMock.mockReturnValue(undefined);
});

describe("POST /config/allcodex", () => {
    it("persists URL and token then returns { ok: true }", async () => {
        const { status, json } = await requestJson(app, "/config/allcodex", {
            method: "POST",
            json: { url: "http://localhost:8080", token: "secret-token" },
        });

        expect(status).toBe(200);
        expect((json as { ok: boolean }).ok).toBe(true);
        expect(upsertMock).toHaveBeenCalledTimes(2);
    });

    it("calls invalidateCredentialCache after persisting credentials", async () => {
        await requestJson(app, "/config/allcodex", {
            method: "POST",
            json: { url: "http://localhost:8080", token: "secret-token" },
        });

        expect(invalidateMock).toHaveBeenCalledTimes(1);
    });

    it("rejects empty URL with 422", async () => {
        const { status } = await requestJson(app, "/config/allcodex", {
            method: "POST",
            json: { url: "", token: "secret-token" },
        });

        expect(status).toBe(422);
        expect(upsertMock).not.toHaveBeenCalled();
    });

    it("rejects empty token with 422", async () => {
        const { status } = await requestJson(app, "/config/allcodex", {
            method: "POST",
            json: { url: "http://localhost:8080", token: "" },
        });

        expect(status).toBe(422);
        expect(upsertMock).not.toHaveBeenCalled();
    });

    it("rejects missing body fields with 422", async () => {
        const { status } = await requestJson(app, "/config/allcodex", {
            method: "POST",
            json: {},
        });

        expect(status).toBe(422);
        expect(upsertMock).not.toHaveBeenCalled();
    });
});

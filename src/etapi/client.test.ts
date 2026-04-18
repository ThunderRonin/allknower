import { beforeEach, describe, expect, it, mock, spyOn, type Mock } from "bun:test";

// Mock env before any import
mock.module("../env.ts", () => ({
    env: {
        ALLCODEX_URL: "http://localhost:8080",
        ALLCODEX_ETAPI_TOKEN: "test-etapi-token",
    },
}));

// Mock prisma — credential cache falls back to env when DB returns nothing
mock.module("../db/client.ts", () => ({
    default: {
        appConfig: {
            findUnique: async () => null,
        },
    },
}));

import {
    getAllCodexNotes,
    getNote,
    getNoteContent,
    createNote,
    updateNote,
    setNoteContent,
    createAttribute,
    setNoteTemplate,
    tagNote,
    createRelation,
    checkAllCodexHealth,
    invalidateCredentialCache,
} from "./client.ts";

// ── Fetch mock helpers ────────────────────────────────────────────────────────

type FetchSpy = Mock<typeof globalThis.fetch>;

function mockFetch(body: unknown, status = 200, contentType = "application/json"): FetchSpy {
    const responseText = contentType === "application/json" ? JSON.stringify(body) : String(body);
    // Use mockImplementation so each call gets a fresh Response (body can only be consumed once)
    const spy = spyOn(globalThis, "fetch").mockImplementation(async () =>
        new Response(responseText, {
            status,
            headers: { "Content-Type": contentType },
        })
    );
    return spy as FetchSpy;
}

function mockFetchError(message: string): FetchSpy {
    const spy = spyOn(globalThis, "fetch").mockRejectedValue(new Error(message));
    return spy as FetchSpy;
}

beforeEach(() => {
    invalidateCredentialCache();
});

// ── etapiFetch internals (tested via public API) ──────────────────────────────

describe("etapiFetch internals", () => {
    it("constructs URL as BASE_URL + /etapi + path", async () => {
        const spy = mockFetch({ results: [] });
        await getAllCodexNotes("test");
        const calledUrl = spy.mock.calls[0][0] as string;
        expect(calledUrl).toContain("http://localhost:8080/etapi");
        spy.mockRestore();
    });

    it("includes Authorization header with token", async () => {
        const spy = mockFetch({ results: [] });
        await getAllCodexNotes("test");
        const init = spy.mock.calls[0][1] as RequestInit;
        const authHeader = (init.headers as Record<string, string>)["Authorization"];
        expect(authHeader).toBe("test-etapi-token");
        spy.mockRestore();
    });

    it("throws Error with status text on non-ok response", async () => {
        const spy = mockFetch({ error: "Not found" }, 404);
        await expect(getNote("missing-note")).rejects.toThrow();
        spy.mockRestore();
    });

    it("error includes status code string", async () => {
        const spy = mockFetch({ error: "Not Found" }, 404);
        let errorMsg = "";
        try { await getNote("missing-note"); } catch (e: any) { errorMsg = e.message; }
        expect(errorMsg).toContain("404");
        spy.mockRestore();
    });
});

// ── getAllCodexNotes ──────────────────────────────────────────────────────────

describe("getAllCodexNotes", () => {
    it("calls GET /etapi/notes?search=<encoded>", async () => {
        const spy = mockFetch({ results: [] });
        await getAllCodexNotes("#lore");
        const url = spy.mock.calls[0][0] as string;
        expect(url).toContain("/etapi/notes?search=");
        expect(url).toContain(encodeURIComponent("#lore"));
        spy.mockRestore();
    });

    it("URL-encodes # as %23", async () => {
        const spy = mockFetch({ results: [] });
        await getAllCodexNotes("#statblock");
        const url = spy.mock.calls[0][0] as string;
        expect(url).toContain("%23statblock");
        spy.mockRestore();
    });

    it("returns results array from response", async () => {
        const spy = mockFetch({ results: [{ noteId: "note-1", title: "Aldric" }] });
        const result = await getAllCodexNotes("#lore");
        expect(result).toHaveLength(1);
        expect(result[0].noteId).toBe("note-1");
        spy.mockRestore();
    });

    it("returns empty array when results: []", async () => {
        const spy = mockFetch({ results: [] });
        const result = await getAllCodexNotes("#lore");
        expect(result).toEqual([]);
        spy.mockRestore();
    });

    it("throws on 401 response", async () => {
        const spy = mockFetch({ error: "Unauthorized" }, 401);
        await expect(getAllCodexNotes("#lore")).rejects.toThrow();
        spy.mockRestore();
    });

    it("throws on 500 response", async () => {
        const spy = mockFetch({ error: "Server Error" }, 500);
        await expect(getAllCodexNotes("#lore")).rejects.toThrow();
        spy.mockRestore();
    });
});

// ── getNote ───────────────────────────────────────────────────────────────────

describe("getNote", () => {
    it("calls GET /etapi/notes/:noteId", async () => {
        const spy = mockFetch({ noteId: "note-abc", title: "Aldric" });
        await getNote("note-abc");
        const url = spy.mock.calls[0][0] as string;
        expect(url).toContain("/etapi/notes/note-abc");
        spy.mockRestore();
    });

    it("returns parsed JSON response", async () => {
        const spy = mockFetch({ noteId: "note-abc", title: "Aldric" });
        const result = await getNote("note-abc");
        expect(result.noteId).toBe("note-abc");
        spy.mockRestore();
    });

    it("throws on 404", async () => {
        const spy = mockFetch({ error: "Not Found" }, 404);
        await expect(getNote("missing")).rejects.toThrow();
        spy.mockRestore();
    });
});

// ── getNoteContent ────────────────────────────────────────────────────────────

describe("getNoteContent", () => {
    it("calls GET /etapi/notes/:noteId/content", async () => {
        const spy = mockFetch("<p>Content</p>", 200, "text/html");
        await getNoteContent("note-abc");
        const url = spy.mock.calls[0][0] as string;
        expect(url).toContain("/etapi/notes/note-abc/content");
        spy.mockRestore();
    });

    it("returns response as text", async () => {
        const spy = mockFetch("<p>Content</p>", 200, "text/html");
        const result = await getNoteContent("note-abc");
        expect(result).toBe("<p>Content</p>");
        spy.mockRestore();
    });

    it("throws on 404", async () => {
        const spy = mockFetch("Not found", 404, "text/plain");
        await expect(getNoteContent("missing")).rejects.toThrow();
        spy.mockRestore();
    });
});

// ── createNote ────────────────────────────────────────────────────────────────

describe("createNote", () => {
    it("calls POST /etapi/create-note", async () => {
        const spy = mockFetch({ note: { noteId: "new-note" }, branch: {} });
        await createNote({ parentNoteId: "root", title: "Test", type: "text" });
        const url = spy.mock.calls[0][0] as string;
        const init = spy.mock.calls[0][1] as RequestInit;
        expect(url).toContain("/etapi/create-note");
        expect(init.method).toBe("POST");
        spy.mockRestore();
    });

    it("sends parentNoteId, title, type in body", async () => {
        const spy = mockFetch({ note: { noteId: "new-note" }, branch: {} });
        await createNote({ parentNoteId: "root", title: "Test", type: "text" });
        const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
        expect(body.parentNoteId).toBe("root");
        expect(body.title).toBe("Test");
        expect(body.type).toBe("text");
        spy.mockRestore();
    });

    it("sends optional noteId when provided", async () => {
        const spy = mockFetch({ note: { noteId: "custom-id" }, branch: {} });
        await createNote({ parentNoteId: "root", title: "Test", type: "text", noteId: "custom-id" });
        const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
        expect(body.noteId).toBe("custom-id");
        spy.mockRestore();
    });

    it("sends optional content when provided", async () => {
        const spy = mockFetch({ note: { noteId: "note-1" }, branch: {} });
        await createNote({ parentNoteId: "root", title: "T", type: "text", content: "<p>hello</p>" });
        const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
        expect(body.content).toBe("<p>hello</p>");
        spy.mockRestore();
    });

    it("returns { note, branch } from response", async () => {
        const spy = mockFetch({ note: { noteId: "n1" }, branch: { branchId: "b1" } });
        const result = await createNote({ parentNoteId: "root", title: "T", type: "text" });
        expect(result.note.noteId).toBe("n1");
        expect(result.branch.branchId).toBe("b1");
        spy.mockRestore();
    });

    it("throws on 400", async () => {
        const spy = mockFetch({ error: "Bad Request" }, 400);
        await expect(createNote({ parentNoteId: "root", title: "T", type: "text" })).rejects.toThrow();
        spy.mockRestore();
    });
});

// ── updateNote ────────────────────────────────────────────────────────────────

describe("updateNote", () => {
    it("calls PATCH /etapi/notes/:noteId", async () => {
        const spy = mockFetch({ noteId: "n1", title: "Updated" });
        await updateNote("n1", { title: "Updated" });
        const url = spy.mock.calls[0][0] as string;
        const init = spy.mock.calls[0][1] as RequestInit;
        expect(url).toContain("/etapi/notes/n1");
        expect(init.method).toBe("PATCH");
        spy.mockRestore();
    });

    it("sends provided fields in body", async () => {
        const spy = mockFetch({ noteId: "n1", title: "Updated" });
        await updateNote("n1", { title: "Updated" });
        const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
        expect(body.title).toBe("Updated");
        spy.mockRestore();
    });

    it("throws on 404", async () => {
        const spy = mockFetch({ error: "Not Found" }, 404);
        await expect(updateNote("missing", { title: "X" })).rejects.toThrow();
        spy.mockRestore();
    });
});

// ── setNoteContent ────────────────────────────────────────────────────────────

describe("setNoteContent", () => {
    it("calls PUT /etapi/notes/:noteId/content", async () => {
        const spy = mockFetch("", 204, "text/plain");
        await setNoteContent("n1", "<p>content</p>");
        const url = spy.mock.calls[0][0] as string;
        const init = spy.mock.calls[0][1] as RequestInit;
        expect(url).toContain("/etapi/notes/n1/content");
        expect(init.method).toBe("PUT");
        spy.mockRestore();
    });

    it("sends content string as body", async () => {
        const spy = mockFetch("", 204, "text/plain");
        await setNoteContent("n1", "<p>lore content</p>");
        const init = spy.mock.calls[0][1] as RequestInit;
        expect(init.body).toBe("<p>lore content</p>");
        spy.mockRestore();
    });

    it("throws on 404", async () => {
        const spy = mockFetch("not found", 404, "text/plain");
        await expect(setNoteContent("missing", "x")).rejects.toThrow();
        spy.mockRestore();
    });
});

// ── createAttribute ───────────────────────────────────────────────────────────

describe("createAttribute", () => {
    it("calls POST /etapi/attributes", async () => {
        const spy = mockFetch({ attributeId: "attr-1", noteId: "n1", type: "label", name: "lore", value: "" });
        await createAttribute({ noteId: "n1", type: "label", name: "lore" });
        const url = spy.mock.calls[0][0] as string;
        expect(url).toContain("/etapi/attributes");
        spy.mockRestore();
    });

    it("sends noteId, type, name in body", async () => {
        const spy = mockFetch({ attributeId: "attr-1" });
        await createAttribute({ noteId: "n1", type: "label", name: "lore", value: "true" });
        const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
        expect(body.noteId).toBe("n1");
        expect(body.type).toBe("label");
        expect(body.name).toBe("lore");
        spy.mockRestore();
    });

    it("throws on 400", async () => {
        const spy = mockFetch({ error: "Bad Request" }, 400);
        await expect(createAttribute({ noteId: "n1", type: "label", name: "x" })).rejects.toThrow();
        spy.mockRestore();
    });
});

// ── setNoteTemplate ───────────────────────────────────────────────────────────

describe("setNoteTemplate", () => {
    it('creates relation attribute with type="relation", name="template"', async () => {
        const spy = mockFetch({ attributeId: "attr-1" });
        await setNoteTemplate("note-1", "_template_character");
        const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
        expect(body.type).toBe("relation");
        expect(body.name).toBe("template");
        spy.mockRestore();
    });

    it("passes templateNoteId as value", async () => {
        const spy = mockFetch({ attributeId: "attr-1" });
        await setNoteTemplate("note-1", "_template_character");
        const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
        expect(body.value).toBe("_template_character");
        spy.mockRestore();
    });
});

// ── tagNote ───────────────────────────────────────────────────────────────────

describe("tagNote", () => {
    it('calls createAttribute with type="label"', async () => {
        const spy = mockFetch({ attributeId: "attr-1" });
        await tagNote("note-1", "lore");
        const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
        expect(body.type).toBe("label");
        spy.mockRestore();
    });

    it("passes noteId, labelName, value correctly", async () => {
        const spy = mockFetch({ attributeId: "attr-1" });
        await tagNote("note-1", "loreType", "character");
        const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
        expect(body.noteId).toBe("note-1");
        expect(body.name).toBe("loreType");
        expect(body.value).toBe("character");
        spy.mockRestore();
    });

    it('defaults value to "" when not provided', async () => {
        const spy = mockFetch({ attributeId: "attr-1" });
        await tagNote("note-1", "lore");
        const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
        expect(body.value).toBe("");
        spy.mockRestore();
    });
});

// ── createRelation ────────────────────────────────────────────────────────────

describe("createRelation", () => {
    it("creates forward relation with correct attribute name prefix", async () => {
        const spy = mockFetch({ attributeId: "attr-1" });
        await createRelation("source-1", "target-1", "ally", { bidirectional: false });
        const firstBody = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
        expect(firstBody.noteId).toBe("source-1");
        expect(firstBody.name).toMatch(/^rel/i);
        expect(firstBody.value).toBe("target-1");
        spy.mockRestore();
    });

    it('maps "ally" → attribute name containing "ally" (case-insensitive)', async () => {
        const spy = mockFetch({ attributeId: "attr-1" });
        await createRelation("s", "t", "ally", { bidirectional: false });
        const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
        expect(body.name.toLowerCase()).toContain("ally");
        spy.mockRestore();
    });

    it('maps "enemy" → attribute name containing "enemy"', async () => {
        const spy = mockFetch({ attributeId: "attr-1" });
        await createRelation("s", "t", "enemy", { bidirectional: false });
        const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
        expect(body.name.toLowerCase()).toContain("enemy");
        spy.mockRestore();
    });

    it("makes 2 calls bidirectional=true: forward + inverse", async () => {
        const spy = mockFetch({ attributeId: "attr-1" });
        spy.mockClear();
        await createRelation("source-1", "target-1", "ally");
        expect(spy.mock.calls.length).toBe(2);
        spy.mockRestore();
    });

    it("makes 1 call bidirectional=false, no description", async () => {
        const spy = mockFetch({ attributeId: "attr-1" });
        spy.mockClear();
        await createRelation("source-1", "target-1", "ally", { bidirectional: false });
        expect(spy.mock.calls.length).toBe(1);
        spy.mockRestore();
    });

    it("makes 2 calls bidirectional=false with description", async () => {
        const spy = mockFetch({ attributeId: "attr-1" });
        spy.mockClear();
        await createRelation("s", "t", "ally", { bidirectional: false, description: "Fought together" });
        expect(spy.mock.calls.length).toBe(2);
        spy.mockRestore();
    });

    it("makes 1 call bidirectional=false and no description", async () => {
        const spy = mockFetch({ attributeId: "attr-1" });
        spy.mockClear();
        await createRelation("s", "t", "ally", { bidirectional: false });
        expect(spy.mock.calls.length).toBe(1);
        spy.mockRestore();
    });
});

// ── checkAllCodexHealth ───────────────────────────────────────────────────────

describe("checkAllCodexHealth", () => {
    it("returns { ok: true } on success", async () => {
        const spy = mockFetch({ appVersion: "0.90.12" });
        const result = await checkAllCodexHealth();
        expect(result.ok).toBe(true);
        spy.mockRestore();
    });

    it("calls GET /etapi/app-info", async () => {
        const spy = mockFetch({ appVersion: "0.90.12" });
        await checkAllCodexHealth();
        const url = spy.mock.calls[0][0] as string;
        expect(url).toContain("/etapi/app-info");
        spy.mockRestore();
    });

    it("extracts appVersion from response", async () => {
        const spy = mockFetch({ appVersion: "1.2.3" });
        const result = await checkAllCodexHealth();
        expect(result.version).toBe("1.2.3");
        spy.mockRestore();
    });

    it("returns { ok: false, error } when fetch throws", async () => {
        const spy = mockFetchError("Connection refused");
        const result = await checkAllCodexHealth();
        expect(result.ok).toBe(false);
        expect(result.error).toBeDefined();
        spy.mockRestore();
    });

    it("returns { ok: false } on non-ok response", async () => {
        const spy = mockFetch({ error: "Unauthorized" }, 401);
        const result = await checkAllCodexHealth();
        expect(result.ok).toBe(false);
        spy.mockRestore();
    });

    it("never throws — always resolves to object", async () => {
        const spy = mockFetchError("Total failure");
        await expect(checkAllCodexHealth()).resolves.toMatchObject({ ok: false });
        spy.mockRestore();
    });
});

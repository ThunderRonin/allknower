/**
 * AllKnower→Core ETAPI contract tests.
 * Validates that AllKnower's etapi/client.ts functions correctly parse
 * real Core ETAPI response shapes via a mock HTTP server.
 */
import { mock } from "bun:test";

mock.module("../../src/env.ts", () => ({
    env: {
        ALLCODEX_URL: "http://localhost:18080",
        ALLCODEX_ETAPI_TOKEN: "test-token",
        DATABASE_URL: process.env.DATABASE_URL,
        NODE_ENV: "test",
    },
}));

mock.module("../../src/db/client.ts", () => ({
    default: {
        appConfig: {
            findUnique: mock(async () => null),
        },
    },
}));

import { describe, expect, it, afterAll, beforeAll } from "bun:test";
import { createMockEtapiServer } from "../helpers/etapi-fixtures.ts";

let mockServer: ReturnType<typeof createMockEtapiServer>;

beforeAll(() => {
    mockServer = createMockEtapiServer(18080);
});

afterAll(() => {
    mockServer.close();
});

const creds = { baseUrl: "http://localhost:18080", token: "test-token" };

describe("AllKnower→Core contract: probeAllCodex", () => {
    it("parses /etapi/app-info and returns { ok: true }", async () => {
        const { probeAllCodex } = await import("../../src/etapi/client.ts");
        const result = await probeAllCodex(creds);
        expect(result.ok).toBe(true);
    });
});

describe("AllKnower→Core contract: checkAllCodexHealth", () => {
    it("returns { ok: true, version } from app-info", async () => {
        const { checkAllCodexHealth } = await import("../../src/etapi/client.ts");
        const result = await checkAllCodexHealth(creds);
        expect(result.ok).toBe(true);
        expect(result.version).toBe("0.63.7-allcodex");
    });
});

describe("AllKnower→Core contract: getAllCodexNotes", () => {
    it("returns array with noteId, title, type from search response", async () => {
        const { getAllCodexNotes } = await import("../../src/etapi/client.ts");
        const notes = await getAllCodexNotes("#lore", creds);
        expect(Array.isArray(notes)).toBe(true);
        expect(notes.length).toBeGreaterThan(0);
        expect(notes[0].noteId).toBe("note-abc123");
        expect(notes[0].title).toBe("Aldric");
        expect(notes[0].type).toBe("text");
        expect(Array.isArray(notes[0].attributes)).toBe(true);
    });
});

describe("AllKnower→Core contract: getNote", () => {
    it("returns full note with attributes, dates, parent/child arrays", async () => {
        const { getNote } = await import("../../src/etapi/client.ts");
        const note = await getNote("note-abc123", creds);
        expect(note.noteId).toBe("note-abc123");
        expect(note.title).toBe("Aldric");
        expect(Array.isArray(note.attributes)).toBe(true);
        expect(note.attributes.length).toBeGreaterThan(0);
    });
});

describe("AllKnower→Core contract: getNoteContent", () => {
    it("returns HTML string from content endpoint", async () => {
        const { getNoteContent } = await import("../../src/etapi/client.ts");
        const content = await getNoteContent("note-abc123", creds);
        expect(typeof content).toBe("string");
        expect(content.length).toBeGreaterThan(0);
        expect(content).toContain("<p>");
        expect(content).toContain("Aldric");
    });
});

describe("AllKnower→Core contract: createNote", () => {
    it("returns { note: { noteId }, branch: { branchId } } from create-note", async () => {
        const { createNote } = await import("../../src/etapi/client.ts");
        const result = await createNote(
            { parentNoteId: "root", title: "Test", type: "text", content: "<p>Test</p>" },
            creds,
        );
        expect(result.note.noteId).toBe("note-new123");
        expect(result.branch.branchId).toBe("branch-new123");
    });
});

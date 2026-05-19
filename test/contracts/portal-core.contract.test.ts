/**
 * Portal→Core ETAPI contract tests.
 * Validates that recorded ETAPI fixture shapes match what Portal's
 * etapi-server.ts expects from Core responses.
 *
 * These are pure fixture-shape tests — no mock server, no app boot.
 */
import { describe, expect, it } from "bun:test";
import { ETAPI_FIXTURES } from "../helpers/etapi-fixtures.ts";
import { assertFieldsPresent } from "../helpers/contract-helpers.ts";

describe("Portal→Core contract: /etapi/app-info response shape", () => {
    it("has appVersion, dbVersion, syncVersion", () => {
        assertFieldsPresent(
            ETAPI_FIXTURES.appInfo,
            ["appVersion", "dbVersion", "syncVersion"],
            "app-info",
        );
    });
});

describe("Portal→Core contract: /etapi/notes?search= response shape", () => {
    it("has results array with noteId, title, type, attributes", () => {
        expect(Array.isArray(ETAPI_FIXTURES.noteSearch.results)).toBe(true);
        const note = ETAPI_FIXTURES.noteSearch.results[0];
        assertFieldsPresent(note, ["noteId", "title", "type", "attributes"], "search result note");
    });

    it("attribute shape: { attributeId, noteId, type, name, value }", () => {
        const attr = ETAPI_FIXTURES.noteSearch.results[0].attributes[0];
        assertFieldsPresent(
            attr,
            ["attributeId", "noteId", "type", "name", "value"],
            "search result attribute",
        );
    });
});

describe("Portal→Core contract: /etapi/notes/:id response shape", () => {
    it("has full note fields including dates and parent/child arrays", () => {
        assertFieldsPresent(
            ETAPI_FIXTURES.noteSingle,
            [
                "noteId", "title", "type", "mime",
                "parentNoteIds", "childNoteIds",
                "parentBranchIds", "childBranchIds",
                "attributes",
            ],
            "single note",
        );
    });

    it("has date fields", () => {
        assertFieldsPresent(
            ETAPI_FIXTURES.noteSingle,
            ["dateCreated", "dateModified", "utcDateCreated", "utcDateModified"],
            "note dates",
        );
    });
});

describe("Portal→Core contract: /etapi/notes/:id/content response", () => {
    it("returns non-empty HTML string", () => {
        expect(typeof ETAPI_FIXTURES.noteContent).toBe("string");
        expect(ETAPI_FIXTURES.noteContent.length).toBeGreaterThan(0);
        expect(ETAPI_FIXTURES.noteContent).toContain("<p>");
    });
});

describe("Portal→Core contract: /etapi/create-note response shape", () => {
    it("has note.noteId and branch.branchId", () => {
        expect(ETAPI_FIXTURES.createNote.note.noteId).toBeDefined();
        expect(ETAPI_FIXTURES.createNote.branch.branchId).toBeDefined();
    });

    it("note has title, type, mime, isProtected", () => {
        assertFieldsPresent(
            ETAPI_FIXTURES.createNote.note,
            ["noteId", "title", "type", "mime", "isProtected"],
            "created note",
        );
    });

    it("branch has parentNoteId, notePosition", () => {
        assertFieldsPresent(
            ETAPI_FIXTURES.createNote.branch,
            ["branchId", "noteId", "parentNoteId", "notePosition"],
            "created branch",
        );
    });
});

describe("Portal→Core contract: /etapi/attributes response shape", () => {
    it("has attributeId, noteId, type, name, value", () => {
        assertFieldsPresent(
            ETAPI_FIXTURES.attributes,
            ["attributeId", "noteId", "type", "name", "value"],
            "attribute",
        );
    });
});

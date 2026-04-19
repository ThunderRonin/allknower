import { mock } from "bun:test";

const mockCreateNote = mock(async (params: any) => ({
    note: { noteId: params.noteId ?? "generated-id", title: params.title },
    branch: {},
}));
const mockTagNote = mock(async () => {});
const mockCreateAttribute = mock(async () => ({ attributeId: "attr-1" }));

mock.module("../etapi/client.ts", () => ({
    createNote: mockCreateNote,
    tagNote: mockTagNote,
    createAttribute: mockCreateAttribute,
    getAllCodexNotes: mock(async () => []),
    getNoteContent: mock(async () => ""),
    setNoteTemplate: mock(async () => {}),
    setNoteContent: mock(async () => {}),
    updateNote: mock(async () => ({})),
    probeAllCodex: mock(async () => ({ ok: true })),
}));

mock.module("../db/client.ts", () => ({
    default: {
        ragIndexMeta: { upsert: mock(async () => ({})), findMany: mock(async () => []) },
    },
}));

import { beforeEach, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { setupRoute } from "./setup.ts";
import { requestJson } from "../../test/helpers/http.ts";
import { TEMPLATE_ID_MAP } from "../types/lore.ts";

const app = new Elysia().use(setupRoute);

beforeEach(() => {
    mockCreateNote.mockClear();
    mockTagNote.mockClear();
    mockCreateAttribute.mockClear();

    mockCreateNote.mockImplementation(async (params: any) => ({
        note: { noteId: params.noteId ?? "generated-id", title: params.title },
        branch: {},
    }));
    mockTagNote.mockResolvedValue(undefined);
    mockCreateAttribute.mockResolvedValue({ attributeId: "attr-1" });
});

describe("POST /setup/seed-templates", () => {
    it('creates container note "_lore_templates_container"', async () => {
        await requestJson(app, "/setup/seed-templates", { method: "POST" });
        const containerCall = mockCreateNote.mock.calls.find(
            (c) => (c[0] as any).noteId === "_lore_templates_container"
        );
        expect(containerCall).toBeDefined();
    });

    it('tags container with "loreTemplates"', async () => {
        await requestJson(app, "/setup/seed-templates", { method: "POST" });
        const tagCall = mockTagNote.mock.calls.find(
            (c) => (c as any[])[0] === "_lore_templates_container" && (c as any[])[1] === "loreTemplates"
        );
        expect(tagCall).toBeDefined();
    });

    it("creates one template note per entry in TEMPLATE_ID_MAP", async () => {
        await requestJson(app, "/setup/seed-templates", { method: "POST" });
        const templateCount = Object.keys(TEMPLATE_ID_MAP).length;
        // Container + N template notes
        expect(mockCreateNote.mock.calls.length).toBeGreaterThanOrEqual(templateCount);
    });

    it('tags each template note with "template"', async () => {
        await requestJson(app, "/setup/seed-templates", { method: "POST" });
        const templateTags = mockTagNote.mock.calls.filter(
            (c) => (c as any[])[1] === "template"
        );
        expect(templateTags.length).toBe(Object.keys(TEMPLATE_ID_MAP).length);
    });

    it("creates promoted attribute labels for each template field", async () => {
        await requestJson(app, "/setup/seed-templates", { method: "POST" });
        const promotedAttrCalls = mockCreateAttribute.mock.calls.filter(
            (c) => ((c as any[])[0] as any).name?.startsWith("label:")
        );
        expect(promotedAttrCalls.length).toBeGreaterThan(0);
    });

    it('promoted attribute format: name="label:FIELDNAME", value="promoted,TYPE"', async () => {
        await requestJson(app, "/setup/seed-templates", { method: "POST" });
        const charAttr = mockCreateAttribute.mock.calls.find(
            (c) => ((c as any[])[0] as any).name === "label:fullName"
        ) as any[] | undefined;
        expect(charAttr).toBeDefined();
        const attrParams = charAttr![0] as any;
        expect(attrParams.value).toMatch(/^promoted,/);
    });

    it("container already-exists error is swallowed (non-fatal)", async () => {
        mockCreateNote.mockImplementationOnce(async (params: any) => {
            if (params.noteId === "_lore_templates_container") {
                throw new Error("Note already exists");
            }
            return { note: { noteId: params.noteId ?? "x", title: params.title }, branch: {} };
        });
        const { status } = await requestJson(app, "/setup/seed-templates", { method: "POST" });
        expect(status).toBe(200);
    });

    it('template already-exists error is reported as "already_exists" (not "error")', async () => {
        mockCreateNote.mockImplementation(async (params: any) => {
            if (params.noteId !== "_lore_templates_container") {
                throw new Error("ETAPI 400: already exists");
            }
            return { note: { noteId: params.noteId, title: params.title }, branch: {} };
        });
        const { json } = await requestJson(app, "/setup/seed-templates", { method: "POST" });
        const body = json as any;
        const alreadyExists = body.results.filter((r: any) => r.status === "already_exists");
        expect(alreadyExists.length).toBeGreaterThan(0);
    });

    it("unexpected template error is reported as error with message", async () => {
        mockCreateNote.mockImplementation(async (params: any) => {
            if (params.noteId !== "_lore_templates_container") {
                throw new Error("Unexpected database failure");
            }
            return { note: { noteId: params.noteId, title: params.title }, branch: {} };
        });
        const { json } = await requestJson(app, "/setup/seed-templates", { method: "POST" });
        const body = json as any;
        // Errors not matching "already/exists/400" go to status="error"
        const errorResults = body.results.filter((r: any) => r.status === "error");
        expect(errorResults.length).toBeGreaterThan(0);
    });

    it("returns { summary, results }", async () => {
        const { status, json } = await requestJson(app, "/setup/seed-templates", { method: "POST" });
        expect(status).toBe(200);
        const body = json as any;
        expect(body.summary).toBeDefined();
        expect(Array.isArray(body.results)).toBe(true);
    });

    it("summary counts are accurate", async () => {
        const { json } = await requestJson(app, "/setup/seed-templates", { method: "POST" });
        const body = json as any;
        const created = body.results.filter((r: any) => r.status === "created").length;
        const exists = body.results.filter((r: any) => r.status === "already_exists").length;
        const failed = body.results.filter((r: any) => r.status === "error").length;
        expect(body.summary).toContain(String(created));
        expect(body.summary).toContain(String(exists));
        expect(body.summary).toContain(String(failed));
    });

    it("all 21 entity types in TEMPLATE_ID_MAP are present in results", async () => {
        const { json } = await requestJson(app, "/setup/seed-templates", { method: "POST" });
        const body = json as any;
        const types = body.results.map((r: any) => r.type);
        expect(types).toHaveLength(Object.keys(TEMPLATE_ID_MAP).length);
        for (const key of Object.keys(TEMPLATE_ID_MAP)) {
            expect(types).toContain(key);
        }
    });
});

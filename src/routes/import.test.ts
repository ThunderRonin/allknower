import { mock } from "bun:test";

let noteIdCounter = 0;
const mockCreateNote = mock(async (params: any) => ({
    note: { noteId: params.noteId ?? `note-${++noteIdCounter}`, title: params.title },
    branch: {},
}));
const mockSetNoteTemplate = mock(async () => {});
const mockTagNote = mock(async () => {});
const mockGetAllCodexNotes = mock(async () => [] as any[]);
const mockImportAzgaarMap = mock(async () => ({
    mapName: "TestMap",
    states: { created: [], skipped: [], errors: [] },
    burgs: { created: [], skipped: [], errors: [] },
    religions: { created: [], skipped: [], errors: [] },
    cultures: { created: [], skipped: [], errors: [] },
    notes: { created: [], skipped: [], errors: [] },
    totals: { created: 0, skipped: 0, errors: 0 },
}));

mock.module("../etapi/client.ts", () => ({
    createNote: mockCreateNote,
    setNoteTemplate: mockSetNoteTemplate,
    tagNote: mockTagNote,
    getAllCodexNotes: mockGetAllCodexNotes,
    getNoteContent: mock(async () => ""),
    createAttribute: mock(async () => ({ attributeId: "a" })),
    setNoteContent: mock(async () => {}),
    updateNote: mock(async () => ({})),
    probeAllCodex: mock(async () => ({ ok: true })),
}));

mock.module("../pipeline/azgaar.ts", () => ({
    importAzgaarMap: mockImportAzgaarMap,
    isAzgaarMapData: (obj: unknown) => {
        const o = obj as any;
        return o && typeof o === "object" && typeof o.pack === "object" && o.pack &&
            (Array.isArray(o.pack.burgs) || Array.isArray(o.pack.states) || Array.isArray(o.pack.religions));
    },
    getMapPreview: (map: any) => ({
        mapName: map.info?.mapName ?? "Unnamed",
        stateCnt: 0, burgCnt: 0, religionCnt: 0, cultureCnt: 0, noteCnt: 0,
    }),
}));

mock.module("../db/client.ts", () => ({
    default: { ragIndexMeta: { upsert: mock(async () => ({})), findMany: mock(async () => []) } },
}));

import { beforeEach, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { importRoute } from "./import.ts";
import { requestJson } from "../../test/helpers/http.ts";

const app = new Elysia().use(importRoute);

beforeEach(() => {
    noteIdCounter = 0;
    mockCreateNote.mockClear();
    mockSetNoteTemplate.mockClear();
    mockTagNote.mockClear();
    mockGetAllCodexNotes.mockClear();
    mockImportAzgaarMap.mockClear();

    mockCreateNote.mockImplementation(async (params: any) => ({
        note: { noteId: params.noteId ?? `note-${++noteIdCounter}`, title: params.title },
        branch: {},
    }));
    mockSetNoteTemplate.mockResolvedValue(undefined);
    mockTagNote.mockResolvedValue(undefined);
    mockGetAllCodexNotes.mockResolvedValue([]);
    mockImportAzgaarMap.mockResolvedValue({
        mapName: "TestMap",
        states: { created: [], skipped: [], errors: [] },
        burgs: { created: [], skipped: [], errors: [] },
        religions: { created: [], skipped: [], errors: [] },
        cultures: { created: [], skipped: [], errors: [] },
        notes: { created: [], skipped: [], errors: [] },
        totals: { created: 0, skipped: 0, errors: 0 },
    });
});

// ── POST /import/system-pack ──────────────────────────────────────────────────

describe("POST /import/system-pack", () => {
    it("rejects empty notes array with 400", async () => {
        const { status } = await requestJson(app, "/import/system-pack", {
            method: "POST",
            json: { notes: [] },
        });
        expect(status).toBe(400);
    });

    it("creates note for each valid entry", async () => {
        await requestJson(app, "/import/system-pack", {
            method: "POST",
            json: { notes: [{ name: "Goblin" }, { name: "Orc" }] },
        });
        expect(mockCreateNote.mock.calls.filter((c) => (c[0] as any).title)).toHaveLength(2);
    });

    it("applies _template_statblock template", async () => {
        await requestJson(app, "/import/system-pack", {
            method: "POST",
            json: { notes: [{ name: "Dragon" }] },
        });
        const call = mockSetNoteTemplate.mock.calls[0] as any[];
        expect(call[1]).toBe("_template_statblock");
    });

    it('tags with "statblock", "importSource=system-pack", "crName"', async () => {
        await requestJson(app, "/import/system-pack", {
            method: "POST",
            json: { notes: [{ name: "Troll" }] },
        });
        const tags = mockTagNote.mock.calls.map((c) => `${(c as any[])[1]}:${(c as any[])[2]}`);
        expect(tags).toContain("crName:Troll");
        expect(tags).toContain("statblock:");
        expect(tags).toContain("importSource:system-pack");
    });

    it("maps cr → challengeRating attribute", async () => {
        await requestJson(app, "/import/system-pack", {
            method: "POST",
            json: { notes: [{ name: "Zombie", cr: "1/4" }] },
        });
        const crTag = mockTagNote.mock.calls.find((c) => (c as any[])[1] === "challengeRating") as any[] | undefined;
        expect(crTag).toBeDefined();
        expect(crTag![2]).toBe("1/4");
    });

    it("skips null/empty attribute values", async () => {
        await requestJson(app, "/import/system-pack", {
            method: "POST",
            json: { notes: [{ name: "Skeleton", cr: null, ac: "" }] },
        });
        const crTag = mockTagNote.mock.calls.find((c) => (c as any[])[1] === "challengeRating");
        const acTag = mockTagNote.mock.calls.find((c) => (c as any[])[1] === "ac");
        expect(crTag).toBeUndefined();
        expect(acTag).toBeUndefined();
    });

    it("skipDuplicates=true: skips entries matching existing #statblock titles", async () => {
        mockGetAllCodexNotes.mockResolvedValue([
            { noteId: "n1", title: "Goblin", type: "text" },
        ]);
        const { json } = await requestJson(app, "/import/system-pack", {
            method: "POST",
            json: { notes: [{ name: "Goblin" }], skipDuplicates: true },
        });
        const body = json as any;
        expect(body.skipped).toBe(1);
        expect(body.created).toBe(0);
    });

    it("skipDuplicates=false: creates regardless of existing titles", async () => {
        mockGetAllCodexNotes.mockResolvedValue([
            { noteId: "n1", title: "Goblin", type: "text" },
        ]);
        const { json } = await requestJson(app, "/import/system-pack", {
            method: "POST",
            json: { notes: [{ name: "Goblin" }], skipDuplicates: false },
        });
        const body = json as any;
        expect(body.created).toBe(1);
        expect(body.skipped).toBe(0);
    });

    it("entry with missing name goes to errors (not created)", async () => {
        const { json } = await requestJson(app, "/import/system-pack", {
            method: "POST",
            json: { notes: [{ name: "" }] },
        });
        const body = json as any;
        expect(body.errors).toBeGreaterThanOrEqual(1);
        expect(body.created).toBe(0);
    });

    it("ETAPI error for one entry goes to errors, continues with rest", async () => {
        mockCreateNote
            .mockRejectedValueOnce(new Error("ETAPI error"))
            .mockResolvedValue({ note: { noteId: "n2", title: "Orc" }, branch: {} });
        const { json } = await requestJson(app, "/import/system-pack", {
            method: "POST",
            json: { notes: [{ name: "Goblin" }, { name: "Orc" }] },
        });
        const body = json as any;
        expect(body.errors).toBe(1);
        expect(body.created).toBe(1);
    });

    it("returns { created, skipped, errors, detail }", async () => {
        const { json } = await requestJson(app, "/import/system-pack", {
            method: "POST",
            json: { notes: [{ name: "Elemental" }] },
        });
        const body = json as any;
        expect(typeof body.created).toBe("number");
        expect(typeof body.skipped).toBe("number");
        expect(typeof body.errors).toBe("number");
        expect(body.detail).toBeDefined();
    });
});

// ── POST /import/azgaar/preview ───────────────────────────────────────────────

const validAzgaarData = { pack: { burgs: [], states: [{ i: 1, name: "Valorheim" }] } };

describe("POST /import/azgaar/preview", () => {
    it("returns 400 with INVALID_FORMAT when isAzgaarMapData returns false", async () => {
        const { status, json } = await requestJson(app, "/import/azgaar/preview", {
            method: "POST",
            json: { mapData: { not: "valid" } },
        });
        expect(status).toBe(400);
        expect((json as any).code).toBe("INVALID_FORMAT");
    });

    it("calls getMapPreview when valid", async () => {
        const { status } = await requestJson(app, "/import/azgaar/preview", {
            method: "POST",
            json: { mapData: validAzgaarData },
        });
        expect(status).toBe(200);
    });

    it("returns preview object directly", async () => {
        const { json } = await requestJson(app, "/import/azgaar/preview", {
            method: "POST",
            json: { mapData: { info: { mapName: "Valdoria" }, pack: { burgs: [] } } },
        });
        const body = json as any;
        expect(body.mapName).toBe("Valdoria");
    });
});

// ── GET /import/azgaar/preview ────────────────────────────────────────────────

describe("GET /import/azgaar/preview", () => {
    it("returns 400 when url param missing", async () => {
        const { status } = await requestJson(app, "/import/azgaar/preview");
        expect(status).toBe(400);
    });

    it("returns 501 NOT_IMPLEMENTED always", async () => {
        const { status, json } = await requestJson(app, "/import/azgaar/preview?url=http://example.com/map.json");
        expect(status).toBe(501);
        expect((json as any).code).toBe("NOT_IMPLEMENTED");
    });
});

// ── POST /import/azgaar ───────────────────────────────────────────────────────

describe("POST /import/azgaar", () => {
    it("returns 400 INVALID_FORMAT when mapData not valid Azgaar", async () => {
        const { status, json } = await requestJson(app, "/import/azgaar", {
            method: "POST",
            json: { mapData: { invalid: true } },
        });
        expect(status).toBe(400);
        expect((json as any).code).toBe("INVALID_FORMAT");
    });

    it("calls importAzgaarMap with mapData and options", async () => {
        await requestJson(app, "/import/azgaar", {
            method: "POST",
            json: { mapData: validAzgaarData },
        });
        expect(mockImportAzgaarMap).toHaveBeenCalledWith(
            validAzgaarData,
            expect.any(Object)
        );
    });

    it('passes parentNoteId defaulting to "root"', async () => {
        await requestJson(app, "/import/azgaar", {
            method: "POST",
            json: { mapData: validAzgaarData },
        });
        const opts = (mockImportAzgaarMap.mock.calls[0] as any[])[1];
        expect(opts.parentNoteId).toBe("root");
    });

    it("all import flags default to true", async () => {
        await requestJson(app, "/import/azgaar", {
            method: "POST",
            json: { mapData: validAzgaarData },
        });
        const opts = (mockImportAzgaarMap.mock.calls[0] as any[])[1];
        expect(opts.importStates).toBe(true);
        expect(opts.importBurgs).toBe(true);
        expect(opts.importReligions).toBe(true);
        expect(opts.importCultures).toBe(true);
        expect(opts.importNotes).toBe(true);
    });

    it("skipDuplicates defaults to true", async () => {
        await requestJson(app, "/import/azgaar", {
            method: "POST",
            json: { mapData: validAzgaarData },
        });
        const opts = (mockImportAzgaarMap.mock.calls[0] as any[])[1];
        expect(opts.skipDuplicates).toBe(true);
    });

    it("returns importAzgaarMap result on success", async () => {
        (mockImportAzgaarMap.mockResolvedValue as (v: any) => any)({
            mapName: "Valdoria",
            states: { created: [{ noteId: "n1", name: "Valorheim" }], skipped: [], errors: [] },
            burgs: { created: [], skipped: [], errors: [] },
            religions: { created: [], skipped: [], errors: [] },
            cultures: { created: [], skipped: [], errors: [] },
            notes: { created: [], skipped: [], errors: [] },
            totals: { created: 1, skipped: 0, errors: 0 },
        });
        const { json } = await requestJson(app, "/import/azgaar", {
            method: "POST",
            json: { mapData: validAzgaarData },
        });
        expect((json as any).mapName).toBe("Valdoria");
        expect((json as any).totals.created).toBe(1);
    });

    it("returns 500 IMPORT_ERROR when importAzgaarMap throws", async () => {
        mockImportAzgaarMap.mockRejectedValue(new Error("Unexpected parsing error"));
        const { status, json } = await requestJson(app, "/import/azgaar", {
            method: "POST",
            json: { mapData: validAzgaarData },
        });
        expect(status).toBe(500);
        expect((json as any).code).toBe("IMPORT_ERROR");
    });
});

import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import { requireAuthBypass } from "./helpers/auth.ts";
import { requestJson } from "./helpers/http.ts";

let autocompletePrefixResults = [
    { noteId: "prefix-1", noteTitle: "Aether Keep" },
    { noteId: "prefix-2", noteTitle: "Aether Ward" },
];
let autocompleteSemanticResults = [
    { noteId: "semantic-1", noteTitle: "Aether Archive", content: "Lore", distance: 0.02 },
];

async function buildBrainDumpPromptMock(
    rawText: string,
    ragContext: Array<{ noteTitle: string; content: string }>
) {
    const context = ragContext.length > 0
        ? ragContext.map((chunk) => `### ${chunk.noteTitle}\n${chunk.content}`).join("\n\n")
        : "No existing lore found";

    return {
        system: "You are the lore architect",
        context,
        user: rawText,
        admittedChunks: ragContext,
    };
}

mock.module("../src/plugins/auth-guard.ts", () => ({
    requireAuth: requireAuthBypass
}));

mock.module("../src/pipeline/relations.ts", () => ({
    suggestRelationsForNote: mock(async (_noteId: string, text: string) => {
        return [{
            targetNoteId: "note-ally",
            targetTitle: `Linked from ${text}`,
            relationshipType: "ally",
            description: "Shared oath",
        }];
    }),
    applyRelations: mock(async (sourceNoteId: string, relations: unknown[]) => ({
        ok: true,
        sourceNoteId,
        applied: relations.length,
    })),
}));

mock.module("../src/rag/lancedb.ts", () => ({
    checkLanceDbHealth: mock(async () => ({ ok: true })),
    queryLore: mock(async () => autocompleteSemanticResults)
}));

mock.module("../src/etapi/client.ts", () => ({
    checkAllCodexHealth: mock(async () => ({ ok: true })),
    createAttribute: mock(async () => ({})),
    createNote: mock(async () => ({ note: { noteId: "new-note-1" } })),
    createRelation: mock(async () => {}),
    getAllCodexNotes: mock(async () => [
        { noteId: "1", title: "Aria", attributes: [{ name: "loreType", value: "character", type: "label" }] },
        { noteId: "2", title: "Citadel", attributes: [{ name: "loreType", value: "location", type: "label" }] },
    ]),
    getNote: mock(async (noteId: string) => ({ noteId, title: "Mock Note", type: "text" })),
    getNoteContent: mock(async (noteId: string) => `<p>${noteId} content</p>`),
    setNoteContent: mock(async () => {}),
    setNoteTemplate: mock(async () => {}),
    tagNote: mock(async () => {}),
    updateNote: mock(async (noteId: string) => ({ noteId, title: "Mock Note", type: "text", mime: "text/html" })),
}));

mock.module("../src/pipeline/prompt.ts", () => ({
    buildBrainDumpPrompt: mock(buildBrainDumpPromptMock),
    callLLM: mock(async (_system: string, _user: string, task: string) => {
        if (task === "gap-detect") {
            return {
                raw: JSON.stringify({
                    gaps: [{ area: "Factions", severity: "medium", description: "Thin political coverage", suggestion: "Add a rival guild." }],
                    summary: "Needs more factions",
                })
            };
        }

        if (task === "brain-dump") {
            return {
                raw: JSON.stringify({
                    entities: [{ type: "character", title: "King Arthur", content: "A king.", attributes: {}, action: "create" }],
                    summary: "Extracted a character",
                }),
                tokensUsed: 100,
                model: "testing-model",
            };
        }

        return {
            raw: JSON.stringify({
                suggestions: [{ title: "Aether Keep" }],
            })
        };
    })
}));

mock.module("../src/db/client.ts", () => ({
    default: {
        ragIndexMeta: {
            findMany: mock(async ({ take }: { take: number }) => autocompletePrefixResults.slice(0, take)),
        },
    }
}));

const { suggestRoute } = await import("../src/routes/suggest.ts");

const app = new Elysia().use(suggestRoute);

describe("Suggest routes", () => {
    beforeEach(() => {
        autocompletePrefixResults = [
            { noteId: "prefix-1", noteTitle: "Aether Keep" },
            { noteId: "prefix-2", noteTitle: "Aether Ward" },
        ];
        autocompleteSemanticResults = [
            { noteId: "semantic-1", noteTitle: "Aether Archive", content: "Lore", distance: 0.02 },
        ];
    });

    it("POST /suggest/relationships returns suggestions", async () => {
        const { status, json } = await requestJson(app, "/suggest/relationships", {
            method: "POST",
            json: { text: "Aether oath" },
        });

        const body = json as { suggestions: Array<{ targetNoteId: string }> };
        expect(status).toBe(200);
        expect(Array.isArray(body.suggestions)).toBe(true);
        expect(body.suggestions[0].targetNoteId).toBe("note-ally");
    });

    it("GET /suggest/autocomplete accepts a single character query", async () => {
        const { status, json } = await requestJson(app, "/suggest/autocomplete?q=a");
        const body = json as { suggestions: Array<{ noteId: string; title: string }> };

        expect(status).toBe(200);
        expect(body.suggestions.length).toBeGreaterThan(0);
    });

    it("GET /suggest/autocomplete returns suggestions for a common lore word", async () => {
        const { status, json } = await requestJson(app, "/suggest/autocomplete?q=aether");
        const body = json as { suggestions: Array<{ title: string }> };

        expect(status).toBe(200);
        expect(body.suggestions.some((suggestion) => suggestion.title.includes("Aether"))).toBe(true);
    });

    it("GET /suggest/autocomplete handles special characters without crashing", async () => {
        const { status, json } = await requestJson(app, `/suggest/autocomplete?q=${encodeURIComponent("aether's gate")}`);
        const body = json as { suggestions: unknown[] };

        expect(status).toBe(200);
        expect(Array.isArray(body.suggestions)).toBe(true);
    });

    it("GET /suggest/autocomplete rejects an empty query", async () => {
        const { status } = await requestJson(app, "/suggest/autocomplete?q=");
        expect(status).toBe(422);
    });

    it("GET /suggest/autocomplete respects the limit query parameter", async () => {
        autocompletePrefixResults = [
            { noteId: "prefix-1", noteTitle: "Aether Keep" },
            { noteId: "prefix-2", noteTitle: "Aether Ward" },
            { noteId: "prefix-3", noteTitle: "Aether Court" },
            { noteId: "prefix-4", noteTitle: "Aether Basin" },
            { noteId: "prefix-5", noteTitle: "Aether Gate" },
            { noteId: "prefix-6", noteTitle: "Aether Watch" },
        ];
        autocompleteSemanticResults = [
            { noteId: "semantic-1", noteTitle: "Aether Archive", content: "Lore", distance: 0.02 },
            { noteId: "semantic-2", noteTitle: "Aether Chorus", content: "Lore", distance: 0.03 },
        ];

        const { status, json } = await requestJson(app, "/suggest/autocomplete?q=a&limit=5");
        const body = json as { suggestions: unknown[] };

        expect(status).toBe(200);
        expect(body.suggestions.length).toBeLessThanOrEqual(5);
    });

    it("GET /suggest/gaps returns gaps, type counts, and total notes", async () => {
        const { status, json } = await requestJson(app, "/suggest/gaps");
        const body = json as { gaps: unknown[]; typeCounts: Record<string, number>; totalNotes: number };

        expect(status).toBe(200);
        expect(Array.isArray(body.gaps)).toBe(true);
        expect(typeof body.typeCounts).toBe("object");
        expect(typeof body.totalNotes).toBe("number");
    }, 30000);

    it("POST /suggest/relationships/apply accepts a valid payload", async () => {
        const { status, json } = await requestJson(app, "/suggest/relationships/apply", {
            method: "POST",
            json: {
                sourceNoteId: "source-1",
                relations: [{
                    targetNoteId: "target-1",
                    relationshipType: "ally",
                    description: "Shared oath",
                }],
                bidirectional: true,
            },
        });

        expect(status).toBe(200);
        expect(json).toEqual({ ok: true, sourceNoteId: "source-1", applied: 1 });
    });

    it("POST /suggest/relationships/apply rejects an invalid payload", async () => {
        const { status } = await requestJson(app, "/suggest/relationships/apply", {
            method: "POST",
            json: {
                sourceNoteId: "source-1",
                relations: [{ relationshipType: "ally" }],
            },
        });

        expect(status).toBe(422);
    });
});
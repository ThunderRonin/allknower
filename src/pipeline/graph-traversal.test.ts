import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("../env.ts", () => ({
    env: {
        OPENROUTER_API_KEY: "test",
        LLM_TIMEOUT_MS: 5000,
        OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
        DATABASE_URL: "postgresql://test:test@localhost:5432/test",
        NODE_ENV: "test",
    },
}));

const mockGetNote = mock(async (noteId: string) => ({
    noteId,
    title: `Note ${noteId}`,
    type: "text",
    mime: "text/html",
    isProtected: false,
    dateCreated: "",
    dateModified: "",
    utcDateCreated: "",
    utcDateModified: "",
    parentNoteIds: [],
    childNoteIds: [],
    attributes: [] as Array<{
        attributeId: string;
        noteId: string;
        type: "label" | "relation";
        name: string;
        value: string;
        isInheritable: boolean;
    }>,
}));

mock.module("../etapi/client.ts", () => ({
    getNote: mockGetNote,
    getAllCodexNotes: mock(async () => []),
    getNoteContent: mock(async () => ""),
    createNote: mock(async () => ({ note: { noteId: "n" }, branch: {} })),
    updateNote: mock(async (id: string) => ({ noteId: id })),
    setNoteContent: mock(async () => {}),
    setNoteTemplate: mock(async () => {}),
    tagNote: mock(async () => {}),
    createAttribute: mock(async () => ({})),
    createRelation: mock(async () => {}),
    deleteNote: mock(async () => {}),
    checkAllCodexHealth: mock(async () => ({ ok: true })),
    probeAllCodex: mock(async () => ({ ok: true })),
    invalidateCredentialCache: mock(() => {}),
    getNoteRevisions: mock(async () => []),
    postNoteRevision: mock(async () => {}),
    getRevisionContent: mock(async () => ""),
}));

import { traverseRelationGraph } from "./graph-traversal.ts";

function makeNote(
    noteId: string,
    title: string,
    loreType: string,
    relations: Array<{ name: string; targetId: string }>
) {
    return {
        noteId,
        title,
        type: "text",
        mime: "text/html",
        isProtected: false,
        dateCreated: "",
        dateModified: "",
        utcDateCreated: "",
        utcDateModified: "",
        parentNoteIds: [],
        childNoteIds: [],
        attributes: [
            {
                attributeId: `attr-${noteId}-type`,
                noteId,
                type: "label" as const,
                name: "loreType",
                value: loreType,
                isInheritable: false,
            },
            ...relations.map((r, i) => ({
                attributeId: `attr-${noteId}-rel-${i}`,
                noteId,
                type: "relation" as const,
                name: r.name,
                value: r.targetId,
                isInheritable: false,
            })),
        ],
    };
}

describe("traverseRelationGraph", () => {
    beforeEach(() => {
        mockGetNote.mockClear();
    });

    it("returns single center node when no relations exist", async () => {
        mockGetNote.mockResolvedValue(makeNote("center", "Center Note", "character", []));

        const result = await traverseRelationGraph("center", { depth: 2 });

        expect(result.nodes).toHaveLength(1);
        expect(result.nodes[0]).toEqual({
            noteId: "center",
            title: "Center Note",
            loreType: "character",
            depth: 0,
        });
        expect(result.edges).toHaveLength(0);
        expect(result.centerNoteId).toBe("center");
        expect(result.truncated).toBe(false);
    });

    it("traverses 1-hop relations", async () => {
        mockGetNote.mockImplementation(async (noteId: string) => {
            if (noteId === "A") return makeNote("A", "King Aldric", "character", [
                { name: "relAlly", targetId: "B" },
                { name: "relLocatedIn", targetId: "C" },
            ]);
            if (noteId === "B") return makeNote("B", "Queen Sera", "character", []);
            if (noteId === "C") return makeNote("C", "Ironhold", "location", []);
            throw new Error(`Unknown note: ${noteId}`);
        });

        const result = await traverseRelationGraph("A", { depth: 1 });

        expect(result.nodes).toHaveLength(3);
        expect(result.edges).toHaveLength(2);

        const center = result.nodes.find((n) => n.noteId === "A");
        expect(center?.depth).toBe(0);

        const ally = result.nodes.find((n) => n.noteId === "B");
        expect(ally?.depth).toBe(1);
        expect(ally?.title).toBe("Queen Sera");

        const loc = result.nodes.find((n) => n.noteId === "C");
        expect(loc?.depth).toBe(1);
        expect(loc?.loreType).toBe("location");

        expect(result.edges).toContainEqual({
            sourceNoteId: "A",
            targetNoteId: "B",
            relationshipType: "ally",
        });
        expect(result.edges).toContainEqual({
            sourceNoteId: "A",
            targetNoteId: "C",
            relationshipType: "located_in",
        });
    });

    it("traverses 2 hops deep", async () => {
        mockGetNote.mockImplementation(async (noteId: string) => {
            if (noteId === "A") return makeNote("A", "King Aldric", "character", [
                { name: "relAlly", targetId: "B" },
            ]);
            if (noteId === "B") return makeNote("B", "Queen Sera", "character", [
                { name: "relFamily", targetId: "D" },
            ]);
            if (noteId === "D") return makeNote("D", "Prince Kael", "character", []);
            throw new Error(`Unknown note: ${noteId}`);
        });

        const result = await traverseRelationGraph("A", { depth: 2 });

        expect(result.nodes).toHaveLength(3);
        expect(result.nodes.find((n) => n.noteId === "D")?.depth).toBe(2);
        expect(result.edges).toHaveLength(2);
        expect(result.maxDepthReached).toBe(2);
    });

    it("deduplicates nodes visited from multiple paths", async () => {
        mockGetNote.mockImplementation(async (noteId: string) => {
            if (noteId === "A") return makeNote("A", "A", "character", [
                { name: "relAlly", targetId: "B" },
                { name: "relEnemy", targetId: "C" },
            ]);
            if (noteId === "B") return makeNote("B", "B", "character", [
                { name: "relRival", targetId: "C" },
            ]);
            if (noteId === "C") return makeNote("C", "C", "character", []);
            throw new Error(`Unknown note: ${noteId}`);
        });

        const result = await traverseRelationGraph("A", { depth: 2 });

        const cNodes = result.nodes.filter((n) => n.noteId === "C");
        expect(cNodes).toHaveLength(1);
        expect(cNodes[0].depth).toBe(1);
    });

    it("respects maxNodes limit and sets truncated flag", async () => {
        const allies = Array.from({ length: 10 }, (_, i) => ({
            name: "relAlly",
            targetId: `ally-${i}`,
        }));
        mockGetNote.mockImplementation(async (noteId: string) => {
            if (noteId === "A") return makeNote("A", "A", "character", allies);
            return makeNote(noteId, noteId, "character", []);
        });

        const result = await traverseRelationGraph("A", { depth: 1, maxNodes: 5 });

        expect(result.nodes.length).toBeLessThanOrEqual(5);
        expect(result.truncated).toBe(true);
    });

    it("skips unknown relation attribute names", async () => {
        mockGetNote.mockResolvedValue(
            makeNote("A", "A", "character", [
                { name: "relAlly", targetId: "B" },
                { name: "template", targetId: "T" },
                { name: "customRelation", targetId: "X" },
            ])
        );

        const result = await traverseRelationGraph("A", { depth: 1 });

        expect(result.edges).toHaveLength(1);
        expect(result.edges[0].relationshipType).toBe("ally");
    });

    it("handles ETAPI errors gracefully (skips failed notes)", async () => {
        mockGetNote.mockImplementation(async (noteId: string) => {
            if (noteId === "A") return makeNote("A", "A", "character", [
                { name: "relAlly", targetId: "B" },
                { name: "relEnemy", targetId: "C" },
            ]);
            if (noteId === "B") throw new Error("ETAPI error");
            if (noteId === "C") return makeNote("C", "C", "character", []);
            throw new Error(`Unknown note: ${noteId}`);
        });

        const result = await traverseRelationGraph("A", { depth: 1 });

        expect(result.nodes).toHaveLength(2);
        expect(result.nodes.map((n) => n.noteId).sort((a, b) => a.localeCompare(b))).toEqual(["A", "C"]);
        expect(result.edges).toHaveLength(2);
    });

    it("caps depth at 3 even if higher value requested", async () => {
        mockGetNote.mockResolvedValue(makeNote("A", "A", "character", []));

        const result = await traverseRelationGraph("A", { depth: 10 });

        expect(result.maxDepthReached).toBeLessThanOrEqual(3);
    });

    it("avoids duplicate edges between same nodes with same type", async () => {
        mockGetNote.mockImplementation(async (noteId: string) => {
            if (noteId === "A") return makeNote("A", "A", "character", [
                { name: "relAlly", targetId: "B" },
            ]);
            if (noteId === "B") return makeNote("B", "B", "character", [
                { name: "relAlly", targetId: "A" },
            ]);
            throw new Error(`Unknown note: ${noteId}`);
        });

        const result = await traverseRelationGraph("A", { depth: 2 });

        const allyEdges = result.edges.filter((e) => e.relationshipType === "ally");
        expect(allyEdges).toHaveLength(1);
    });
});

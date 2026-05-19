import appInfoFixture from "../fixtures/etapi-responses/app-info.json";
import noteSearchFixture from "../fixtures/etapi-responses/note-search.json";
import noteSingleFixture from "../fixtures/etapi-responses/note-single.json";
import createNoteFixture from "../fixtures/etapi-responses/create-note.json";
import attributesFixture from "../fixtures/etapi-responses/attributes.json";

export const ETAPI_FIXTURES = {
    appInfo: appInfoFixture,
    noteSearch: noteSearchFixture,
    noteSingle: noteSingleFixture,
    noteContent: "<p>Aldric is the king of Valorheim. He wields the legendary sword Dawnbreaker.</p>",
    createNote: createNoteFixture,
    attributes: attributesFixture,
};

function handleEtapiRequest(path: string, method: string, url: URL): Response {
    if (path === "/etapi/app-info") return Response.json(ETAPI_FIXTURES.appInfo);
    if (path === "/etapi/notes" && url.searchParams.has("search")) return Response.json(ETAPI_FIXTURES.noteSearch);
    if (/^\/etapi\/notes\/[^/]+\/content$/.test(path) && method === "PUT") return new Response(null, { status: 204 });
    if (/^\/etapi\/notes\/[^/]+\/content$/.test(path)) return new Response(ETAPI_FIXTURES.noteContent, { headers: { "Content-Type": "text/html" } });
    if (/^\/etapi\/notes\/[^/]+$/.test(path) && method === "GET") return Response.json(ETAPI_FIXTURES.noteSingle);
    if (path === "/etapi/create-note" && method === "POST") return Response.json(ETAPI_FIXTURES.createNote);
    if (path === "/etapi/attributes" && method === "POST") return Response.json(ETAPI_FIXTURES.attributes);
    if (/^\/etapi\/notes\/[^/]+$/.test(path) && method === "DELETE") return new Response(null, { status: 204 });
    if (/^\/etapi\/notes\/[^/]+$/.test(path) && method === "PATCH") return Response.json(ETAPI_FIXTURES.noteSingle);
    return new Response("Not Found", { status: 404 });
}

export function createMockEtapiServer(port = 18080): { server: ReturnType<typeof Bun.serve>; close: () => void } {
    const server = Bun.serve({
        port,
        fetch(req) {
            const url = new URL(req.url);
            return handleEtapiRequest(url.pathname, req.method, url);
        },
    });
    return { server, close: () => server.stop() };
}

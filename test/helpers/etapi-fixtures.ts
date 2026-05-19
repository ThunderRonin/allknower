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

export function createMockEtapiServer(port = 18080): { server: ReturnType<typeof Bun.serve>; close: () => void } {
    const server = Bun.serve({
        port,
        fetch(req) {
            const url = new URL(req.url);
            const path = url.pathname;

            if (path === "/etapi/app-info") {
                return Response.json(ETAPI_FIXTURES.appInfo);
            }
            if (path === "/etapi/notes" && url.searchParams.has("search")) {
                return Response.json(ETAPI_FIXTURES.noteSearch);
            }
            if (path.match(/^\/etapi\/notes\/[^/]+\/content$/)) {
                return new Response(ETAPI_FIXTURES.noteContent, {
                    headers: { "Content-Type": "text/html" },
                });
            }
            if (path.match(/^\/etapi\/notes\/[^/]+$/) && req.method === "GET") {
                return Response.json(ETAPI_FIXTURES.noteSingle);
            }
            if (path === "/etapi/create-note" && req.method === "POST") {
                return Response.json(ETAPI_FIXTURES.createNote);
            }
            if (path === "/etapi/attributes" && req.method === "POST") {
                return Response.json(ETAPI_FIXTURES.attributes);
            }
            if (path.match(/^\/etapi\/notes\/[^/]+$/) && req.method === "DELETE") {
                return new Response(null, { status: 204 });
            }
            if (path.match(/^\/etapi\/notes\/[^/]+$/) && req.method === "PATCH") {
                return Response.json(ETAPI_FIXTURES.noteSingle);
            }
            if (path.match(/^\/etapi\/notes\/[^/]+\/content$/) && req.method === "PUT") {
                return new Response(null, { status: 204 });
            }

            return new Response("Not Found", { status: 404 });
        },
    });
    return { server, close: () => server.stop() };
}

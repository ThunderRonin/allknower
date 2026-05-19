// perf/mock-openrouter/server.ts

const MOCK_RESPONSES: Record<string, string> = {
    default: JSON.stringify({
        entities: [
            { type: "character", title: "Aldric", content: "<p>King of Valorheim.</p>", action: "create" },
        ],
        summary: "Extracted Aldric.",
    }),
    compact: JSON.stringify({
        intent: "Building kingdom lore",
        loreTypesInPlay: ["character", "location"],
        noteIdsModified: ["note-1"],
        skippedEntities: [],
        rawInputsSummary: "User described Aldric.",
        unresolvedGaps: [],
        currentFocus: "Aldric",
        lastCompactedAt: new Date().toISOString(),
        totalTokensConsumed: 85000,
        schemaVersion: 1,
    }),
    copilot: JSON.stringify({
        reply: "Aldric is a compelling character. Consider adding his lineage.",
        proposal: null,
        citations: [],
    }),
    consistency: JSON.stringify({
        issues: [{ noteId: "note-1", noteTitle: "Aldric", issue: "Missing birth year", severity: "low", suggestion: "Add it" }],
    }),
    gaps: JSON.stringify({
        areas: [{ category: "character", gap: "No antagonist", suggestion: "Create one" }],
    }),
    relations: JSON.stringify({
        suggestions: [{ sourceNoteId: "note-1", targetNoteId: "note-2", type: "rulerOf", name: "rules", description: "Rules Valorheim", confidence: 0.9 }],
    }),
};

function detectTask(body: any): string {
    const messages = body?.messages ?? [];
    const lastMsg = messages[messages.length - 1]?.content ?? "";
    if (lastMsg.includes("compact") || lastMsg.includes("archivist")) return "compact";
    if (lastMsg.includes("copilot") || lastMsg.includes("article")) return "copilot";
    if (lastMsg.includes("consistency")) return "consistency";
    if (lastMsg.includes("gap")) return "gaps";
    if (lastMsg.includes("relation")) return "relations";
    return "default";
}

const server = Bun.serve({
    port: parseInt(process.env.MOCK_PORT ?? "19001"),
    async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/api/v1/chat/completions") {
            const body = await req.json().catch(() => ({}));
            const task = detectTask(body);
            const content = MOCK_RESPONSES[task] ?? MOCK_RESPONSES.default;

            await new Promise((r) => setTimeout(r, 5));

            return Response.json({
                id: `chatcmpl-perf-${Date.now()}`,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: body.model ?? "test-model",
                choices: [{
                    index: 0,
                    message: { role: "assistant", content },
                    finish_reason: "stop",
                }],
                usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
            });
        }

        if (url.pathname === "/api/v1/models") {
            return Response.json({ data: [{ id: "test-model", name: "Test Model" }] });
        }

        return new Response("Not Found", { status: 404 });
    },
});

console.log(`Mock OpenRouter running on :${server.port}`);

import Elysia, { t } from "elysia";
import { getAllCodexNotes, getNoteContent } from "../etapi/client.ts";
import { callLLM } from "../pipeline/prompt.ts";
import { requireAuth } from "../plugins/auth-guard.ts";
import { CONSISTENCY_SYSTEM } from "../pipeline/prompts/consistency.ts";
import { CONSISTENCY_JSON_SCHEMA } from "../pipeline/schemas/llm-response-schemas.ts";
import { ConsistencyResponseSchema } from "../pipeline/schemas/response-schemas.ts";
import { rootLogger } from "../logger.ts";

export const consistencyRoute = new Elysia({ prefix: "/consistency" })
    .use(requireAuth)
    .post(
    "/check",
    async ({ body }) => {
        const search = body.noteIds?.length
            ? body.noteIds.map((id) => `#noteId=${id}`).join(" OR ")
            : "#lore";

        const notes = await getAllCodexNotes(search);

        if (notes.length === 0) {
            return { issues: [], summary: "No lore notes found to check." };
        }

        const loreSummaries = await Promise.all(
            notes.slice(0, 30).map(async (note) => {
                const content = await getNoteContent(note.noteId).catch(() => "");
                const plain = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
                return `## ${note.title} (${note.noteId})\n${plain}`;
            })
        );

        const context = `## Lore Entries\n\n${loreSummaries.join("\n\n")}`;
        const user = `Check these lore entries for consistency issues.`;

        const { raw } = await callLLM(CONSISTENCY_SYSTEM, user, "consistency", context, {
            jsonSchema: CONSISTENCY_JSON_SCHEMA,
        });

        let result: unknown;
        try {
            const parsed = JSON.parse(raw);
            const validated = ConsistencyResponseSchema.safeParse(parsed);
            if (validated.success) {
                result = validated.data;
            } else {
                rootLogger.warn("Consistency response failed validation", {
                    errors: validated.error.issues,
                });
                result = { issues: [], summary: "LLM response failed validation." };
            }
        } catch {
            result = { issues: [], summary: "Failed to parse consistency check response." };
        }

        return result;
    },
    {
        body: t.Object({
            noteIds: t.Optional(
                t.Array(t.String(), { description: "Specific note IDs to check. Omit to check all lore." })
            ),
        }),
        detail: {
            summary: "Run consistency check",
            description:
                "Scans lore entries for contradictions, timeline conflicts, orphaned references, and naming inconsistencies.",
            tags: ["Intelligence"],
        },
    }
);

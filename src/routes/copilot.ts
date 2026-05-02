import Elysia, { t } from "elysia";
import { rateLimit } from "elysia-rate-limit";
import { requireAuth } from "../plugins/auth-guard.ts";
import { env } from "../env.ts";
import { ArticleCopilotRequestSchema } from "../types/copilot.ts";
import { runArticleCopilotTurn } from "../pipeline/article-copilot.ts";

const ChatMessageBody = t.Object({
    role: t.Union([t.Literal("user"), t.Literal("assistant")]),
    content: t.String({ minLength: 1 }),
});

const CopilotNoteContextBody = t.Object({
    noteId: t.String(),
    title: t.String(),
    loreType: t.String(),
    contentHtml: t.String(),
    parentNoteIds: t.Array(t.String()),
    labels: t.Array(t.Object({
        name: t.String(),
        value: t.String(),
    })),
    relations: t.Array(t.Object({
        name: t.String(),
        targetNoteId: t.String(),
        description: t.Optional(t.String()),
    })),
});

const CopilotRagChunkBody = t.Object({
    noteId: t.String(),
    title: t.String(),
    excerpt: t.String(),
    score: t.Number(),
});

export const copilotRoute = new Elysia({ prefix: "/copilot" })
    .use(requireAuth)
    .use(
        rateLimit({
            max: env.AI_RATE_LIMIT_MAX,
            duration: env.AI_RATE_LIMIT_WINDOW_MS,
            errorResponse: new Response(
                JSON.stringify({
                    error: "Rate limit exceeded for AI tools.",
                    code: "RATE_LIMITED",
                }),
                { status: 429, headers: { "Content-Type": "application/json" } }
            ),
        })
    )
    .post(
        "/article",
        async ({ body }) => {
            const parsed = ArticleCopilotRequestSchema.parse(body);
            return runArticleCopilotTurn(parsed);
        },
        {
            body: t.Object({
                noteId: t.String(),
                transcript: t.Array(ChatMessageBody),
                currentNote: CopilotNoteContextBody,
                linkedNotes: t.Array(CopilotNoteContextBody),
                ragContext: t.Array(CopilotRagChunkBody),
                writableTargetIds: t.Array(t.String()),
            }),
            detail: {
                summary: "Article-scoped lore copilot",
                description:
                    "Generates discussion replies and reviewable proposals scoped to the current lore article and its direct writable neighbors.",
                tags: ["Intelligence"],
            },
        }
    );

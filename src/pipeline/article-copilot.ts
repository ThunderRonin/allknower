import { callWithFallback } from "./model-router.ts";
import { ARTICLE_COPILOT_SYSTEM } from "./prompts/article-copilot.ts";
import {
    ArticleCopilotRequestSchema,
    ArticleCopilotResponseSchema,
    type ArticleCopilotRequest,
    type ArticleCopilotResponse,
    type CopilotProposalTarget,
} from "../types/copilot.ts";

const ARTICLE_COPILOT_JSON_SCHEMA = {
    name: "article_copilot_response",
    schema: {
        type: "object",
        properties: {
            assistantMessage: { type: "string" },
            citations: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        noteId: { type: "string" },
                        title: { type: "string" },
                        source: { type: "string", enum: ["current", "linked", "rag"] },
                    },
                    required: ["noteId", "title", "source"],
                    additionalProperties: false,
                },
            },
            proposal: {
                anyOf: [
                    { type: "null" },
                    {
                        type: "object",
                        properties: {
                            targets: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        kind: { type: "string", enum: ["update", "create"] },
                                        targetId: { type: "string" },
                                        title: { type: "string" },
                                        loreType: { type: "string" },
                                        contentHtml: { type: "string" },
                                        labelUpserts: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    name: { type: "string" },
                                                    value: { type: "string" },
                                                },
                                                required: ["name", "value"],
                                                additionalProperties: false,
                                            },
                                        },
                                        labelDeletes: { type: "array", items: { type: "string" } },
                                        relationAdds: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    relationshipType: {
                                                        type: "string",
                                                        enum: ["ally", "enemy", "rival", "family", "member_of", "leader_of", "serves", "located_in", "originates_from", "participated_in", "caused", "created", "owns", "wields", "worships", "inhabits", "related_to"],
                                                    },
                                                    targetId: { type: "string" },
                                                    targetKind: { type: "string", enum: ["existing", "new"] },
                                                    description: { type: "string" },
                                                    bidirectional: { type: "boolean" },
                                                },
                                                required: ["relationshipType", "targetId", "targetKind"],
                                                additionalProperties: false,
                                            },
                                        },
                                        relationDeletes: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    relationshipType: {
                                                        type: "string",
                                                        enum: ["ally", "enemy", "rival", "family", "member_of", "leader_of", "serves", "located_in", "originates_from", "participated_in", "caused", "created", "owns", "wields", "worships", "inhabits", "related_to"],
                                                    },
                                                    targetId: { type: "string" },
                                                },
                                                required: ["relationshipType", "targetId"],
                                                additionalProperties: false,
                                            },
                                        },
                                        rationale: { type: "string" },
                                    },
                                    required: ["kind", "targetId", "contentHtml", "labelUpserts", "labelDeletes", "relationAdds", "relationDeletes", "rationale"],
                                    additionalProperties: false,
                                },
                            },
                        },
                        required: ["targets"],
                        additionalProperties: false,
                    },
                ],
            },
        },
        required: ["assistantMessage", "citations", "proposal"],
        additionalProperties: false,
    },
};

function buildContext(input: ArticleCopilotRequest): string {
    const current = [
        `## Current Note`,
        `ID: ${input.currentNote.noteId}`,
        `Title: ${input.currentNote.title}`,
        `Lore Type: ${input.currentNote.loreType}`,
        `Content:\n${input.currentNote.contentHtml}`,
    ].join("\n");

    const linked = input.linkedNotes.length > 0
        ? input.linkedNotes.map((note) => `### ${note.title} (${note.noteId})\nType: ${note.loreType}\n${note.contentHtml}`).join("\n\n")
        : "None";

    const rag = input.ragContext.length > 0
        ? input.ragContext.map((chunk) => `### ${chunk.title} (${chunk.noteId})\n${chunk.excerpt}`).join("\n\n")
        : "None";

    return [
        `Writable target IDs: ${input.writableTargetIds.join(", ")}`,
        current,
        `## Linked Writable Notes\n${linked}`,
        `## Read-Only RAG Context\n${rag}`,
    ].join("\n\n");
}

function validateTargetScope(target: CopilotProposalTarget, input: ArticleCopilotRequest, createTargetIds: Set<string>) {
    const writableSet = new Set(input.writableTargetIds);
    if (target.kind === "update" && !writableSet.has(target.targetId)) {
        throw new Error(`Proposal target ${target.targetId} is outside the writable scope.`);
    }

    if (target.kind === "create") {
        const linksBack = target.relationAdds.some(
            (relation) => relation.targetKind === "existing" && relation.targetId === input.noteId,
        );
        if (!linksBack) {
            throw new Error(`Create target ${target.targetId} must link directly to the current article.`);
        }
    }

    for (const relation of target.relationAdds) {
        if (relation.targetKind === "existing" && !writableSet.has(relation.targetId)) {
            throw new Error(`Relation target ${relation.targetId} is outside the writable scope.`);
        }
        if (relation.targetKind === "new" && !createTargetIds.has(relation.targetId)) {
            throw new Error(`Relation target ${relation.targetId} does not exist in the proposal.`);
        }
    }
}

function validateProposalScope(response: ArticleCopilotResponse, input: ArticleCopilotRequest): ArticleCopilotResponse {
    if (!response.proposal) return response;

    const createTargetIds = new Set(
        response.proposal.targets
            .filter((target) => target.kind === "create")
            .map((target) => target.targetId),
    );

    for (const target of response.proposal.targets) {
        validateTargetScope(target, input, createTargetIds);
    }

    return response;
}

export async function runArticleCopilotTurn(rawInput: ArticleCopilotRequest): Promise<ArticleCopilotResponse> {
    const input = ArticleCopilotRequestSchema.parse(rawInput);
    const context = buildContext(input);
    const transcript = input.transcript.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
    const user = `Continue the article-scoped copilot conversation.\n\n${transcript}`;

    const result = await callWithFallback("article-copilot", [
        { role: "system", content: ARTICLE_COPILOT_SYSTEM },
        { role: "user", content: context },
        { role: "user", content: user },
    ], {
        temperature: 0.2,
        maxTokens: 12000,
        responseFormat: {
            type: "json_schema",
            jsonSchema: {
                name: ARTICLE_COPILOT_JSON_SCHEMA.name,
                schema: ARTICLE_COPILOT_JSON_SCHEMA.schema as Record<string, unknown>,
                strict: true,
            },
        },
    });

    let parsed: unknown;
    try {
        parsed = JSON.parse(result.raw);
    } catch {
        throw new Error("Article copilot returned invalid JSON.");
    }

    const response = ArticleCopilotResponseSchema.parse(parsed);
    return validateProposalScope(response, input);
}

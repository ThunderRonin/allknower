/**
 * JSON Schema objects for OpenRouter structured output (json_schema mode).
 *
 * These are plain JSON Schema objects (not Zod) — they are passed directly
 * to the OpenRouter API's `responseFormat.jsonSchema.schema` field.
 *
 * See: https://openrouter.ai/docs/features/structured-outputs
 */

export const BRAIN_DUMP_JSON_SCHEMA = {
    name: "brain_dump_response",
    schema: {
        type: "object",
        properties: {
            entities: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        type: {
                            type: "string",
                            enum: ["character", "location", "faction", "creature", "event", "timeline", "manuscript", "statblock"],
                        },
                        title: { type: "string" },
                        content: { type: "string" },
                        tags: { type: "array", items: { type: "string" } },
                        attributes: { type: "object" },
                        action: { type: "string", enum: ["create", "update"] },
                        existingNoteId: { type: "string" },
                    },
                    required: ["type", "title", "action"],
                },
            },
            summary: { type: "string" },
        },
        required: ["entities", "summary"],
        additionalProperties: false,
    },
};

export const CONSISTENCY_JSON_SCHEMA = {
    name: "consistency_response",
    schema: {
        type: "object",
        properties: {
            issues: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        type: { type: "string", enum: ["contradiction", "timeline", "orphan", "naming"] },
                        severity: { type: "string", enum: ["high", "medium", "low"] },
                        description: { type: "string" },
                        affectedNoteIds: { type: "array", items: { type: "string" } },
                    },
                    required: ["type", "severity", "description", "affectedNoteIds"],
                    additionalProperties: false,
                },
            },
            summary: { type: "string" },
        },
        required: ["issues", "summary"],
        additionalProperties: false,
    },
};

export const GAP_DETECT_JSON_SCHEMA = {
    name: "gap_detect_response",
    schema: {
        type: "object",
        properties: {
            gaps: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        area: { type: "string" },
                        severity: { type: "string", enum: ["high", "medium", "low"] },
                        description: { type: "string" },
                        suggestion: { type: "string" },
                    },
                    required: ["area", "severity", "description", "suggestion"],
                    additionalProperties: false,
                },
            },
            summary: { type: "string" },
        },
        required: ["gaps", "summary"],
        additionalProperties: false,
    },
};

export const SUGGEST_RELATIONS_JSON_SCHEMA = {
    name: "suggest_relations_response",
    schema: {
        type: "object",
        properties: {
            suggestions: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        targetNoteId: { type: "string" },
                        targetTitle: { type: "string" },
                        relationshipType: {
                            type: "string",
                            enum: ["ally", "enemy", "family", "location", "event", "faction", "other"],
                        },
                        description: { type: "string" },
                        confidence: { type: "string", enum: ["high", "medium", "low"] },
                    },
                    required: ["targetNoteId", "relationshipType", "description"],
                    additionalProperties: false,
                },
            },
        },
        required: ["suggestions"],
        additionalProperties: false,
    },
};

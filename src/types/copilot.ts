import { z } from "zod";
import { LoreEntityTypeSchema, RelationshipTypeSchema } from "./lore.ts";

export const ChatMessageSchema = z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const CopilotNoteLabelSchema = z.object({
    name: z.string(),
    value: z.string(),
});
export type CopilotNoteLabel = z.infer<typeof CopilotNoteLabelSchema>;

export const CopilotNoteRelationSchema = z.object({
    name: z.string(),
    targetNoteId: z.string(),
    description: z.string().optional(),
});
export type CopilotNoteRelation = z.infer<typeof CopilotNoteRelationSchema>;

export const CopilotNoteContextSchema = z.object({
    noteId: z.string(),
    title: z.string(),
    loreType: z.string(),
    contentHtml: z.string(),
    parentNoteIds: z.array(z.string()),
    labels: z.array(CopilotNoteLabelSchema),
    relations: z.array(CopilotNoteRelationSchema),
});
export type CopilotNoteContext = z.infer<typeof CopilotNoteContextSchema>;

export const CopilotRagChunkSchema = z.object({
    noteId: z.string(),
    title: z.string(),
    excerpt: z.string(),
    score: z.number(),
});
export type CopilotRagChunk = z.infer<typeof CopilotRagChunkSchema>;

export const CopilotLabelOpSchema = z.object({
    name: z.string().min(1),
    value: z.string(),
});
export type CopilotLabelOp = z.infer<typeof CopilotLabelOpSchema>;

export const CopilotRelationAddSchema = z.object({
    relationshipType: RelationshipTypeSchema,
    targetId: z.string().min(1),
    targetKind: z.enum(["existing", "new"]),
    description: z.string().optional(),
    bidirectional: z.boolean().optional(),
});
export type CopilotRelationAdd = z.infer<typeof CopilotRelationAddSchema>;

export const CopilotRelationDeleteSchema = z.object({
    relationshipType: RelationshipTypeSchema,
    targetId: z.string().min(1),
});
export type CopilotRelationDelete = z.infer<typeof CopilotRelationDeleteSchema>;

export const CopilotProposalTargetSchema = z.object({
    kind: z.enum(["update", "create"]),
    targetId: z.string().min(1),
    title: z.string().min(1).optional(),
    loreType: LoreEntityTypeSchema.optional(),
    contentHtml: z.string().optional(),
    labelUpserts: z.array(CopilotLabelOpSchema).default([]),
    labelDeletes: z.array(z.string().min(1)).default([]),
    relationAdds: z.array(CopilotRelationAddSchema).default([]),
    relationDeletes: z.array(CopilotRelationDeleteSchema).default([]),
    rationale: z.string().min(1),
}).superRefine((target, ctx) => {
    if (target.kind === "create") {
        if (!target.loreType) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["loreType"],
                message: "Create targets must include loreType.",
            });
        }
        if (!target.title) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["title"],
                message: "Create targets must include title.",
            });
        }
        if (!target.contentHtml) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["contentHtml"],
                message: "Create targets must include contentHtml.",
            });
        }
    }
});
export type CopilotProposalTarget = z.infer<typeof CopilotProposalTargetSchema>;

export const CopilotProposalSchema = z.object({
    targets: z.array(CopilotProposalTargetSchema),
});
export type CopilotProposal = z.infer<typeof CopilotProposalSchema>;

export const CopilotCitationSchema = z.object({
    noteId: z.string(),
    title: z.string(),
    source: z.enum(["current", "linked", "rag"]),
});
export type CopilotCitation = z.infer<typeof CopilotCitationSchema>;

export const ArticleCopilotRequestSchema = z.object({
    noteId: z.string(),
    sessionId: z.string().optional(),
    transcript: z.array(ChatMessageSchema),
    currentNote: CopilotNoteContextSchema,
    linkedNotes: z.array(CopilotNoteContextSchema),
    ragContext: z.array(CopilotRagChunkSchema),
    writableTargetIds: z.array(z.string()),
});
export type ArticleCopilotRequest = z.infer<typeof ArticleCopilotRequestSchema>;

export const ArticleCopilotResponseSchema = z.object({
    sessionId: z.string().optional(),
    assistantMessage: z.string(),
    citations: z.array(CopilotCitationSchema),
    proposal: CopilotProposalSchema.nullable(),
});
export type ArticleCopilotResponse = z.infer<typeof ArticleCopilotResponseSchema>;

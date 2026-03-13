import { z } from "zod";

/**
 * Zod schemas for all lore entity types in AllKnower.
 *
 * These are the single source of truth — TypeScript types are derived from them.
 * They're used for:
 *   - Parsing and validating Claude's JSON output in the brain dump pipeline
 *   - Elysia route body/response validation (via @elysiajs/zod)
 *   - Runtime type guards anywhere in the codebase
 */

// ── Shared ────────────────────────────────────────────────────────────────────

export const LoreEntityTypeSchema = z.enum([
    "character",
    "location",
    "faction",
    "creature",
    "event",
    "timeline",
    "manuscript",
    "statblock",
]);
export type LoreEntityType = z.infer<typeof LoreEntityTypeSchema>;

const BaseLoreEntitySchema = z.object({
    type: LoreEntityTypeSchema,
    title: z.string().min(1),
    content: z.string().optional(),       // HTML note body
    tags: z.array(z.string()).optional(),
    parentNoteId: z.string().optional(),  // AllCodex placement
});

// ── Per-type attribute schemas ────────────────────────────────────────────────

export const CharacterAttributesSchema = z.object({
    fullName: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    age: z.string().optional(),
    race: z.string().optional(),
    gender: z.string().optional(),
    affiliation: z.string().optional(),
    role: z.string().optional(),
    status: z.enum(["alive", "dead", "unknown"]).optional(),
    secrets: z.string().optional(),
    physicalDescription: z.string().optional(),
    personality: z.string().optional(),
    backstory: z.string().optional(),
    goals: z.string().optional(),
});

export const LocationAttributesSchema = z.object({
    locationType: z.string().optional(),
    region: z.string().optional(),
    population: z.string().optional(),
    ruler: z.string().optional(),
    history: z.string().optional(),
    notableLandmarks: z.string().optional(),
    secrets: z.string().optional(),
    connectedLocations: z.array(z.string()).optional(),
});

export const FactionAttributesSchema = z.object({
    factionType: z.string().optional(),
    foundingDate: z.string().optional(),
    leader: z.string().optional(),
    goals: z.string().optional(),
    members: z.array(z.string()).optional(),
    allies: z.array(z.string()).optional(),
    enemies: z.array(z.string()).optional(),
    secrets: z.string().optional(),
    hierarchy: z.string().optional(),
});

const StatblockFieldsSchema = z.object({
    ac: z.string().optional(),
    hp: z.string().optional(),
    speed: z.string().optional(),
    str: z.number().int().min(1).max(30).optional(),
    dex: z.number().int().min(1).max(30).optional(),
    con: z.number().int().min(1).max(30).optional(),
    int: z.number().int().min(1).max(30).optional(),
    wis: z.number().int().min(1).max(30).optional(),
    cha: z.number().int().min(1).max(30).optional(),
    cr: z.string().optional(),
});

export const CreatureAttributesSchema = StatblockFieldsSchema.extend({
    creatureType: z.string().optional(),
    habitat: z.string().optional(),
    diet: z.string().optional(),
    abilities: z.string().optional(),
    lore: z.string().optional(),
    dangerLevel: z.string().optional(),
});

export const EventAttributesSchema = z.object({
    inWorldDate: z.string().optional(),
    participants: z.array(z.string()).optional(),
    location: z.string().optional(),
    outcome: z.string().optional(),
    consequences: z.string().optional(),
    secrets: z.string().optional(),
});

export const TimelineAttributesSchema = z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    events: z.array(z.string()).optional(), // Event note IDs
});

export const ManuscriptAttributesSchema = z.object({
    wordCount: z.number().int().nonnegative().optional(),
    status: z.enum(["draft", "in-progress", "complete"]).optional(),
});

export const StatblockAttributesSchema = StatblockFieldsSchema.extend({
    system: z.string().optional(), // "dnd5e", "pathfinder2e", etc.
    abilities: z.string().optional(),
    actions: z.string().optional(),
    legendaryActions: z.string().optional(),
});

// ── Discriminated union entity schemas ────────────────────────────────────────

export const CharacterEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("character"),
    attributes: CharacterAttributesSchema,
    action: z.enum(["create", "update"]),
    existingNoteId: z.string().optional(),
});

export const LocationEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("location"),
    attributes: LocationAttributesSchema,
    action: z.enum(["create", "update"]),
    existingNoteId: z.string().optional(),
});

export const FactionEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("faction"),
    attributes: FactionAttributesSchema,
    action: z.enum(["create", "update"]),
    existingNoteId: z.string().optional(),
});

export const CreatureEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("creature"),
    attributes: CreatureAttributesSchema,
    action: z.enum(["create", "update"]),
    existingNoteId: z.string().optional(),
});

export const EventEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("event"),
    attributes: EventAttributesSchema,
    action: z.enum(["create", "update"]),
    existingNoteId: z.string().optional(),
});

export const TimelineEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("timeline"),
    attributes: TimelineAttributesSchema,
    action: z.enum(["create", "update"]),
    existingNoteId: z.string().optional(),
});

export const ManuscriptEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("manuscript"),
    attributes: ManuscriptAttributesSchema,
    action: z.enum(["create", "update"]),
    existingNoteId: z.string().optional(),
});

export const StatblockEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("statblock"),
    attributes: StatblockAttributesSchema,
    action: z.enum(["create", "update"]),
    existingNoteId: z.string().optional(),
});

export const LoreEntitySchema = z.discriminatedUnion("type", [
    CharacterEntitySchema,
    LocationEntitySchema,
    FactionEntitySchema,
    CreatureEntitySchema,
    EventEntitySchema,
    TimelineEntitySchema,
    ManuscriptEntitySchema,
    StatblockEntitySchema,
]);
export type LoreEntity = z.infer<typeof LoreEntitySchema>;

// ── LLM response schema ──────────────────────────────────────────────────────

/** Shape of the structured JSON the LLM returns from the brain dump prompt */
export const LLMResponseSchema = z.object({
    entities: z.array(LoreEntitySchema),
    summary: z.string(),
});
export type LLMResponse = z.infer<typeof LLMResponseSchema>;

// ── Pipeline result schemas ───────────────────────────────────────────────────

export const BrainDumpResultSchema = z.object({
    summary: z.string(),
    created: z.array(z.object({
        noteId: z.string(),
        title: z.string(),
        type: LoreEntityTypeSchema,
    })),
    updated: z.array(z.object({
        noteId: z.string(),
        title: z.string(),
        type: LoreEntityTypeSchema,
    })),
    skipped: z.array(z.object({
        title: z.string(),
        reason: z.string(),
    })),
});
export type BrainDumpResult = z.infer<typeof BrainDumpResultSchema>;

export const RagChunkSchema = z.object({
    noteId: z.string(),
    noteTitle: z.string(),
    content: z.string(),
    score: z.number(),
});
export type RagChunk = z.infer<typeof RagChunkSchema>;

// ── Relationship schemas ──────────────────────────────────────────────────────

export const RelationshipTypeSchema = z.enum([
    "ally", "enemy", "family", "location", "event", "faction", "other",
]);
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const RelationSuggestionSchema = z.object({
    targetNoteId: z.string(),
    targetTitle: z.string().optional(),
    relationshipType: RelationshipTypeSchema,
    description: z.string(),
    confidence: ConfidenceSchema.optional(),
});
export type RelationSuggestion = z.infer<typeof RelationSuggestionSchema>;

export const ApplyRelationSchema = z.object({
    targetNoteId: z.string(),
    relationshipType: RelationshipTypeSchema,
    description: z.string().optional(),
});

export const ApplyRelationBodySchema = z.object({
    sourceNoteId: z.string(),
    relations: z.array(ApplyRelationSchema).min(1),
    bidirectional: z.boolean().default(true),
});
export type ApplyRelationBody = z.infer<typeof ApplyRelationBodySchema>;

// ── Route body/param schemas (used in Elysia routes) ─────────────────────────

export const BrainDumpBodySchema = z.object({
    rawText: z.string().min(10).max(50000),
    autoRelate: z.boolean().default(true).optional(),
});
export type BrainDumpBody = z.infer<typeof BrainDumpBodySchema>;

export const RagQueryBodySchema = z.object({
    text: z.string().min(1),
    topK: z.number().int().min(1).max(50).default(10),
});
export type RagQueryBody = z.infer<typeof RagQueryBodySchema>;

export const RagReindexParamsSchema = z.object({
    noteId: z.string().min(1),
});
export type RagReindexParams = z.infer<typeof RagReindexParamsSchema>;

export const ConsistencyCheckBodySchema = z.object({
    noteIds: z.array(z.string()).optional(),
});
export type ConsistencyCheckBody = z.infer<typeof ConsistencyCheckBodySchema>;

export const SuggestRelationshipsBodySchema = z.object({
    text: z.string().min(1),
});
export type SuggestRelationshipsBody = z.infer<typeof SuggestRelationshipsBodySchema>;

// ── Template ID map ───────────────────────────────────────────────────────────

export const TEMPLATE_ID_MAP: Record<LoreEntityType, string> = {
    character: "_template_lore_character",
    location: "_template_lore_location",
    faction: "_template_lore_faction",
    creature: "_template_lore_creature",
    event: "_template_lore_event",
    timeline: "_template_lore_timeline",
    manuscript: "_template_lore_manuscript",
    statblock: "_template_lore_statblock",
};

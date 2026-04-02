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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * LLMs frequently return arrays for fields we want as strings (goals, abilities, etc.).
 * This coerces string[] → comma-joined string, passes strings through, drops null/undefined.
 */
const coerceToString = z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v.join(", ") : v))
    .optional();

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
    "item",
    "spell",
    "building",
    "language",
    "organization",
    "race",
    "myth",
    "cosmology",
    "deity",
    "religion",
    "session",
    "quest",
    "scene",
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
    status: z.enum(["alive", "dead", "unknown"]).catch("unknown").optional(),
    secrets: z.string().optional(),
    physicalDescription: z.string().optional(),
    personality: z.string().optional(),
    backstory: z.string().optional(),
    goals: coerceToString,
});

export const LocationAttributesSchema = z.object({
    locationType: z.string().optional(),
    region: z.string().optional(),
    population: z.string().optional(),
    ruler: z.string().optional(),
    history: z.string().optional(),
    notableLandmarks: coerceToString,
    secrets: z.string().optional(),
    connectedLocations: z.array(z.string()).optional(),
});

export const FactionAttributesSchema = z.object({
    factionType: z.string().optional(),
    foundingDate: z.string().optional(),
    leader: z.string().optional(),
    goals: coerceToString,
    members: z.array(z.string()).optional(),
    allies: z.array(z.string()).optional(),
    enemies: z.array(z.string()).optional(),
    secrets: z.string().optional(),
    hierarchy: coerceToString,
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
    abilities: coerceToString,
    lore: z.string().optional(),
    dangerLevel: z.string().optional(),
});

export const EventAttributesSchema = z.object({
    inWorldDate: z.string().optional(),
    participants: z.array(z.string()).optional(),
    location: z.string().optional(),
    outcome: z.string().optional(),
    consequences: coerceToString,
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
    abilities: coerceToString,
    actions: coerceToString,
    legendaryActions: coerceToString,
});

export const ItemAttributesSchema = z.object({
    itemType: z.string().optional(),
    rarity: z.string().optional(),
    creator: z.string().optional(),
    magicProperties: coerceToString,
    history: z.string().optional(),
    currentOwner: z.string().optional(),
    secrets: z.string().optional(),
});

export const SpellAttributesSchema = z.object({
    school: z.string().optional(),
    level: z.string().optional(),
    castingTime: z.string().optional(),
    range: z.string().optional(),
    components: coerceToString,
    duration: z.string().optional(),
    origin: z.string().optional(),
    secrets: z.string().optional(),
});

export const BuildingAttributesSchema = z.object({
    buildingType: z.string().optional(),
    owner: z.string().optional(),
    purpose: z.string().optional(),
    condition: z.string().optional(),
    secrets: z.string().optional(),
    location: z.string().optional(),
});

export const LanguageAttributesSchema = z.object({
    languageFamily: z.string().optional(),
    speakers: coerceToString,
    script: z.string().optional(),
    samplePhrase: z.string().optional(),
    origin: z.string().optional(),
});

export const OrganizationAttributesSchema = z.object({
    orgType: z.string().optional(),
    purpose: z.string().optional(),
    foundingDate: z.string().optional(),
    leader: z.string().optional(),
    headquarters: z.string().optional(),
    members: z.array(z.string()).optional(),
    resources: coerceToString,
    secrets: z.string().optional(),
    status: z.string().optional(),
});

export const RaceAttributesSchema = z.object({
    racialType: z.string().optional(),
    homeland: z.string().optional(),
    physicalTraits: coerceToString,
    culture: z.string().optional(),
    languages: z.array(z.string()).optional(),
    lifespan: z.string().optional(),
    abilities: coerceToString,
    relations: coerceToString,
    secrets: z.string().optional(),
});

export const MythAttributesSchema = z.object({
    mythType: z.string().optional(),
    origin: z.string().optional(),
    tellers: coerceToString,
    truthBasis: z.string().optional(),
    significance: z.string().optional(),
    secrets: z.string().optional(),
});

export const CosmologyAttributesSchema = z.object({
    domain: z.string().optional(),
    laws: coerceToString,
    source: z.string().optional(),
    planes: z.array(z.string()).optional(),
    interactions: coerceToString,
    secrets: z.string().optional(),
});

export const DeityAttributesSchema = z.object({
    domains: coerceToString,
    alignment: z.string().optional(),
    rank: z.string().optional(),
    symbol: z.string().optional(),
    worshippers: coerceToString,
    allies: z.array(z.string()).optional(),
    enemies: z.array(z.string()).optional(),
    secrets: z.string().optional(),
});

export const ReligionAttributesSchema = z.object({
    deity: z.string().optional(),
    pantheon: z.string().optional(),
    tenets: coerceToString,
    clergy: z.string().optional(),
    holyDays: coerceToString,
    headquarters: z.string().optional(),
    followers: coerceToString,
    secrets: z.string().optional(),
});

export const SessionAttributesSchema = z.object({
    sessionDate: z.string().optional(),
    players: coerceToString,
    sessionStatus: z.string().optional(),
    recap: z.string().optional(),
    hooks: coerceToString,
    gmNotes: z.string().optional(),
});

export const QuestAttributesSchema = z.object({
    questStatus: z.enum(["active", "completed", "failed", "deferred", "unknown"])
        .catch("unknown").optional(),
    questGiver: z.string().optional(),
    reward: z.string().optional(),
    location: z.string().optional(),
    hooks: coerceToString,
    consequences: coerceToString,
});

export const SceneAttributesSchema = z.object({
    location: z.string().optional(),
    participants: coerceToString,
    outcome: z.string().optional(),
    gmNotes: z.string().optional(),
});

// ── Discriminated union entity schemas ────────────────────────────────────────

// Shared coercions applied to every entity type
const EntityBaseExtension = {
    action: z.enum(["create", "update"]).default("create"),
    existingNoteId: z.string().nullish().transform((v) => v ?? undefined),
};

export const CharacterEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("character"),
    attributes: CharacterAttributesSchema,
    ...EntityBaseExtension,
});

export const LocationEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("location"),
    attributes: LocationAttributesSchema,
    ...EntityBaseExtension,
});

export const FactionEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("faction"),
    attributes: FactionAttributesSchema,
    ...EntityBaseExtension,
});

export const CreatureEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("creature"),
    attributes: CreatureAttributesSchema,
    ...EntityBaseExtension,
});

export const EventEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("event"),
    attributes: EventAttributesSchema,
    ...EntityBaseExtension,
});

export const TimelineEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("timeline"),
    attributes: TimelineAttributesSchema,
    ...EntityBaseExtension,
});

export const ManuscriptEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("manuscript"),
    attributes: ManuscriptAttributesSchema,
    ...EntityBaseExtension,
});

export const StatblockEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("statblock"),
    attributes: StatblockAttributesSchema,
    ...EntityBaseExtension,
});

export const ItemEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("item"),
    attributes: ItemAttributesSchema,
    ...EntityBaseExtension,
});

export const SpellEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("spell"),
    attributes: SpellAttributesSchema,
    ...EntityBaseExtension,
});

export const BuildingEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("building"),
    attributes: BuildingAttributesSchema,
    ...EntityBaseExtension,
});

export const LanguageEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("language"),
    attributes: LanguageAttributesSchema,
    ...EntityBaseExtension,
});

export const OrganizationEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("organization"),
    attributes: OrganizationAttributesSchema,
    ...EntityBaseExtension,
});

export const RaceEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("race"),
    attributes: RaceAttributesSchema,
    ...EntityBaseExtension,
});

export const MythEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("myth"),
    attributes: MythAttributesSchema,
    ...EntityBaseExtension,
});

export const CosmologyEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("cosmology"),
    attributes: CosmologyAttributesSchema,
    ...EntityBaseExtension,
});

export const DeityEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("deity"),
    attributes: DeityAttributesSchema,
    ...EntityBaseExtension,
});

export const ReligionEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("religion"),
    attributes: ReligionAttributesSchema,
    ...EntityBaseExtension,
});

export const SessionEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("session"),
    attributes: SessionAttributesSchema,
    ...EntityBaseExtension,
});

export const QuestEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("quest"),
    attributes: QuestAttributesSchema,
    ...EntityBaseExtension,
});

export const SceneEntitySchema = BaseLoreEntitySchema.extend({
    type: z.literal("scene"),
    attributes: SceneAttributesSchema,
    ...EntityBaseExtension,
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
    ItemEntitySchema,
    SpellEntitySchema,
    BuildingEntitySchema,
    LanguageEntitySchema,
    OrganizationEntitySchema,
    RaceEntitySchema,
    MythEntitySchema,
    CosmologyEntitySchema,
    DeityEntitySchema,
    ReligionEntitySchema,
    SessionEntitySchema,
    QuestEntitySchema,
    SceneEntitySchema,
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
        errorCategory: z.enum(["auth", "network", "validation", "unknown"]).optional(),
        noteId: z.string().optional(),
    })),
    duplicates: z.array(z.object({
        proposedTitle: z.string(),
        proposedType: z.string(),
        matches: z.array(z.object({
            noteId: z.string(),
            title: z.string(),
            score: z.number(),
        })),
    })).optional(),
});
export type BrainDumpResult = z.infer<typeof BrainDumpResultSchema>;

export const BrainDumpHistoryEntrySchema = z.object({
    id: z.string(),
    rawText: z.string(),
    summary: z.string().nullable(),
    notesCreated: z.array(z.string()),
    notesUpdated: z.array(z.string()),
    model: z.string(),
    tokensUsed: z.number().nullable(),
    createdAt: z.string(),
});
export type BrainDumpHistoryEntry = z.infer<typeof BrainDumpHistoryEntrySchema>;


export const RagChunkSchema = z.object({
    noteId: z.string(),
    noteTitle: z.string(),
    content: z.string(),
    score: z.number(),
});
export type RagChunk = z.infer<typeof RagChunkSchema>;

// ── Session state schema (Tier 3 context compaction) ──────────────────────────

export const LoreSessionStateSchema = z.object({
    /** 1. What the user is trying to accomplish this session */
    intent: z.string(),
    /** 2. Which entity types came up */
    loreTypesInPlay: z.array(LoreEntityTypeSchema),
    /** 3. AllCodex note IDs created/updated this session */
    noteIdsModified: z.array(z.string()),
    /** 4. Things that failed and why */
    skippedEntities: z.array(z.object({
        title: z.string(),
        reason: z.string(),
        errorCategory: z.string().optional(),
    })),
    /** 5. Compressed summary of all user raw inputs this session */
    rawInputsSummary: z.string(),
    /** 6. Lore gaps or inconsistencies flagged but not resolved */
    unresolvedGaps: z.array(z.string()),
    /** 7. The entity currently being actively worked on */
    currentFocus: z.string().optional(),
    /** Metadata */
    lastCompactedAt: z.string().optional(),
    totalTokensConsumed: z.number().default(0),
    /** Schema version for future state migrations */
    schemaVersion: z.literal(1).default(1),
});
export type LoreSessionState = z.infer<typeof LoreSessionStateSchema>;

// ── Relationship schemas ──────────────────────────────────────────────────────

export const RelationshipTypeSchema = z.enum([
    // Social / Political
    "ally",              // alliance, cooperation, friendship
    "enemy",             // opposition, hostility, nemesis
    "rival",             // competition, tension without outright enmity
    // Kinship
    "family",            // blood relation, marriage, adoption, lineage
    // Organizational
    "member_of",         // belongs to faction, guild, order, pantheon
    "leader_of",         // rules, commands, governs, presides over
    "serves",            // sworn service, employment, devotion
    // Spatial / Origin
    "located_in",        // present at, based in, found at, resides
    "originates_from",   // birthplace, founded in, forged at, homeland
    // Temporal / Causal
    "participated_in",   // took part in event, battle, ritual, catastrophe
    "caused",            // triggered, initiated, responsible for
    // Creation / Ownership
    "created",           // built, forged, authored, brewed, enchanted
    "owns",              // possesses, controls, holds, inherited
    // Power / Magic
    "wields",            // uses item, spell, power, artifact
    "worships",          // follows deity, religion, philosophy, patron
    // Ecological
    "inhabits",          // creature habitat, native region, natural environment
    // General
    "related_to",        // catch-all for narrative connections that defy categorization
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
    character: "_template_character",
    location: "_template_location",
    faction: "_template_faction",
    creature: "_template_creature",
    event: "_template_event",
    timeline: "_template_timeline",
    manuscript: "_template_manuscript",
    statblock: "_template_statblock",
    item: "_template_item",
    spell: "_template_spell",
    building: "_template_building",
    language: "_template_language",
    organization: "_template_organization",
    race: "_template_race",
    myth: "_template_myth",
    cosmology: "_template_cosmology",
    deity: "_template_deity",
    religion: "_template_religion",
    session: "_template_session",
    quest: "_template_quest",
    scene: "_template_scene",
};

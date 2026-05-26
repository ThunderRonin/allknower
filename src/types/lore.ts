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

/** Accepts string | null | undefined → string | undefined (null coerced away). */
const optStr = z
    .union([z.string(), z.null()])
    .transform((v): string | undefined => (v === null ? undefined : v))
    .optional();

/**
 * LLMs frequently return arrays for fields we want as strings (goals, abilities, etc.).
 * This coerces string[] → comma-joined string, passes strings through, drops null/undefined.
 */
const coerceToString = z
    .union([z.string(), z.array(z.string()), z.null()])
    .transform((v) => {
        if (v === null) return undefined;
        if (Array.isArray(v)) return v.join(", ");
        return v;
    })
    .optional();

/**
 * LLMs frequently return comma-separated strings for fields we want as string arrays (members, allies, etc.).
 * This coerces string → string[], passes string arrays through.
 */
const coerceToArray = z
    .union([z.array(z.string()), z.string()])
    .transform((v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : v))
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
    content: optStr,       // HTML note body
    tags: z.array(z.string()).optional(),
    parentNoteId: optStr,  // AllCodex placement
});

// ── Per-type attribute schemas ────────────────────────────────────────────────

export const CharacterAttributesSchema = z.object({
    fullName: optStr,
    aliases: coerceToArray,
    age: optStr,
    race: optStr,
    gender: optStr,
    affiliation: optStr,
    role: optStr,
    status: z.enum(["alive", "dead", "unknown"]).catch("unknown").optional(),
    secrets: optStr,
    physicalDescription: optStr,
    personality: optStr,
    backstory: optStr,
    goals: coerceToString,
});

export const LocationAttributesSchema = z.object({
    locationType: optStr,
    region: optStr,
    population: optStr,
    ruler: optStr,
    history: optStr,
    notableLandmarks: coerceToString,
    secrets: optStr,
    connectedLocations: coerceToArray,
});

export const FactionAttributesSchema = z.object({
    factionType: optStr,
    foundingDate: optStr,
    leader: optStr,
    goals: coerceToString,
    members: coerceToArray,
    allies: coerceToArray,
    enemies: coerceToArray,
    secrets: optStr,
    hierarchy: coerceToString,
});

const StatblockFieldsSchema = z.object({
    ac: optStr,
    hp: optStr,
    speed: optStr,
    str: z.number().int().min(1).max(30).optional(),
    dex: z.number().int().min(1).max(30).optional(),
    con: z.number().int().min(1).max(30).optional(),
    int: z.number().int().min(1).max(30).optional(),
    wis: z.number().int().min(1).max(30).optional(),
    cha: z.number().int().min(1).max(30).optional(),
    cr: optStr,
});

export const CreatureAttributesSchema = StatblockFieldsSchema.extend({
    creatureType: optStr,
    habitat: optStr,
    diet: optStr,
    abilities: coerceToString,
    lore: optStr,
    dangerLevel: optStr,
});

export const EventAttributesSchema = z.object({
    inWorldDate: optStr,
    participants: coerceToArray,
    location: optStr,
    outcome: optStr,
    consequences: coerceToString,
    secrets: optStr,
});

export const TimelineAttributesSchema = z.object({
    startDate: optStr,
    endDate: optStr,
    events: coerceToArray, // Event note IDs
});

export const ManuscriptAttributesSchema = z.object({
    wordCount: z.number().int().nonnegative().optional(),
    status: z.enum(["draft", "in-progress", "complete"]).optional(),
});

export const StatblockAttributesSchema = StatblockFieldsSchema.extend({
    system: optStr, // "dnd5e", "pathfinder2e", etc.
    abilities: coerceToString,
    actions: coerceToString,
    legendaryActions: coerceToString,
});

export const ItemAttributesSchema = z.object({
    itemType: optStr,
    rarity: optStr,
    creator: optStr,
    magicProperties: coerceToString,
    history: optStr,
    currentOwner: optStr,
    secrets: optStr,
});

export const SpellAttributesSchema = z.object({
    school: optStr,
    level: optStr,
    castingTime: optStr,
    range: optStr,
    components: coerceToString,
    duration: optStr,
    origin: optStr,
    secrets: optStr,
});

export const BuildingAttributesSchema = z.object({
    buildingType: optStr,
    owner: optStr,
    purpose: optStr,
    condition: optStr,
    secrets: optStr,
    location: optStr,
});

export const LanguageAttributesSchema = z.object({
    languageFamily: optStr,
    speakers: coerceToString,
    script: optStr,
    samplePhrase: optStr,
    origin: optStr,
});

export const OrganizationAttributesSchema = z.object({
    orgType: optStr,
    purpose: optStr,
    foundingDate: optStr,
    leader: optStr,
    headquarters: optStr,
    members: coerceToArray,
    resources: coerceToString,
    secrets: optStr,
    status: optStr,
});

export const RaceAttributesSchema = z.object({
    racialType: optStr,
    homeland: optStr,
    physicalTraits: coerceToString,
    culture: optStr,
    languages: coerceToArray,
    lifespan: optStr,
    abilities: coerceToString,
    relations: coerceToString,
    secrets: optStr,
});

export const MythAttributesSchema = z.object({
    mythType: optStr,
    origin: optStr,
    tellers: coerceToString,
    truthBasis: optStr,
    significance: optStr,
    secrets: optStr,
});

export const CosmologyAttributesSchema = z.object({
    domain: optStr,
    laws: coerceToString,
    source: optStr,
    planes: coerceToArray,
    interactions: coerceToString,
    secrets: optStr,
});

export const DeityAttributesSchema = z.object({
    domains: coerceToString,
    alignment: optStr,
    rank: optStr,
    symbol: optStr,
    worshippers: coerceToString,
    allies: coerceToArray,
    enemies: coerceToArray,
    secrets: optStr,
});

export const ReligionAttributesSchema = z.object({
    deity: optStr,
    pantheon: optStr,
    tenets: coerceToString,
    clergy: optStr,
    holyDays: coerceToString,
    headquarters: optStr,
    followers: coerceToString,
    secrets: optStr,
});

export const SessionAttributesSchema = z.object({
    sessionDate: optStr,
    players: coerceToString,
    sessionStatus: optStr,
    recap: optStr,
    hooks: coerceToString,
    gmNotes: optStr,
});

export const QuestAttributesSchema = z.object({
    questStatus: z.enum(["active", "completed", "failed", "deferred", "unknown"])
        .catch("unknown").optional(),
    questGiver: optStr,
    reward: optStr,
    location: optStr,
    hooks: coerceToString,
    consequences: coerceToString,
});

export const SceneAttributesSchema = z.object({
    location: optStr,
    participants: coerceToString,
    outcome: optStr,
    gmNotes: optStr,
});

// ── Discriminated union entity schemas ────────────────────────────────────────

// Shared coercions applied to every entity type
const EntityBaseExtension = {
    action: z.enum(["create", "update"]).default("create"),
    existingNoteId: optStr.transform((v) => v ?? undefined),
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
        noteId: optStr,
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
    loreTypesInPlay: z.array(z.string()),
    /** 3. AllCodex note IDs created/updated this session */
    noteIdsModified: z.array(z.string()),
    /** 4. Things that failed and why */
    skippedEntities: z.array(z.object({
        title: z.string(),
        reason: z.string(),
        errorCategory: optStr,
    })),
    /** 5. Compressed summary of all user raw inputs this session */
    rawInputsSummary: z.string(),
    /** 6. Lore gaps or inconsistencies flagged but not resolved */
    unresolvedGaps: z.array(z.string()),
    /** 7. The entity currently being actively worked on */
    currentFocus: optStr,
    /** Metadata */
    lastCompactedAt: optStr,
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
    targetTitle: optStr,
    relationshipType: RelationshipTypeSchema,
    description: z.string(),
    confidence: ConfidenceSchema.optional(),
});
export type RelationSuggestion = z.infer<typeof RelationSuggestionSchema>;

export const ApplyRelationSchema = z.object({
    targetNoteId: z.string(),
    relationshipType: RelationshipTypeSchema,
    description: optStr,
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

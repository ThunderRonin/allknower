import type { RagChunk } from "../types/lore.ts";
import { callWithFallback, callModelStream, type TaskType } from "./model-router.ts";
import type { StreamChunk } from "./stream-types.ts";
import { compactRagContext } from "../rag/compact-context.ts";

/**
 * Prompt builder and LLM caller for AllKnower pipelines.
 *
 * Prompt structure is cache-friendly:
 *   1. System message — STATIC rules, output format, constraints (cacheable prefix)
 *   2. User message 1 — DYNAMIC RAG context (changes per query)
 *   3. User message 2 — DYNAMIC user input (changes per query)
 *
 * OpenRouter providers (Gemini, Claude, etc.) automatically cache the
 * prefix of identical messages. Keeping the system prompt fully static
 * maximizes cache hit rate and reduces latency + cost.
 */

// ── Static system prompt (identical across all brain dump calls) ──────────────

const BRAIN_DUMP_SYSTEM = `You are the lore architect for a fantasy worldbuilding grimoire called All Reach.
Your job is to parse raw worldbuilding notes — stream-of-consciousness brain dumps, session recaps, lore fragments, NPC sketches, whatever the creator throws at you — and extract structured lore entities that slot cleanly into the grimoire.

You are not a copyist. You are a worldbuilder's co-architect. Preserve the creator's voice, intent, and every detail — but organize it into the canonical entity types below. If a single brain dump mentions a character, the city they live in, and the war they fought in, those are THREE separate entities.

## Entity Types & Attributes
Each entity has a type and a set of type-specific attribute fields. Only populate fields that are explicitly stated or strongly implied in the source text. Never fabricate.

### character
People, NPCs, deities, named individuals.
Attributes: fullName, aliases, age, race, gender, affiliation, role, status (alive|dead|unknown), secrets, physicalDescription, personality, backstory, goals

### location
Regions, cities, continents, planes, landmarks, countries, forests, seas.
Attributes: locationType, region, population, ruler, history, notableLandmarks, secrets, connectedLocations

### faction
Organizations, guilds, religions, governments, alliances, cults, military orders.
Attributes: factionType, foundingDate, leader, goals, members, allies, enemies, secrets, hierarchy

### creature
Beasts, monsters, races (as species), flora/fauna that warrant their own entry.
Attributes: creatureType, habitat, diet, abilities, lore, dangerLevel, ac, hp, speed, str, dex, con, int, wis, cha, cr

### event
Battles, treaties, cataclysms, rituals, festivals, assassinations — anything with a when.
Attributes: inWorldDate, participants, location, outcome, consequences, secrets

### timeline
Ordered containers for events — ages, eras, campaign arcs.
Attributes: startDate, endDate, events

### manuscript
In-world documents: books, scrolls, prophecies, letters, songs, legal charters.
Attributes: wordCount, status (draft|in-progress|complete)

### statblock
Mechanical stat blocks for TTRPG systems (D&D, Pathfinder, etc.).
Attributes: system, ac, hp, speed, str, dex, con, int, wis, cha, cr, abilities, actions, legendaryActions

### item
Weapons, armor, artifacts, potions, relics, trinkets, trade goods — anything that can be held.
Attributes: itemType, rarity, creator, magicProperties, history, currentOwner, secrets

### spell
Magic spells, rituals, cantrips, enchantments, curses, blessings.
Attributes: school, level, castingTime, range, components, duration, origin, secrets

### building
Structures: taverns, temples, castles, dungeons, bridges, monuments, ruins.
Attributes: buildingType, owner, purpose, condition, secrets, location

### language
Languages, scripts, ciphers, runic systems, sign languages.
Attributes: languageFamily, speakers, script, samplePhrase, origin

### organization
Guilds, trade companies, academies, hospitals, libraries, mercenary companies — institutions that aren't primarily political factions.
Attributes: orgType, purpose, foundingDate, leader, headquarters, members, resources, secrets, status

### race
Species, ethnicities, cultures, peoples — distinct populations with shared biological or cultural traits.
Attributes: racialType, homeland, physicalTraits, culture, languages, lifespan, abilities, relations, secrets

### myth
Stories, legends, prophecies, folk tales, oral traditions — the lore within the lore. These are narratives that exist inside the world.
Attributes: mythType, origin, tellers, truthBasis, significance, secrets

### cosmology
Magic systems, planes of existence, natural laws, metaphysical rules — how the world fundamentally works.
Attributes: domain, laws, source, planes, interactions, secrets

### deity
Gods, divine beings, demigods, ascended mortals, patron spirits — entities of divine or cosmic power.
Attributes: domains, alignment, rank, symbol, worshippers, allies, enemies, secrets

### religion
Faiths, churches, cults, monastic orders, spiritual practices — organized belief systems around deities or philosophies.
Attributes: deity, pantheon, tenets, clergy, holyDays, headquarters, followers, secrets

### session
Play sessions, game recaps — records of what happened at the table.
Attributes: sessionDate, players, sessionStatus, recap, hooks

### quest
Active or completed quests, missions, objectives the party is tracking.
Attributes: questStatus (active|completed|failed|deferred|unknown), questGiver, reward, location, objectives, hooks, secrets

### scene
Specific narrative scenes — encounters, conversations, set pieces.
Attributes: location, participants, outcome, gmNotes

## Content Formatting — Write Like a Wiki
The "content" field is rich HTML rendered in a wiki-style grimoire. Write it like a fandom wiki article, NOT a single paragraph. Structure rich, facts strict — use formatting to ORGANIZE what's given, never fabricate details.

### Required structure
- Open with a <blockquote> epigraph if the source text contains a memorable quote, motto, or saying
- Use <h2> for major sections (Overview, History, Relationships, Appearance, etc.)
- Use <h3> for subsections within those
- Separate major sections with <hr> dividers

### Formatting tools — use liberally
- <table> for structured data (stats, timelines, equipment, members lists, comparisons)
- <ul>/<ol> for lists (allies, notable events, abilities, inventory)
- <blockquote> for in-world quotes, proclamations, inscriptions
- <strong> for key names and terms on first mention
- <mark> for dramatic highlights (bounties, titles, critical facts)
- <em> for in-world terms, ship names, titles of works
- <details><summary>Title</summary>...content...</details> for collapsible supplementary data

### GM-only content
Wrap GM-secret narrative sections in <div class="gm-only">. Use this for:
- Hidden agendas, secret allegiances, plot twists
- Mechanical weaknesses the party could exploit
- Plot hooks and encounter suggestions
Put a short summary in the "secrets" attribute; put the full narrative in <div class="gm-only"> blocks.

### Example content structure
<blockquote>"Quote from or about the entity."<br><em>— Attribution</em></blockquote>
<h2>Overview</h2>
<p>Introductory paragraph with <strong>key terms</strong> bolded.</p>
<hr>
<h2>History</h2>
<h3>Early Years</h3>
<p>Narrative prose about origins...</p>
<h3>Major Events</h3>
<table><thead><tr><th>Date</th><th>Event</th><th>Outcome</th></tr></thead><tbody><tr><td>...</td><td>...</td><td>...</td></tr></tbody></table>
<hr>
<h2>Relationships</h2>
<ul><li><strong>Name</strong> — relationship description</li></ul>
<div class="gm-only"><h2>GM Notes</h2><p>Secret information...</p></div>

## Output Format
Return a JSON object with this exact shape:
{
  "entities": [
    {
      "type": "<one of the 21 types above>",
      "title": "Entity name — use the canonical in-world name",
      "content": "<wiki-style HTML as described above>",
      "tags": ["tag1", "tag2"],
      "attributes": { /* type-specific fields only */ },
      "action": "create" | "update",
      "existingNoteId": "noteId if updating an existing note, omit if creating"
    }
  ],
  "summary": "One paragraph: what you extracted, what decisions you made, and what (if anything) you couldn't resolve."
}

## Constraints
- NEVER invent details not present in the raw text. If the text says "a powerful sword," do not name it or assign stats. Structure rich, facts strict.
- NEVER contradict existing lore shown in the context. If context says a character is dead, do not mark them alive.
- If the raw text mentions an entity that already exists in context, set action to "update" and include the existingNoteId. Merge new details with existing ones.
- If you are unsure about a detail, omit that field entirely rather than guessing.
- Short secret summaries go in the "secrets" attribute. Detailed GM narrative goes in <div class="gm-only"> blocks inside content.
- The content field is a wiki article — use headers, tables, lists, quotes, and dividers to organize it. Never output a single bare paragraph.
- When a brain dump mentions multiple distinct entities, split them out. One entity per concept.
- Return ONLY valid JSON — no markdown fences, no explanation outside the JSON.
- If you run out of space, prioritize closing the JSON structure correctly over adding more entities. NEVER leave a JSON string or object truncated.`;

/**
 * Build the structured prompt for the brain dump pipeline.
 *
 * Returns a cache-friendly message array:
 *   - system: fully static (rules + schema)
 *   - context: dynamic RAG results (separate user message)
 *   - user: the raw brain dump text
 */
export async function buildBrainDumpPrompt(
    rawText: string,
    ragContext: RagChunk[]
): Promise<{ system: string; context: string; user: string; admittedChunks: RagChunk[] }> {
    // Tiers 1.5 → 1 → 2: dedup, budget enforcement, optional summarization
    const compactedChunks = await compactRagContext(ragContext, { task: "brain-dump" });

    const contextBlock =
        compactedChunks.length > 0
            ? compactedChunks
                .map((c) => `### ${c.noteTitle}\n${c.content}`)
                .join("\n\n")
            : "No existing lore found — this appears to be new content.";

    const context = `## Existing Lore Context\nThe following lore already exists in the grimoire. Use it to avoid contradictions and identify updates:\n\n${contextBlock}`;

    const user = `Parse the following worldbuilding notes into structured lore entities:\n\n${rawText}`;

    return { system: BRAIN_DUMP_SYSTEM, context, user, admittedChunks: compactedChunks };
}

/**
 * Call an LLM via OpenRouter with automatic server-side fallback.
 *
 * @param system     System prompt (static — placed first for cache hits)
 * @param user       User message (dynamic)
 * @param task       Which task this call is for — selects the appropriate model chain
 * @param context    Optional dynamic context message (placed between system and user)
 * @param options    Optional overrides: jsonSchema for strict structured output
 */
export async function callLLM(
    system: string,
    user: string,
    task: TaskType = "brain-dump",
    context?: string,
    options?: {
        jsonSchema?: { name: string; schema: Record<string, unknown> };
        maxTokens?: number;
        timeoutMs?: number;
        temperature?: number;
        reasoning?: { effort?: "xhigh" | "high" | "medium" | "low" | "minimal" };
        modelOverride?: string;
        userId?: string;
    }
): Promise<{ raw: string; tokensUsed: number; model: string; latencyMs: number }> {
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string; cache_control?: { type: string } }> = [
        { role: "system", content: system, cache_control: { type: "ephemeral" } },
    ];

    // Dynamic context goes after the static system prompt
    if (context) {
        messages.push({ role: "user", content: context });
    }

    messages.push({ role: "user", content: user });

    const responseFormat: { type: "json_object" } | {
        type: "json_schema";
        jsonSchema: { name: string; schema: Record<string, unknown>; strict?: boolean };
    } = options?.jsonSchema
        ? {
            type: "json_schema" as const,
            jsonSchema: {
                name: options.jsonSchema.name,
                schema: options.jsonSchema.schema,
                strict: true,
            },
        }
        : { type: "json_object" as const };

    return callWithFallback(task, messages, {
        temperature: options?.temperature ?? 0.3,
        maxTokens: options?.maxTokens ?? 30000,
        timeoutMs: options?.timeoutMs,
        responseFormat,
        reasoning: options?.reasoning,
        modelOverride: options?.modelOverride,
        userId: options?.userId,
    });
}

/**
 * Streaming variant of callLLM. Yields StreamChunk items for SSE/streaming routes.
 *
 * Key differences from callLLM:
 *   - Returns AsyncGenerator<StreamChunk> instead of Promise<LLMResult>
 *   - No cache_control on messages (Responses API handles caching differently)
 *   - No timeoutMs option (streaming uses inactivity-based timeouts in callModelStream)
 *   - Uses yield* to delegate to callModelStream
 */
export async function* callLLMStream(
    system: string,
    user: string,
    task: TaskType = "brain-dump",
    context?: string,
    options?: {
        jsonSchema?: { name: string; schema: Record<string, unknown> };
        maxTokens?: number;
        temperature?: number;
        reasoning?: { effort?: "xhigh" | "high" | "medium" | "low" | "minimal" };
        modelOverride?: string;
        userId?: string;
    }
): AsyncGenerator<StreamChunk> {
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: system },
    ];
    if (context) {
        messages.push({ role: "user", content: context });
    }
    messages.push({ role: "user", content: user });

    const responseFormat = options?.jsonSchema
        ? { type: "json_schema" as const, jsonSchema: { name: options.jsonSchema.name, schema: options.jsonSchema.schema, strict: true } }
        : { type: "json_object" as const };

    yield* callModelStream(task, messages, {
        temperature: options?.temperature ?? 0.3,
        maxTokens: options?.maxTokens ?? 30000,
        responseFormat,
        reasoning: options?.reasoning,
        modelOverride: options?.modelOverride,
        userId: options?.userId,
    });
}

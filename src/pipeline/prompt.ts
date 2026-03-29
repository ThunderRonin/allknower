import type { RagChunk } from "../types/lore.ts";
import { callWithFallback, type TaskType } from "./model-router.ts";

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

const BRAIN_DUMP_SYSTEM = `You are the lore architect for a fantasy world called All Reach.
Your job is to parse raw worldbuilding notes and extract structured lore entities.

## Output Format
Return a JSON object with this exact shape:
{
  "entities": [
    {
      "type": "character" | "location" | "faction" | "creature" | "event" | "timeline" | "manuscript" | "statblock",
      "title": "Entity name",
      "content": "<p>HTML content for the note body — narrative description, backstory, etc.</p>",
      "tags": ["tag1", "tag2"],
      "attributes": {
        // Type-specific fields — only include fields that are explicitly mentioned
        // For characters: fullName, aliases, age, race, gender, affiliation, role, status, secrets, physicalDescription, personality, backstory, goals
        // For locations: locationType, region, population, ruler, history, notableLandmarks, secrets, connectedLocations
        // For factions: factionType, foundingDate, leader, goals, members, allies, enemies, secrets, hierarchy
        // For creatures: creatureType, habitat, diet, abilities, lore, dangerLevel, ac, hp, speed, str, dex, con, int, wis, cha, cr
        // For events: inWorldDate, participants, location, outcome, consequences, secrets
      },
      "action": "create" | "update",
      "existingNoteId": "noteId if updating an existing note, omit if creating"
    }
  ],
  "summary": "One paragraph describing what was extracted and any notable decisions made."
}

## Constraints
- NEVER invent details not present in the raw text
- NEVER contradict existing lore shown in the context
- If the raw text mentions an entity that already exists in the context, set action to "update" and include the existingNoteId
- If you are unsure about a detail, omit that field rather than guessing
- Secrets (sensitive plot info) should go in the "secrets" attribute field, not in the main content
- Return ONLY valid JSON — no markdown fences, no explanation outside the JSON`;

/**
 * Build the structured prompt for the brain dump pipeline.
 *
 * Returns a cache-friendly message array:
 *   - system: fully static (rules + schema)
 *   - context: dynamic RAG results (separate user message)
 *   - user: the raw brain dump text
 */
export function buildBrainDumpPrompt(
    rawText: string,
    ragContext: RagChunk[]
): { system: string; context: string; user: string } {
    const contextBlock =
        ragContext.length > 0
            ? ragContext
                .map((c) => `### ${c.noteTitle}\n${c.content}`)
                .join("\n\n")
            : "No existing lore found — this appears to be new content.";

    const context = `## Existing Lore Context\nThe following lore already exists in the grimoire. Use it to avoid contradictions and identify updates:\n\n${contextBlock}`;

    const user = `Parse the following worldbuilding notes into structured lore entities:\n\n${rawText}`;

    return { system: BRAIN_DUMP_SYSTEM, context, user };
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
    }
): Promise<{ raw: string; tokensUsed: number; model: string; latencyMs: number }> {
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: system },
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
        temperature: 0.3, // low temp for more deterministic output
        maxTokens: 65536, // set high maxTokens to avoid truncation of long outputs
        responseFormat,
    });
}

/**
 * @deprecated Use callLLM with task="brain-dump" instead.
 * Kept for backwards compatibility with existing callers.
 */
export const callClaude = (system: string, user: string) =>
    callLLM(system, user, "brain-dump");

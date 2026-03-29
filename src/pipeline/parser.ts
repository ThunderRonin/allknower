import { LLMResponseSchema } from "../types/lore.ts";
import type { LoreEntity } from "../types/lore.ts";
import { rootLogger } from "../logger.ts";

/**
 * Parse and validate the raw JSON string returned by the LLM.
 *
 * Uses LLMResponseSchema (Zod) as the single source of truth.
 * Invalid entities are logged and dropped rather than crashing the pipeline.
 */
export interface ParsedBrainDump {
    entities: LoreEntity[];
    summary: string;
}

export function parseBrainDumpResponse(raw: string): ParsedBrainDump {
    let json: unknown;

    try {
        json = JSON.parse(raw);
    } catch {
        throw new Error(`LLM returned invalid JSON: ${raw.slice(0, 200)}`);
    }

    const result = LLMResponseSchema.safeParse(json);

    if (!result.success) {
        // Log each validation issue for debugging, then return what we can
        rootLogger.warn("LLM response failed Zod validation", {
            issues: result.error.issues.map((i) => `[${i.path.join(".").slice(0, 40)}] ${i.message}`),
        });

        // Attempt a best-effort partial parse: extract entities that individually pass
        const raw_obj = json as Record<string, unknown>;
        const rawEntities = Array.isArray(raw_obj?.entities) ? raw_obj.entities : [];
        const summary = typeof raw_obj?.summary === "string" ? raw_obj.summary : "No summary provided.";

        const validEntities: LoreEntity[] = [];
        for (const entity of rawEntities) {
            // Try each entity individually against the discriminated union
            const entityResult = LLMResponseSchema.shape.entities.element.safeParse(entity);
            if (entityResult.success) {
                validEntities.push(entityResult.data);
            } else {
                rootLogger.warn("Dropping malformed entity", {
                    entityTitle: (entity as any)?.title ?? "unknown",
                    reason: entityResult.error.issues[0]?.message,
                });
            }
        }

        return { entities: validEntities, summary };
    }

    return result.data;
}

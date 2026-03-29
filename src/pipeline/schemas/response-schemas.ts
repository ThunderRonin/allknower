import { z } from "zod";

/**
 * Zod response validation schemas for non-brain-dump LLM tasks.
 *
 * Used to validate the parsed JSON returned by the LLM before
 * passing it to the caller. When validation fails, routes return
 * a typed error shape instead of silently returning garbage.
 */

export const ConsistencyResponseSchema = z.object({
    issues: z.array(
        z.object({
            type: z.enum(["contradiction", "timeline", "orphan", "naming"]),
            severity: z.enum(["high", "medium", "low"]),
            description: z.string(),
            affectedNoteIds: z.array(z.string()),
        })
    ),
    summary: z.string(),
});

export type ConsistencyResponse = z.infer<typeof ConsistencyResponseSchema>;

export const GapDetectResponseSchema = z.object({
    gaps: z.array(
        z.object({
            area: z.string(),
            severity: z.enum(["high", "medium", "low"]),
            description: z.string(),
            suggestion: z.string(),
        })
    ),
    summary: z.string(),
});

export type GapDetectResponse = z.infer<typeof GapDetectResponseSchema>;

export const SuggestRelationsResponseSchema = z.object({
    suggestions: z.array(
        z.object({
            targetNoteId: z.string(),
            targetTitle: z.string().optional(),
            relationshipType: z.enum(["ally", "enemy", "family", "location", "event", "faction", "other"]),
            description: z.string(),
            confidence: z.enum(["high", "medium", "low"]).optional(),
        })
    ),
});

export type SuggestRelationsResponse = z.infer<typeof SuggestRelationsResponseSchema>;

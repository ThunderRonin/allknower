import { describe, expect, it } from "bun:test";
import {
    ConsistencyResponseSchema,
    GapDetectResponseSchema,
    SuggestRelationsResponseSchema,
} from "./response-schemas.ts";

// ── ConsistencyResponseSchema ─────────────────────────────────────────────────

describe("ConsistencyResponseSchema", () => {
    const validIssue = {
        type: "contradiction",
        severity: "high",
        description: "Aldric is mentioned as dead in chapter 2 but alive in chapter 5.",
        affectedNoteIds: ["note-a", "note-b"],
    };

    it("accepts valid response with issues array and summary", () => {
        const result = ConsistencyResponseSchema.safeParse({
            issues: [validIssue],
            summary: "One contradiction found.",
        });
        expect(result.success).toBe(true);
    });

    it("accepts empty issues array", () => {
        const result = ConsistencyResponseSchema.safeParse({ issues: [], summary: "No issues." });
        expect(result.success).toBe(true);
    });

    it("rejects missing summary", () => {
        const result = ConsistencyResponseSchema.safeParse({ issues: [] });
        expect(result.success).toBe(false);
    });

    it("rejects missing issues", () => {
        const result = ConsistencyResponseSchema.safeParse({ summary: "ok" });
        expect(result.success).toBe(false);
    });

    it("rejects issue with invalid type enum", () => {
        const result = ConsistencyResponseSchema.safeParse({
            issues: [{ ...validIssue, type: "miscount" }],
            summary: "x",
        });
        expect(result.success).toBe(false);
    });

    it("rejects issue with invalid severity enum", () => {
        const result = ConsistencyResponseSchema.safeParse({
            issues: [{ ...validIssue, severity: "critical" }],
            summary: "x",
        });
        expect(result.success).toBe(false);
    });

    it("rejects issue with missing affectedNoteIds", () => {
        const { affectedNoteIds: _, ...noIds } = validIssue;
        const result = ConsistencyResponseSchema.safeParse({ issues: [noIds], summary: "x" });
        expect(result.success).toBe(false);
    });

    it("accepts all valid type values", () => {
        for (const type of ["contradiction", "timeline", "orphan", "naming", "logic", "power"]) {
            const r = ConsistencyResponseSchema.safeParse({
                issues: [{ ...validIssue, type }],
                summary: "x",
            });
            expect(r.success).toBe(true);
        }
    });

    it("accepts all valid severity values", () => {
        for (const severity of ["high", "medium", "low"]) {
            const r = ConsistencyResponseSchema.safeParse({
                issues: [{ ...validIssue, severity }],
                summary: "x",
            });
            expect(r.success).toBe(true);
        }
    });
});

// ── GapDetectResponseSchema ───────────────────────────────────────────────────

describe("GapDetectResponseSchema", () => {
    const validGap = {
        area: "Character backstory",
        severity: "medium",
        description: "No origin story for Aldric.",
        suggestion: "Add a backstory note for Aldric.",
    };

    it("accepts valid response with gaps array and summary", () => {
        const result = GapDetectResponseSchema.safeParse({ gaps: [validGap], summary: "1 gap found." });
        expect(result.success).toBe(true);
    });

    it("accepts empty gaps array", () => {
        const result = GapDetectResponseSchema.safeParse({ gaps: [], summary: "No gaps." });
        expect(result.success).toBe(true);
    });

    it("rejects gap with invalid severity", () => {
        const result = GapDetectResponseSchema.safeParse({
            gaps: [{ ...validGap, severity: "critical" }],
            summary: "x",
        });
        expect(result.success).toBe(false);
    });

    it("rejects missing description or suggestion", () => {
        const { description: _, ...noDesc } = validGap;
        const r = GapDetectResponseSchema.safeParse({ gaps: [noDesc], summary: "x" });
        expect(r.success).toBe(false);
    });

    it("accepts all valid severity values", () => {
        for (const severity of ["high", "medium", "low"]) {
            const r = GapDetectResponseSchema.safeParse({
                gaps: [{ ...validGap, severity }],
                summary: "x",
            });
            expect(r.success).toBe(true);
        }
    });
});

// ── SuggestRelationsResponseSchema ────────────────────────────────────────────

describe("SuggestRelationsResponseSchema", () => {
    const validSuggestion = {
        targetNoteId: "note-target",
        targetTitle: "Aria Vale",
        relationshipType: "ally",
        description: "Aldric and Aria fought together at the Battle of Ironmark.",
        confidence: "high",
    };

    it("accepts valid response with suggestions", () => {
        const result = SuggestRelationsResponseSchema.safeParse({ suggestions: [validSuggestion] });
        expect(result.success).toBe(true);
    });

    it("accepts suggestion with optional targetTitle and confidence", () => {
        const { targetTitle: _, confidence: __, ...minimal } = validSuggestion;
        const result = SuggestRelationsResponseSchema.safeParse({ suggestions: [minimal] });
        expect(result.success).toBe(true);
    });

    it("rejects suggestion with invalid relationshipType", () => {
        const result = SuggestRelationsResponseSchema.safeParse({
            suggestions: [{ ...validSuggestion, relationshipType: "frenemy" }],
        });
        expect(result.success).toBe(false);
    });

    it("accepts all 17 valid relationshipType values", () => {
        const types = [
            "ally", "enemy", "rival", "family", "member_of", "leader_of", "serves",
            "located_in", "originates_from", "participated_in", "caused", "created",
            "owns", "wields", "worships", "inhabits", "related_to",
        ];
        for (const relationshipType of types) {
            const r = SuggestRelationsResponseSchema.safeParse({
                suggestions: [{ ...validSuggestion, relationshipType }],
            });
            expect(r.success).toBe(true);
        }
    });

    it("accepts all valid confidence values: high|medium|low", () => {
        for (const confidence of ["high", "medium", "low"]) {
            const r = SuggestRelationsResponseSchema.safeParse({
                suggestions: [{ ...validSuggestion, confidence }],
            });
            expect(r.success).toBe(true);
        }
    });

    it("confidence is optional (undefined accepted)", () => {
        const { confidence: _, ...noConf } = validSuggestion;
        const result = SuggestRelationsResponseSchema.safeParse({ suggestions: [noConf] });
        expect(result.success).toBe(true);
    });

    it("targetTitle is optional", () => {
        const { targetTitle: _, ...noTitle } = validSuggestion;
        const result = SuggestRelationsResponseSchema.safeParse({ suggestions: [noTitle] });
        expect(result.success).toBe(true);
    });
});

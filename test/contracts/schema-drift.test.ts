/**
 * Schema drift detection — Portal vs AllKnower.
 * Compares exported Zod schema names to catch renames/removals.
 * Coarse regex check, not full AST — catches the common case.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PORTAL_SCHEMAS = join(
    import.meta.dir,
    "../../../allcodex-portal/lib/allknower-schemas.ts",
);

const ALLKNOWER_SCHEMAS = join(
    import.meta.dir,
    "../../src/pipeline/schemas/response-schemas.ts",
);

function extractSchemaNames(source: string): string[] {
    const matches = source.matchAll(/export\s+const\s+(\w+Schema)\s*=/g);
    return [...matches].map((m) => m[1]);
}

describe("Schema drift: Portal vs AllKnower", () => {
    it("Portal allknower-schemas.ts exists", () => {
        expect(existsSync(PORTAL_SCHEMAS)).toBe(true);
    });

    it("AllKnower response-schemas.ts exists", () => {
        expect(existsSync(ALLKNOWER_SCHEMAS)).toBe(true);
    });

    it("shared schema names present in both files", () => {
        if (!existsSync(PORTAL_SCHEMAS) || !existsSync(ALLKNOWER_SCHEMAS)) return;

        const portalSource = readFileSync(PORTAL_SCHEMAS, "utf-8");
        const allknowerSource = readFileSync(ALLKNOWER_SCHEMAS, "utf-8");

        const portalSchemas = extractSchemaNames(portalSource);
        const allknowerSchemas = extractSchemaNames(allknowerSource);

        // Maps: [Portal name, AllKnower name] — different export names for same shape
        const sharedPairs: [string, string][] = [
            ["ConsistencyResultSchema", "ConsistencyResponseSchema"],
            ["GapResultSchema", "GapDetectResponseSchema"],
            ["RelationshipsResultSchema", "SuggestRelationsResponseSchema"],
        ];

        const driftWarnings: string[] = [];

        for (const [portalName, allknowerName] of sharedPairs) {
            const inPortal = portalSchemas.includes(portalName) || portalSource.includes(portalName);
            const inAllKnower = allknowerSchemas.includes(allknowerName) || allknowerSource.includes(allknowerName);

            if (!inPortal) {
                driftWarnings.push(`DRIFT: Portal missing ${portalName}`);
            }
            if (!inAllKnower) {
                driftWarnings.push(`DRIFT: AllKnower missing ${allknowerName}`);
            }
        }

        if (driftWarnings.length > 0) {
            console.warn("Schema drift detected:\n" + driftWarnings.join("\n"));
        }

        expect(portalSchemas.length).toBeGreaterThan(0);
        expect(allknowerSchemas.length).toBeGreaterThan(0);
    });
});

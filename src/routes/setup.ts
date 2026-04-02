import Elysia from "elysia";
import { createNote, createAttribute, tagNote } from "../etapi/client.ts";
import { TEMPLATE_ID_MAP } from "../types/lore.ts";

/**
 * Promoted attribute definitions for each lore template.
 *
 * In Trilium, a promoted attribute on a template note is defined by adding a
 * label named `label:FIELDNAME` with value `promoted,TYPE` to the template note
 * itself. This causes Trilium to render a structured form on any note that links
 * to the template via a `~template` relation.
 */
type PromotedField = { name: string; valueType: "text" | "number" | "boolean" | "url" | "date" };

const TEMPLATE_FIELDS: Record<keyof typeof TEMPLATE_ID_MAP, PromotedField[]> = {
    character: [
        { name: "fullName",           valueType: "text"   },
        { name: "age",                valueType: "text"   },
        { name: "race",               valueType: "text"   },
        { name: "gender",             valueType: "text"   },
        { name: "affiliation",        valueType: "text"   },
        { name: "role",               valueType: "text"   },
        { name: "status",             valueType: "text"   },
    ],
    location: [
        { name: "locationType",       valueType: "text"   },
        { name: "region",             valueType: "text"   },
        { name: "population",         valueType: "text"   },
        { name: "ruler",              valueType: "text"   },
    ],
    faction: [
        { name: "factionType",        valueType: "text"   },
        { name: "leader",             valueType: "text"   },
        { name: "foundingDate",       valueType: "text"   },
    ],
    creature: [
        { name: "creatureType",       valueType: "text"   },
        { name: "habitat",            valueType: "text"   },
        { name: "dangerLevel",        valueType: "text"   },
        { name: "ac",                 valueType: "text"   },
        { name: "hp",                 valueType: "text"   },
        { name: "cr",                 valueType: "text"   },
    ],
    event: [
        { name: "inWorldDate",        valueType: "text"   },
        { name: "location",           valueType: "text"   },
        { name: "outcome",            valueType: "text"   },
    ],
    timeline: [
        { name: "startDate",          valueType: "text"   },
        { name: "endDate",            valueType: "text"   },
    ],
    manuscript: [
        { name: "wordCount",          valueType: "number" },
        { name: "status",             valueType: "text"   },
    ],
    statblock: [
        { name: "system",             valueType: "text"   },
        { name: "ac",                 valueType: "text"   },
        { name: "hp",                 valueType: "text"   },
        { name: "speed",              valueType: "text"   },
        { name: "cr",                 valueType: "text"   },
        { name: "str",                valueType: "number" },
        { name: "dex",                valueType: "number" },
        { name: "con",                valueType: "number" },
        { name: "int",                valueType: "number" },
        { name: "wis",                valueType: "number" },
        { name: "cha",                valueType: "number" },
    ],
    item: [
        { name: "itemType",           valueType: "text"   },
        { name: "rarity",             valueType: "text"   },
        { name: "creator",            valueType: "text"   },
        { name: "magicProperties",    valueType: "text"   },
        { name: "currentOwner",       valueType: "text"   },
    ],
    spell: [
        { name: "school",             valueType: "text"   },
        { name: "level",              valueType: "text"   },
        { name: "castingTime",        valueType: "text"   },
        { name: "range",              valueType: "text"   },
        { name: "components",         valueType: "text"   },
        { name: "duration",           valueType: "text"   },
    ],
    building: [
        { name: "buildingType",       valueType: "text"   },
        { name: "owner",              valueType: "text"   },
        { name: "purpose",            valueType: "text"   },
        { name: "condition",          valueType: "text"   },
        { name: "location",           valueType: "text"   },
    ],
    language: [
        { name: "languageFamily",     valueType: "text"   },
        { name: "speakers",           valueType: "text"   },
        { name: "script",             valueType: "text"   },
        { name: "samplePhrase",       valueType: "text"   },
    ],
    organization: [
        { name: "orgType",            valueType: "text"   },
        { name: "purpose",            valueType: "text"   },
        { name: "leader",             valueType: "text"   },
        { name: "headquarters",       valueType: "text"   },
        { name: "status",             valueType: "text"   },
    ],
    race: [
        { name: "racialType",         valueType: "text"   },
        { name: "homeland",           valueType: "text"   },
        { name: "lifespan",           valueType: "text"   },
        { name: "culture",            valueType: "text"   },
    ],
    myth: [
        { name: "mythType",           valueType: "text"   },
        { name: "origin",             valueType: "text"   },
        { name: "significance",       valueType: "text"   },
    ],
    cosmology: [
        { name: "domain",             valueType: "text"   },
        { name: "source",             valueType: "text"   },
    ],
    deity: [
        { name: "domains",            valueType: "text"   },
        { name: "alignment",          valueType: "text"   },
        { name: "rank",               valueType: "text"   },
        { name: "symbol",             valueType: "text"   },
    ],
    religion: [
        { name: "deity",              valueType: "text"   },
        { name: "pantheon",           valueType: "text"   },
        { name: "clergy",             valueType: "text"   },
        { name: "headquarters",       valueType: "text"   },
    ],
    session: [
        { name: "sessionDate",        valueType: "date"   },
        { name: "sessionStatus",      valueType: "text"   },
        { name: "players",            valueType: "text"   },
        { name: "recap",              valueType: "text"   },
    ],
    quest: [
        { name: "questStatus",        valueType: "text"   },
        { name: "questGiver",         valueType: "text"   },
        { name: "reward",             valueType: "text"   },
        { name: "location",           valueType: "text"   },
    ],
    scene: [
        { name: "location",           valueType: "text"   },
        { name: "participants",        valueType: "text"   },
        { name: "outcome",            valueType: "text"   },
        { name: "gmNotes",            valueType: "text"   },
    ],
};

// Human-readable titles for each template note
const TEMPLATE_TITLES: Record<keyof typeof TEMPLATE_ID_MAP, string> = {
    character:  "Lore Template — Character",
    location:   "Lore Template — Location",
    faction:    "Lore Template — Faction",
    creature:   "Lore Template — Creature",
    event:      "Lore Template — Event",
    timeline:   "Lore Template — Timeline",
    manuscript: "Lore Template — Manuscript",
    statblock:  "Lore Template — Statblock",
    item:       "Lore Template — Item / Artifact",
    spell:      "Lore Template — Spell / Magic",
    building:   "Lore Template — Building / Structure",
    language:   "Lore Template — Language / Script",
    organization: "Lore Template — Organization",
    race:         "Lore Template — Race / Species",
    myth:         "Lore Template — Myth / Legend",
    cosmology:    "Lore Template — Cosmology",
    deity:        "Lore Template — Deity",
    religion:     "Lore Template — Religion",
    session:      "Lore Template — Session",
    quest:        "Lore Template — Quest",
    scene:        "Lore Template — Scene",
};

const CONTAINER_NOTE_ID = "_lore_templates_container";

export const setupRoute = new Elysia({ prefix: "/setup" })
    /**
     * POST /setup/seed-templates
     *
     * Creates all lore template notes in AllCodex with the exact IDs that
     * TEMPLATE_ID_MAP references. Safe to call multiple times — already-existing
     * templates are reported as skipped rather than causing errors.
     */
    .post(
        "/seed-templates",
        async () => {
            const results: { type: string; noteId: string; status: "created" | "already_exists" | "error"; error?: string }[] = [];

            // 1. Ensure the container note exists
            try {
                await createNote({
                    noteId: CONTAINER_NOTE_ID,
                    parentNoteId: "root",
                    title: "Lore Templates",
                    type: "text",
                    content: "<p>AllKnower-managed lore template notes. Do not delete.</p>",
                });
                await tagNote(CONTAINER_NOTE_ID, "loreTemplates");
            } catch {
                // Already exists — that's fine
            }

            // 2. Create each template note
            for (const [type, noteId] of Object.entries(TEMPLATE_ID_MAP) as [keyof typeof TEMPLATE_ID_MAP, string][]) {
                try {
                    await createNote({
                        noteId,
                        parentNoteId: CONTAINER_NOTE_ID,
                        title: TEMPLATE_TITLES[type],
                        type: "text",
                        content: "",
                    });

                    // Mark as a Trilium template
                    await tagNote(noteId, "template");

                    // Add promoted attribute definitions so Trilium renders a form
                    for (const field of TEMPLATE_FIELDS[type]) {
                        await createAttribute({
                            noteId,
                            type: "label",
                            name: `label:${field.name}`,
                            value: `promoted,${field.valueType}`,
                        });
                    }

                    results.push({ type, noteId, status: "created" });
                } catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : String(e);
                    // ETAPI returns 400 with NOTE_ALREADY_EXISTS or similar when noteId is taken
                    if (msg.includes("already") || msg.includes("400") || msg.includes("exists")) {
                        results.push({ type, noteId, status: "already_exists" });
                    } else {
                        results.push({ type, noteId, status: "error", error: msg });
                    }
                }
            }

            const created = results.filter((r) => r.status === "created").length;
            const skipped = results.filter((r) => r.status === "already_exists").length;
            const failed  = results.filter((r) => r.status === "error").length;

            return {
                summary: `${created} created, ${skipped} already existed, ${failed} failed`,
                results,
            };
        },
        {
            detail: {
                summary: "Seed lore templates in AllCodex",
                description:
                    "Creates Trilium template notes with promoted attributes for each lore type. " +
                    "Idempotent — safe to call multiple times. Requires auth.",
                tags: ["System"],
            },
        }
    );

import { Elysia, t } from "elysia";
import {
    createNote,
    setNoteTemplate,
    tagNote,
    getAllCodexNotes,
} from "../etapi/client.ts";
import { rootLogger } from "../logger.ts";
import { importAzgaarMap, isAzgaarMapData, getMapPreview } from "../pipeline/azgaar.ts";
import { requireAuth } from "../plugins/auth-guard.ts";

const StatblockEntrySchema = t.Object({
    name: t.String(),
    cr: t.Optional(t.Union([t.String(), t.Number()])),
    type: t.Optional(t.String()),
    size: t.Optional(t.String()),
    alignment: t.Optional(t.String()),
    ac: t.Optional(t.Union([t.Number(), t.String()])),
    hp: t.Optional(t.Union([t.Number(), t.String()])),
    speed: t.Optional(t.String()),
    str: t.Optional(t.Union([t.Number(), t.String()])),
    dex: t.Optional(t.Union([t.Number(), t.String()])),
    con: t.Optional(t.Union([t.Number(), t.String()])),
    int: t.Optional(t.Union([t.Number(), t.String()])),
    wis: t.Optional(t.Union([t.Number(), t.String()])),
    cha: t.Optional(t.Union([t.Number(), t.String()])),
    immunities: t.Optional(t.String()),
    resistances: t.Optional(t.String()),
    vulnerabilities: t.Optional(t.String()),
    abilities: t.Optional(t.String()),
    actions: t.Optional(t.String()),
    legendaryActions: t.Optional(t.String()),
    content: t.Optional(t.String()),
});

type StatblockEntry = typeof StatblockEntrySchema.static;

const ATTR_MAP: Array<[keyof StatblockEntry, string]> = [
    ["cr", "challengeRating"],
    ["type", "creatureType"],
    ["size", "size"],
    ["alignment", "alignment"],
    ["ac", "ac"],
    ["hp", "hp"],
    ["speed", "speed"],
    ["str", "str"],
    ["dex", "dex"],
    ["con", "con"],
    ["int", "int"],
    ["wis", "wis"],
    ["cha", "cha"],
    ["immunities", "immunities"],
    ["resistances", "resistances"],
    ["vulnerabilities", "vulnerabilities"],
    ["abilities", "abilities"],
    ["actions", "actions"],
    ["legendaryActions", "legendaryActions"],
];

export function createImportRoute({ requireAuthImpl = requireAuth }: { requireAuthImpl?: typeof requireAuth } = {}) {
    return new Elysia({ name: "import" })
    .use(requireAuthImpl)
    .post(
        "/import/system-pack",
        async ({ body }) => {
            const { notes, parentNoteId = "root", skipDuplicates = true } = body;

            if (!Array.isArray(notes) || notes.length === 0) {
                return new Response(JSON.stringify({ error: "notes array is required and must not be empty", code: "INVALID_INPUT" }), {
                    status: 400, headers: { "Content-Type": "application/json" },
                });
            }

            // Build existing title set if skipDuplicates is on
            let existingTitles = new Set<string>();
            if (skipDuplicates) {
                try {
                    const existing = await getAllCodexNotes("#statblock");
                    for (const n of existing) {
                        if (n.title) existingTitles.add(n.title.toLowerCase().trim());
                    }
                } catch {
                    // Non-fatal — continue without duplicate check
                }
            }

            const results = {
                created: [] as Array<{ noteId: string; name: string }>,
                skipped: [] as Array<{ name: string; reason: string }>,
                errors: [] as Array<{ name: string; error: string }>,
            };

            for (const entry of notes) {
                const name = entry.name?.trim();
                if (!name) {
                    results.errors.push({ name: "(unnamed)", error: "Missing name" });
                    continue;
                }

                if (skipDuplicates && existingTitles.has(name.toLowerCase())) {
                    results.skipped.push({ name, reason: "duplicate" });
                    continue;
                }

                try {
                    // Create the note
                    const note = await createNote({
                        parentNoteId,
                        title: name,
                        type: "text",
                        content: entry.content ?? "",
                    });

                    const noteId = note.note.noteId;

                    // Apply statblock template
                    await setNoteTemplate(noteId, "_template_statblock");

                    // Set crName promoted attribute (name as statblock name field)
                    await tagNote(noteId, "crName", name);

                    // Set #statblock label
                    await tagNote(noteId, "statblock", "");

                    // Set #importSource
                    await tagNote(noteId, "importSource", "system-pack");

                    // Map other attributes
                    for (const [key, attrName] of ATTR_MAP) {
                        const val = entry[key];
                        if (val !== undefined && val !== null && val !== "") {
                            await tagNote(noteId, attrName, String(val));
                        }
                    }

                    results.created.push({ noteId, name });
                    rootLogger.info("system-pack: created statblock note", { noteId, name });
                } catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : String(e);
                    rootLogger.error("system-pack: failed to create note", { name, error: msg });
                    results.errors.push({ name, error: msg });
                }
            }

            return {
                created: results.created.length,
                skipped: results.skipped.length,
                errors: results.errors.length,
                detail: results,
            };
        },
        {
            body: t.Object({
                notes: t.Array(StatblockEntrySchema),
                parentNoteId: t.Optional(t.String()),
                skipDuplicates: t.Optional(t.Boolean()),
            }),
            detail: {
                tags: ["Brain Dump"],
                summary: "Import a system pack of statblocks",
                description:
                    "Accepts a JSON array of statblock objects and creates AllCodex notes with #statblock labels. Useful for importing SRD monsters, items, or spells in bulk.",
            },
        }
    )
    // ── Azgaar Map Import ─────────────────────────────────────────────────────
    .get(
        "/import/azgaar/preview",
        async ({ query }) => {
            const { url } = query;
            if (!url) return new Response(JSON.stringify({ error: "url query parameter is required", code: "INVALID_INPUT" }), {
                status: 400, headers: { "Content-Type": "application/json" },
            });
            return new Response(JSON.stringify({ error: "Preview via URL not supported. Use POST /import/azgaar with mapData.", code: "NOT_IMPLEMENTED" }), {
                status: 501, headers: { "Content-Type": "application/json" },
            });
        },
        {
            query: t.Object({ url: t.Optional(t.String()) }),
            detail: { tags: ["Import"], summary: "Azgaar map preview (stub)" },
        }
    )
    .post(
        "/import/azgaar/preview",
        async ({ body }) => {
            const { mapData } = body;
            if (!isAzgaarMapData(mapData)) {
                return new Response(JSON.stringify({
                    error: "Uploaded data does not look like an Azgaar FMG export. Expected pack.burgs or pack.states arrays.",
                    code: "INVALID_FORMAT",
                }), { status: 400, headers: { "Content-Type": "application/json" } });
            }
            return getMapPreview(mapData);
        },
        {
            body: t.Object({
                mapData: t.Any(),
            }),
            detail: {
                tags: ["Import"],
                summary: "Preview an Azgaar map export",
                description: "Returns entity counts without creating any notes. Use this to show the user what will be imported.",
            },
        }
    )
    .post(
        "/import/azgaar",
        async ({ body }) => {
            const { mapData, parentNoteId, options } = body;

            if (!isAzgaarMapData(mapData)) {
                return new Response(JSON.stringify({
                    error: "Uploaded data does not look like an Azgaar FMG export. Expected pack.burgs or pack.states arrays.",
                    code: "INVALID_FORMAT",
                }), { status: 400, headers: { "Content-Type": "application/json" } });
            }

            try {
                const result = await importAzgaarMap(mapData, {
                    parentNoteId: parentNoteId ?? "root",
                    importStates: options?.importStates ?? true,
                    importBurgs: options?.importBurgs ?? true,
                    importReligions: options?.importReligions ?? true,
                    importCultures: options?.importCultures ?? true,
                    importNotes: options?.importNotes ?? true,
                    skipDuplicates: options?.skipDuplicates ?? true,
                });
                return result;
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                rootLogger.error("azgaar import route: unexpected error", { error: msg });
                return new Response(JSON.stringify({ error: msg, code: "IMPORT_ERROR" }), {
                    status: 500, headers: { "Content-Type": "application/json" },
                });
            }
        },
        {
            body: t.Object({
                mapData: t.Any(),
                parentNoteId: t.Optional(t.String()),
                options: t.Optional(
                    t.Object({
                        importStates: t.Optional(t.Boolean()),
                        importBurgs: t.Optional(t.Boolean()),
                        importReligions: t.Optional(t.Boolean()),
                        importCultures: t.Optional(t.Boolean()),
                        importNotes: t.Optional(t.Boolean()),
                        skipDuplicates: t.Optional(t.Boolean()),
                    })
                ),
            }),
            detail: {
                tags: ["Import"],
                summary: "Import an Azgaar Fantasy Map Generator export",
                description:
                    "Accepts an Azgaar FMG JSON export and creates AllCodex lore notes: states → factions, burgs → locations, religions → religions, cultures → races, map notes → locations. Existing notes with matching names are skipped when skipDuplicates is true.",
            },
        }
    );
}

export const importRoute = createImportRoute();

/**
 * Azgaar Fantasy Map Generator — import pipeline
 *
 * Parses an Azgaar FMG JSON export (.map exported as JSON or inline) and maps
 * its data entities to AllCodex notes with appropriate lore templates.
 *
 * Data model ref: https://github.com/Azgaar/Fantasy-Map-Generator/wiki/Data-model
 *
 * Supported entity types and their template mappings:
 *   - states    → _template_faction   (nations, kingdoms, empires)
 *   - burgs     → _template_location  (cities, towns, settlements)
 *   - religions → _template_religion
 *   - cultures  → _template_race
 *   - notes     → _template_location  (map notes / POI)
 *
 * Notes on the data model:
 *   - Array element 0 is always empty/reserved in Azgaar arrays — we skip i === 0.
 *   - Removed entities keep their array slot but gain `removed: true` — we skip them.
 *   - `capital` and `port` on a burg are numbers (1 = true, 0 = false), not booleans.
 *   - `population` is in population points (1 pt = 1000 people at default rate).
 */

import {
    createNote,
    setNoteTemplate,
    tagNote,
    getAllCodexNotes,
} from "../etapi/client.ts";
import { rootLogger } from "../logger.ts";

const log = rootLogger.child({ source: "azgaar" });

// ── Azgaar JSON shape (partial — only fields we consume) ──────────────────────

interface AzgaarBurg {
    i: number;
    name: string;
    cell?: number;
    x?: number;
    y?: number;
    culture?: number;
    state?: number;
    feature?: number;
    population?: number;   // population points; multiply by populationRate (default 1000)
    type?: string;         // culture type string (e.g. "City")
    capital?: number;      // 1 if this burg is a state capital, 0 otherwise
    port?: number;         // harbor score; >0 means port
    citadel?: number;      // 1 if burg has a citadel/castle
    plaza?: number;        // 1 if burg has a market plaza
    walls?: number;        // 1 if burg has walls
    shanty?: number;       // 1 if burg has a shanty town
    removed?: boolean;
}

interface AzgaarState {
    i: number;
    name: string;
    fullName?: string;     // full government name e.g. "Kingdom of Valdoria"
    form?: string;         // short form abbreviation e.g. "Kingdom"
    formName?: string;     // government form full name e.g. "Monarchy"
    capital?: number;      // burg index of the capital city
    color?: string;
    removed?: boolean;
}

interface AzgaarCulture {
    i: number;
    name: string;
    type?: string;         // e.g. "Generic", "Nomadic", "Hunting", "Highland"
    shield?: string;
    base?: number;
    origins?: number[];
    removed?: boolean;
}

interface AzgaarReligion {
    i: number;
    name: string;
    faith?: string;        // denomination/faith name
    form?: string;         // e.g. "Organized", "Cult", "Heresy"
    type?: string;         // e.g. "Folk", "State"
    deity?: string;        // chief deity name
    origins?: number[];
    removed?: boolean;
}

interface AzgaarNote {
    id: string;
    name: string;
    legend?: string;       // HTML body of the note
}

interface AzgaarPack {
    burgs?: AzgaarBurg[];
    states?: AzgaarState[];
    cultures?: AzgaarCulture[];
    religions?: AzgaarReligion[];
}

// Azgaar default population rate (1 population point = 1000 people)
const DEFAULT_POP_RATE = 1000;

export interface AzgaarMapData {
    info?: { version?: string; mapName?: string; description?: string };
    settings?: { mapName?: string };
    pack?: AzgaarPack;
    notes?: AzgaarNote[];
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface AzgaarImportOptions {
    parentNoteId?: string;
    importStates?: boolean;
    importBurgs?: boolean;
    importReligions?: boolean;
    importCultures?: boolean;
    importNotes?: boolean;
    skipDuplicates?: boolean;
}

// ── Result ────────────────────────────────────────────────────────────────────

type ImportResultEntry = { noteId: string; name: string };
type SkippedEntry = { name: string; reason: string };
type ErrorEntry = { name: string; error: string };

export interface AzgaarImportResult {
    mapName: string;
    states: { created: ImportResultEntry[]; skipped: SkippedEntry[]; errors: ErrorEntry[] };
    burgs: { created: ImportResultEntry[]; skipped: SkippedEntry[]; errors: ErrorEntry[] };
    religions: { created: ImportResultEntry[]; skipped: SkippedEntry[]; errors: ErrorEntry[] };
    cultures: { created: ImportResultEntry[]; skipped: SkippedEntry[]; errors: ErrorEntry[] };
    notes: { created: ImportResultEntry[]; skipped: SkippedEntry[]; errors: ErrorEntry[] };
    totals: { created: number; skipped: number; errors: number };
}

function emptyBucket() {
    return { created: [] as ImportResultEntry[], skipped: [] as SkippedEntry[], errors: [] as ErrorEntry[] };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function buildExistingSet(label: string): Promise<Set<string>> {
    const existing = new Set<string>();
    try {
        const notes = await getAllCodexNotes(`#${label}`);
        for (const n of notes) {
            if (n.title) existing.add(n.title.toLowerCase().trim());
        }
    } catch {
        // Non-fatal — continue without dedup
    }
    return existing;
}

async function safeMakeNote(
    parentNoteId: string,
    title: string,
    content: string,
    templateId: string,
    labels: Array<[string, string]>,
    bucket: { created: ImportResultEntry[]; skipped: SkippedEntry[]; errors: ErrorEntry[] },
    existing: Set<string>,
    skipDuplicates: boolean
) {
    const key = title.toLowerCase().trim();
    if (skipDuplicates && existing.has(key)) {
        bucket.skipped.push({ name: title, reason: "duplicate" });
        return;
    }

    try {
        const note = await createNote({ parentNoteId, title, type: "text", content });
        const noteId = note.note.noteId;

        if (templateId) await setNoteTemplate(noteId, templateId);

        for (const [name, value] of labels) {
            await tagNote(noteId, name, value);
        }

        bucket.created.push({ noteId, name: title });
        existing.add(key);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        bucket.errors.push({ name: title, error: msg });
        log.error("azgaar: failed to create note", { title, error: msg });
    }
}

// ── Validators ────────────────────────────────────────────────────────────────

/**
 * Checks whether an object looks like a valid Azgaar FMG JSON export.
 * Azgaar exports always have a `pack` key with at least one sub-array.
 */
export function isAzgaarMapData(obj: unknown): obj is AzgaarMapData {
    if (!obj || typeof obj !== "object") return false;
    const o = obj as Record<string, unknown>;
    // Azgaar exports always have a `pack` object with at least one entity array.
    // The `info` or `settings` key with mapName/description is also a reliable signal.
    if (typeof o["pack"] !== "object" || !o["pack"]) return false;
    const pack = o["pack"] as Record<string, unknown>;
    return Array.isArray(pack["burgs"]) || Array.isArray(pack["states"]) || Array.isArray(pack["religions"]);
}

export function getMapPreview(map: AzgaarMapData) {
    const pack = map.pack ?? {};
    const mapName = map.info?.mapName ?? map.settings?.mapName ?? "Unnamed Map";
    // Filter i > 0 (slot 0 is reserved) and skip removed entries
    return {
        mapName,
        stateCnt: (pack.states ?? []).filter((s) => s.i > 0 && !s.removed).length,
        burgCnt: (pack.burgs ?? []).filter((b) => b.i > 0 && !b.removed).length,
        religionCnt: (pack.religions ?? []).filter((r) => r.i > 0 && !r.removed).length,
        cultureCnt: (pack.cultures ?? []).filter((c) => c.i > 0 && !c.removed).length,
        noteCnt: (map.notes ?? []).length,
    };
}

// ── Main import function ──────────────────────────────────────────────────────

export async function importAzgaarMap(
    mapData: AzgaarMapData,
    opts: AzgaarImportOptions = {}
): Promise<AzgaarImportResult> {
    const {
        parentNoteId = "root",
        importStates = true,
        importBurgs = true,
        importReligions = true,
        importCultures = true,
        importNotes = true,
        skipDuplicates = true,
    } = opts;

    const mapName = mapData.info?.mapName ?? mapData.settings?.mapName ?? "Azgaar Map";
    const pack = mapData.pack ?? {};

    const result: AzgaarImportResult = {
        mapName,
        states: emptyBucket(),
        burgs: emptyBucket(),
        religions: emptyBucket(),
        cultures: emptyBucket(),
        notes: emptyBucket(),
        totals: { created: 0, skipped: 0, errors: 0 },
    };

    // Build lookup maps for cross-referencing names across entities
    const stateNameById = new Map<number, string>();
    for (const s of pack.states ?? []) {
        if (s.i > 0 && !s.removed && s.name?.trim()) {
            stateNameById.set(s.i, s.fullName ?? s.name);
        }
    }
    const cultureNameById = new Map<number, string>();
    for (const c of pack.cultures ?? []) {
        if (c.i > 0 && !c.removed && c.name?.trim()) {
            cultureNameById.set(c.i, c.name);
        }
    }
    const burgNameById = new Map<number, string>();
    for (const b of pack.burgs ?? []) {
        if (b.i > 0 && !b.removed && b.name?.trim()) {
            burgNameById.set(b.i, b.name);
        }
    }

    // --- States (Kingdoms, Empires → _template_faction) ----------------------
    if (importStates) {
        const existing = skipDuplicates ? await buildExistingSet("faction") : new Set<string>();
        const states = (pack.states ?? []).filter((s) => s.i > 0 && !s.removed && s.name?.trim());

        for (const state of states) {
            // Use fullName when distinct (e.g. "Kingdom of Valdoria") as note title
            const title = (state.fullName && state.fullName !== state.name)
                ? state.fullName
                : state.name;
            const labels: Array<[string, string]> = [
                ["faction", ""],
                ["importSource", "azgaar"],
            ];
            if (state.form) labels.push(["factionType", state.form]);
            if (state.formName) labels.push(["government", state.formName]);
            const capitalBurg = state.capital != null ? burgNameById.get(state.capital) : undefined;
            if (capitalBurg) labels.push(["capital", capitalBurg]);

            const govLine = state.formName ? ` (${state.formName})` : "";
            await safeMakeNote(
                parentNoteId,
                title,
                `<p><strong>${title}</strong>${govLine} — imported from Azgaar map "${mapName}".</p>`,
                "_template_faction",
                labels,
                result.states,
                existing,
                skipDuplicates
            );
        }
    }

    // --- Burgs (Cities, Towns → _template_location) --------------------------
    if (importBurgs) {
        const existing = skipDuplicates ? await buildExistingSet("location") : new Set<string>();
        // Skip i === 0 (reserved) and removed burgs
        const burgs = (pack.burgs ?? []).filter((b) => b.i > 0 && !b.removed && b.name?.trim());

        for (const burg of burgs) {
            // capital/port are numeric flags (1 = true) per the FMG data model
            const isCapital = burg.capital === 1;
            const isPort = (burg.port ?? 0) > 0;
            const hasCitadel = burg.citadel === 1;
            const hasWalls = burg.walls === 1;

            let locationType: string;
            if (isCapital) locationType = "Capital";
            else if (isPort) locationType = "Port";
            else locationType = burg.type ?? "Settlement";

            const labels: Array<[string, string]> = [
                ["location", ""],
                ["locationType", locationType],
                ["importSource", "azgaar"],
            ];

            // Population: Azgaar stores in pop points (default 1 pt = 1000 people)
            if (burg.population != null && burg.population > 0) {
                const actualPop = Math.round(burg.population * DEFAULT_POP_RATE);
                labels.push(["population", actualPop.toLocaleString("en-US")]);
            }

            const stateName = burg.state != null ? stateNameById.get(burg.state) : undefined;
            if (stateName) labels.push(["region", stateName]);

            const cultureName = burg.culture != null ? cultureNameById.get(burg.culture) : undefined;
            if (cultureName) labels.push(["culture", cultureName]);

            const traits: string[] = [];
            if (isCapital) traits.push("capital");
            if (isPort) traits.push("port");
            if (hasCitadel) traits.push("citadel");
            if (hasWalls) traits.push("walled");

            const contentParts = [`<strong>${burg.name}</strong> — ${locationType.toLowerCase()}`];
            if (stateName) contentParts.push(` in ${stateName}`);
            if (traits.length) contentParts.push(` (${traits.join(", ")})`);
            contentParts.push(`. Imported from Azgaar map "${mapName}".`);

            await safeMakeNote(
                parentNoteId,
                burg.name,
                `<p>${contentParts.join("")}</p>`,
                "_template_location",
                labels,
                result.burgs,
                existing,
                skipDuplicates
            );
        }
    }

    // --- Religions (→ _template_religion) ------------------------------------
    if (importReligions) {
        const existing = skipDuplicates ? await buildExistingSet("religion") : new Set<string>();
        const religions = (pack.religions ?? []).filter((r) => r.i > 0 && !r.removed && r.name?.trim());

        for (const rel of religions) {
            const labels: Array<[string, string]> = [
                ["religion", ""],
                ["importSource", "azgaar"],
            ];
            // `faith` is the denomination name (may differ from the religion name)
            if (rel.faith && rel.faith !== rel.name) labels.push(["faith", rel.faith]);
            // `form` = "Organized", "Cult", "Heresy", etc.
            if (rel.form) labels.push(["faithForm", rel.form]);
            // `type` = "Folk", "State", etc.
            if (rel.type) labels.push(["faithType", rel.type]);
            if (rel.deity) labels.push(["deity", rel.deity]);

            const descParts = [rel.faith ?? rel.name];
            if (rel.form) descParts.push(rel.form);
            if (rel.deity) descParts.push(`deity: ${rel.deity}`);

            await safeMakeNote(
                parentNoteId,
                rel.name,
                `<p><strong>${rel.name}</strong> — ${descParts.join(", ")}. Imported from Azgaar map "${mapName}".</p>`,
                "_template_religion",
                labels,
                result.religions,
                existing,
                skipDuplicates
            );
        }
    }

    // --- Cultures (→ _template_race) -----------------------------------------
    if (importCultures) {
        const existing = skipDuplicates ? await buildExistingSet("race") : new Set<string>();
        const cultures = (pack.cultures ?? []).filter((c) => c.i > 0 && !c.removed && c.name?.trim());

        for (const culture of cultures) {
            const labels: Array<[string, string]> = [
                ["race", ""],
                ["importSource", "azgaar"],
            ];
            // `type` = "Generic", "Nomadic", "Hunting", "Highland", etc.
            if (culture.type) labels.push(["cultureType", culture.type]);

            const typeLine = culture.type ? ` (${culture.type})` : "";
            await safeMakeNote(
                parentNoteId,
                culture.name,
                `<p><strong>${culture.name}</strong>${typeLine} culture — imported from Azgaar map "${mapName}".</p>`,
                "_template_race",
                labels,
                result.cultures,
                existing,
                skipDuplicates
            );
        }
    }

    // --- Map Notes (POI / annotations → _template_location) ------------------
    if (importNotes) {
        const existing = skipDuplicates ? await buildExistingSet("location") : new Set<string>();
        const mapNotes = (mapData.notes ?? []).filter((n) => n.name?.trim());

        for (const mn of mapNotes) {
            const labels: Array<[string, string]> = [
                ["location", ""],
                ["locationType", "Point of Interest"],
                ["importSource", "azgaar"],
            ];

            // `legend` is raw HTML from the FMG notes editor — use directly as note content
            const content = mn.legend?.trim()
                ? mn.legend
                : `<p>Map note "${mn.name}" imported from Azgaar map "${mapName}".</p>`;

            await safeMakeNote(
                parentNoteId,
                mn.name,
                content,
                "_template_location",
                labels,
                result.notes,
                existing,
                skipDuplicates
            );
        }
    }

    // --- Totals ---------------------------------------------------------------
    const all = [result.states, result.burgs, result.religions, result.cultures, result.notes];
    result.totals.created = all.reduce((acc, b) => acc + b.created.length, 0);
    result.totals.skipped = all.reduce((acc, b) => acc + b.skipped.length, 0);
    result.totals.errors = all.reduce((acc, b) => acc + b.errors.length, 0);

    log.info("azgaar: import complete", {
        mapName,
        created: result.totals.created,
        skipped: result.totals.skipped,
        errors: result.totals.errors,
    });

    return result;
}

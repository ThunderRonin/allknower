# AllKnower: Remaining Features

Three features left to implement: relation writing, auto-apply, and Azgaar import.

---

## Feature 1: Relation Writing Back to AllCodex

**What:** `POST /suggest/relationships` returns JSON suggestions but never writes anything to AllCodex. We need an endpoint that persists approved suggestions as Trilium `relation` attributes.

**Why:** Without this, suggestions are read-only. The user has to manually create relation links in AllCodex, which defeats the point.

### Route

```
POST /suggest/relationships/apply
```

### Request Body

```json
{
  "sourceNoteId": "abc123",
  "relations": [
    {
      "targetNoteId": "def456",
      "relationshipType": "ally",
      "description": "Fought together at the Battle of Halitusech"
    }
  ]
}
```

### Implementation Steps

- [x] **1a.** Add `createRelation` helper to `src/etapi/client.ts` — wraps `createAttribute` with `type: "relation"` and applies a naming convention (e.g. `relAlly`, `relEnemy`, `relFamily`, `relLocation`, `relEvent`, `relFaction`, `relOther`). Also writes the description as a `#relationNote` label on the source note for context.

- [x] **1b.** Create `POST /suggest/relationships/apply` in `src/routes/suggest.ts`:
  1. Validate body (sourceNoteId + array of relations)
  2. For each relation, call `createRelation(sourceNoteId, targetNoteId, relationshipType)` via ETAPI
  3. Optionally create the inverse relation on the target note (e.g. if A is `relAlly` of B, then B gets `relAlly` of A). Bidirectional by default, controlled by a `bidirectional: boolean` body param (default `true`)
  4. Return `{ applied: [...], failed: [...] }`

- [x] **1c.** Add Zod validation schemas to `src/types/lore.ts`:
  - `RelationshipTypeSchema` — enum of `ally | enemy | family | location | event | faction | other`
  - `ApplyRelationBodySchema` — the request body shape

- [x] **1d.** Add a `relation_history` table to Prisma schema to log applied relations (sourceNoteId, targetNoteId, type, description, createdAt). This enables undo and audit.

### Files Touched

| File | Change |
|---|---|
| `src/etapi/client.ts` | Add `createRelation()` helper |
| `src/routes/suggest.ts` | Add `POST /relationships/apply` |
| `src/types/lore.ts` | Add schemas |
| `prisma/schema.prisma` | Add `RelationHistory` model |

---

## Feature 2: Auto-Applying Suggested Relations

**What:** After brain dump creates new notes, automatically run the relationship suggester and apply high-confidence results without user intervention.

**Why:** Right now the user has to manually call `/suggest/relationships` after every brain dump, then separately call `/apply`. Auto-apply closes the loop so brain dump, note creation, and relation linking all happen in one request.

### Implementation Steps

- [x] **2a.** Extract the relationship suggestion logic from the route handler into a standalone function in a new file `src/pipeline/relations.ts`:
  ```ts
  async function suggestRelationsForNote(noteId: string, noteContent: string): Promise<Suggestion[]>
  ```

- [x] **2b.** Add a `applyRelations(sourceNoteId: string, relations: Suggestion[])` function in the same file that calls the ETAPI `createRelation` helper from Feature 1.

- [x] **2c.** Modify the brain dump pipeline (`src/pipeline/brain-dump.ts`):
  - After the note creation loop finishes, for each newly created note:
    1. Call `suggestRelationsForNote(noteId, content)`
    2. Filter suggestions to only high-confidence ones (LLM returns a `confidence` field — add this to the prompt)
    3. Call `applyRelations(noteId, highConfidenceSuggestions)`
  - Wrap in try/catch so a relation failure never breaks the brain dump
  - Add the applied relations to the `BrainDumpResult` response (new `relations` field)

- [x] **2d.** Update the relationship suggestion LLM prompt to include a `confidence: "high" | "medium" | "low"` field per suggestion. Only auto-apply `"high"` confidence. Medium/low are returned to the user for manual review.

- [x] **2e.** Add an `autoRelate: boolean` field to the brain dump request body (default `true`). Lets the user opt out of auto-relation per request.

- [x] **2f.** Add `relations` array to `BrainDumpResultSchema` in `src/types/lore.ts`.

### Files Touched

| File | Change |
|---|---|
| `src/pipeline/relations.ts` | New file — `suggestRelationsForNote()` + `applyRelations()` |
| `src/pipeline/brain-dump.ts` | Call auto-relate after note creation |
| `src/pipeline/prompt.ts` | Update suggestion prompt to include confidence |
| `src/routes/suggest.ts` | Refactor — delegate to shared `relations.ts` |
| `src/types/lore.ts` | Add `confidence` to suggestion schema, `relations` to result |

### Sequencing

Feature 2 depends on Feature 1 (`createRelation` helper), so implement Feature 1 first.

---

## Feature 3: Azgaar Fantasy Map Generator Import

**What:** A new endpoint that accepts an Azgaar FMG JSON export and bulk-creates Location (and optionally Faction) notes in AllCodex via ETAPI.

**Why:** Azgaar exports contain structured data for every burg (settlement), state (nation), river, and region. That can be hundreds of entries that would take hours to create by hand.

### Route

```
POST /import/azgaar
Content-Type: multipart/form-data
Body: file (the .json export from Azgaar FMG)
```

### Azgaar JSON Structure (relevant fields)

```json
{
  "info": { "mapName": "All Reach", ... },
  "burgs": [
    { "i": 1, "name": "Solara", "state": 3, "x": 540.2, "y": 312.8,
      "population": 28400, "capital": 1, "type": "Large City" }
  ],
  "states": [
    { "i": 3, "name": "Übermenschreich", "capital": 1, "color": "#4a7c59",
      "type": "Kingdom", "center": 8842, "diplomacy": [...] }
  ],
  "rivers": [
    { "i": 1, "name": "River Lume", "mouth": 4521, "source": 7832 }
  ],
  "cells": { "biome": [...], "culture": [...] }
}
```

### Implementation Steps

- [ ] **3a.** Create `src/pipeline/azgaar.ts`:
  - Define TypeScript types for the Azgaar JSON subset we consume (burgs, states, rivers — skip cells/biomes for now):
    - `AzgaarBurg` — `{ i, name, state, x, y, population, capital, type }`
    - `AzgaarState` — `{ i, name, capital, type, diplomacy }`
    - `AzgaarRiver` — `{ i, name, mouth, source }`
  - `parseAzgaarExport(json: unknown): { burgs, states, rivers }` — validates and extracts relevant arrays
  - `importBurgs(burgs, stateMap, loreRootNoteId)` — for each burg:
    1. `createNote({ parentNoteId, title: burg.name, type: "text", content: generated HTML })`
    2. `tagNote(noteId, "lore")` + `tagNote(noteId, "loreType", "location")`
    3. `createAttribute` for promoted fields: `locationType`, `region` (from state name), `population`, `ruler`
    4. `createAttribute({ type: "label", name: "geolocation", value: "${burg.x},${burg.y}" })` for map pins
    5. `setNoteTemplate(noteId, TEMPLATE_ID_MAP.location)` (best-effort, already try/catch'd)
  - `importStates(states, loreRootNoteId)` — for each state:
    1. Create as faction note
    2. Tag `loreType: faction`, set `factionType` to state type
    3. Link capital burg via relation (if burg note was already created)
  - `importRivers(rivers, loreRootNoteId)` — optional, creates location notes with `locationType: "river"`

- [ ] **3b.** Create `src/routes/import.ts`:
  - `POST /import/azgaar` accepts multipart form-data with a single JSON file field
  - Parse JSON, call `parseAzgaarExport`
  - Call `importBurgs`, `importStates`, and optionally `importRivers`
  - Return `{ burgsCreated, statesCreated, riversCreated, skipped, errors }`

- [ ] **3c.** Register route in `src/index.ts`.

- [ ] **3d.** Add `ImportHistory` model to Prisma schema:
  ```prisma
  model ImportHistory {
    id           String   @id @default(cuid())
    source       String   // "azgaar"
    fileName     String
    notesCreated String[]
    summary      Json
    createdAt    DateTime @default(now())
    @@map("import_history")
  }
  ```

- [ ] **3e.** Add `azgaarImportParentNoteId` to `AppConfig` — the AllCodex note under which imported locations land. Defaults to lore root.

- [ ] **3f.** Add a `dryRun: boolean` query param. When true, parses and validates the JSON but doesn't write anything to AllCodex. Returns what would be created.

### Generated HTML Template for Burgs

```html
<h2>{burg.name}</h2>
<p><strong>Type:</strong> {burg.type}</p>
<p><strong>State:</strong> {stateName}</p>
<p><strong>Population:</strong> {burg.population.toLocaleString()}</p>
<p>{burg.capital ? "Capital city of " + stateName : ""}</p>
```

### Files Touched

| File | Change |
|---|---|
| `src/pipeline/azgaar.ts` | New — parser + importers |
| `src/routes/import.ts` | New — `POST /import/azgaar` |
| `src/index.ts` | Register `importRoute` |
| `prisma/schema.prisma` | Add `ImportHistory` model |

---

## Implementation Order

```
Feature 1: Relation writing      (no dependencies)
    ↓
Feature 2: Auto-apply relations   (depends on Feature 1)

Feature 3: Azgaar import          (no dependencies — can parallel with 1 & 2)
```

Recommended sequence: **1 -> 3 -> 2**. Get relation writing and Azgaar import working independently first, then wire up auto-apply last since it pulls the relation logic into the brain dump pipeline.

---

## Prisma Migrations

All three features add new models. Run a single migration after all schema changes are in:

```bash
bunx prisma migrate dev --name "add-relation-history-and-import-history"
```

New models:
- `RelationHistory` for logging applied relations (Feature 1)
- `ImportHistory` for logging Azgaar imports (Feature 3)

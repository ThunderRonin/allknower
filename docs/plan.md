# AllKnower — Complete Test Audit
> Damiyen Austerman style. Nothing escapes.

---

## Test file map

```
src/
  env.test.ts
  logger.test.ts
  utils/
    tokens.test.ts
  etapi/
    client.test.ts
  rag/
    chunk-dedup.test.ts
    chunk-compactor.test.ts
    lancedb.test.ts                  ← pure functions only
    lancedb.integration.test.ts      ← real embedded DB, mocked embedder
    indexer.test.ts
    embedder.test.ts
  pipeline/
    parser.test.ts                   ✅ exists
    prompt.test.ts                   ✅ exists
    model-router.test.ts
    brain-dump.test.ts
    relations.test.ts
    azgaar.test.ts
    session-compactor.test.ts
    schemas/
      response-schemas.test.ts
  plugins/
    auth-guard.test.ts
    request-id.test.ts
  routes/
    brain-dump.test.ts
    rag.test.ts
    consistency.test.ts
    suggest.test.ts
    health.test.ts
    setup.test.ts
    import.test.ts
```

---

## Tier 0 — Infra / Config

### `src/env.test.ts`
**Mocks:** none — test real Zod schema validation

```
envSchema
  ✓ parses valid minimal env (DATABASE_URL, BETTER_AUTH_SECRET, ALLCODEX_ETAPI_TOKEN)
  ✓ coerces PORT string "3001" to number 3001
  ✓ defaults PORT to 3001 when absent
  ✓ defaults NODE_ENV to "development" when absent
  ✓ rejects PORT = 0 (not positive)
  ✓ rejects PORT = -1 (not positive)
  ✓ rejects BETTER_AUTH_SECRET under 16 chars
  ✓ rejects empty DATABASE_URL
  ✓ rejects invalid NODE_ENV value ("staging")
  ✓ accepts NODE_ENV "production" | "development" | "test"
  ✓ defaults LANCEDB_PATH to "./data/lancedb"
  ✓ defaults EMBEDDING_DIMENSIONS to 4096 as number
  ✓ coerces EMBEDDING_DIMENSIONS string "1536" to number 1536
  ✓ rejects EMBEDDING_DIMENSIONS = 0 (not positive)
  ✓ defaults LLM_TIMEOUT_MS to 120000
  ✓ coerces LLM_TIMEOUT_MS "30000" to number
  ✓ rejects OPENROUTER_SORT values not in enum ("fastest")
  ✓ accepts OPENROUTER_SORT "price" | "throughput" | "latency"
  ✓ defaults USE_OPENROUTER_AUTO to "false"
  ✓ defaults all model strings to expected defaults
  ✓ defaults all fallback model strings to ""
  ✓ defaults RAG_CONTEXT_MAX_TOKENS to 6000
  ✓ defaults RAG_CHUNK_DEDUP_SIMILARITY_THRESHOLD to 0.85

parseEnv
  ✓ calls process.exit(1) on invalid env (mock process.exit)
  ✓ logs error details before exiting
```

### `src/logger.test.ts`
**Mocks:** `console.log`, `console.warn`, `console.error`

```
Logger
  ✓ emits JSON to console.log on info()
  ✓ emits JSON to console.warn on warn()
  ✓ emits JSON to console.error on error()
  ✓ emitted JSON includes level, timestamp, message fields
  ✓ emitted JSON includes context fields from constructor
  ✓ child() creates new logger with merged context
  ✓ child() does not mutate parent context
  ✓ data fields from info(msg, data) appear in emitted JSON
  ✓ data fields override context fields of same name
  ✓ timestamp is valid ISO string

rootLogger
  ✓ is a Logger instance with empty context
```

---

## Tier 1 — Pure functions, zero infra

### `src/utils/tokens.test.ts`
**Mocks:** none (tiktoken may or may not be available — test both paths)

```
countTokens
  ✓ returns a positive integer for non-empty string
  ✓ returns 0 for empty string
  ✓ longer text returns more tokens than shorter text
  ✓ falls back to heuristic (Math.ceil(len/3.5)) when tiktoken unavailable
  ✓ heuristic result is always >= 1 for non-empty string

tokensToChars
  ✓ returns Math.floor(tokens * 3.5)
  ✓ tokensToChars(1) = 3
  ✓ tokensToChars(100) = 350
  ✓ tokensToChars(0) = 0
  ✓ round-trip: tokensToChars(countTokens(text)) <= text.length always
```

### `src/rag/chunk-dedup.test.ts`
**Mocks:** none

```
deduplicateChunks
  ✓ empty array returns empty array
  ✓ single chunk returns single chunk unchanged
  ✓ two identical chunks → only first kept
  ✓ two near-identical chunks (>85% trigram overlap) → only first kept
  ✓ two clearly distinct chunks → both kept
  ✓ preserves first occurrence when deduplicating (not second)
  ✓ preserves order of non-duplicate chunks
  ✓ custom threshold 0.5 deduplicates more aggressively than 0.9
  ✓ custom threshold 0.99 keeps chunks that 0.85 would drop
  ✓ chunks from different noteIds with same content → only first kept
  ✓ three chunks: first + third similar, second distinct → first + second kept
  ✓ very short content (1-2 words) does not produce trigrams → treated as distinct
  ✓ content with only stopwords does not false-positive deduplicate unrelated chunks

trigrams (internal — tested via deduplicateChunks behavior)
  ✓ text shorter than 3 words produces empty trigram set → no false deduplication

jaccardSimilarity (internal — tested via deduplicateChunks behavior)
  ✓ identical sets return 1.0
  ✓ disjoint sets return 0.0
  ✓ empty union (both empty sets) returns 0 without dividing by zero
```

### `src/rag/lancedb.test.ts` (pure functions only)
**Mocks:** none

```
chunkText
  ✓ empty string returns []
  ✓ whitespace-only string returns []
  ✓ short text (< chunkSize words) returns single chunk
  ✓ single chunk contains full input text
  ✓ text with double newlines splits on paragraph boundaries
  ✓ multiple small paragraphs merge up to chunkSize
  ✓ very long single paragraph splits on sentence boundaries (. ! ?)
  ✓ applying overlap: last N words of chunk[i] appear at start of chunk[i+1]
  ✓ no chunk in output is empty string
  ✓ no chunk in output is only whitespace
  ✓ custom chunkSize=50 produces more chunks than chunkSize=512
  ✓ custom overlap=0 produces no overlap between consecutive chunks
  ✓ all words from input appear in at least one chunk (no data loss)
  ✓ total word count across chunks >= input word count (overlap causes excess)
  ✓ single very long sentence without punctuation falls back gracefully

classifyQueryComplexity
  ✓ "Aria Vale" → "simple"
  ✓ "Aether Keep location type" → "simple" (<=8 words, no connectives)
  ✓ "how does Aria Vale relate to Aether Keep" → "complex" (has "how", "relate")
  ✓ "why did the war cause the collapse of Ironmark" → "complex" (has "why", "cause")
  ✓ "relationship between Kael and the northern factions" → "complex" (has "relationship")
  ✓ 9-word query with no connectives → "complex" (length > 8)
  ✓ 8-word query with no connectives → "simple" (exactly at threshold)
  ✓ query containing "between" → "complex"
  ✓ query containing "influence" → "complex"
  ✓ query containing "impact" → "complex"
  ✓ query containing "connect" → "complex"
  ✓ empty string → "simple" (0 words, no connectives)
  ✓ case-insensitive matching ("HOW does" → complex)

sanitizeFilterValue (tested via deleteNoteChunks/upsertNoteChunks behavior — see integration tests)
  ✓ valid cuid "clxyz123abc" passes
  ✓ valid with hyphens "note-abc-123" passes
  ✓ valid with underscores "note_abc" passes
  ✓ SQL injection attempt "'; DROP TABLE--" throws "Invalid filter value format"
  ✓ path traversal "../etc/passwd" throws
  ✓ spaces in value throw
  ✓ empty string throws
```

### `src/pipeline/model-router.test.ts` (pure functions only)
**Mocks:** `process.env` for USE_OPENROUTER_AUTO and model vars

```
getModelChain
  ✓ returns array of strings for "brain-dump"
  ✓ returns array of strings for "consistency"
  ✓ returns array of strings for "suggest"
  ✓ returns array of strings for "gap-detect"
  ✓ returns array of strings for "autocomplete"
  ✓ returns array of strings for "rerank"
  ✓ returns array of strings for "compact"
  ✓ returns array of strings for "session-compact"
  ✓ all returned model strings are non-empty
  ✓ when USE_OPENROUTER_AUTO="true" → returns ["openrouter/auto"] for any task
  ✓ when USE_OPENROUTER_AUTO="false" → returns configured models
  ✓ fallbacks with empty string are filtered out
  ✓ primary model is always first in array
  ✓ "compact" and "session-compact" use the same COMPACT_MODEL
  ✓ with only primary set (fallbacks empty) → array length 1
  ✓ with primary + fallback1 set → array length 2
  ✓ with primary + fallback1 + fallback2 set → array length 3
```

### `src/pipeline/azgaar.test.ts` (pure functions only)
**Mocks:** none

```
isAzgaarMapData
  ✓ null → false
  ✓ undefined → false
  ✓ string → false
  ✓ number → false
  ✓ {} → false (no pack)
  ✓ { pack: null } → false
  ✓ { pack: {} } → false (no arrays)
  ✓ { pack: { burgs: "not-array" } } → false
  ✓ { pack: { burgs: [] } } → true
  ✓ { pack: { states: [] } } → true
  ✓ { pack: { religions: [] } } → true
  ✓ full valid export shape → true
  ✓ export with info.mapName → true
  ✓ export with only settings.mapName (no info) → true

getMapPreview
  ✓ skips i=0 entries (reserved slot in Azgaar model)
  ✓ skips removed=true entries
  ✓ counts valid burgs correctly (i>0, !removed)
  ✓ counts valid states correctly
  ✓ counts valid religions correctly
  ✓ counts valid cultures correctly
  ✓ counts map notes correctly (no i field — all are valid)
  ✓ uses info.mapName as primary name source
  ✓ falls back to settings.mapName when info absent
  ✓ falls back to "Unnamed Map" when both absent
  ✓ info.mapName takes priority over settings.mapName
  ✓ empty pack arrays → all counts 0
  ✓ null pack → all counts 0 (handles missing pack gracefully)
```

### `src/pipeline/session-compactor.test.ts` (pure functions only)
**Mocks:** none for pure functions; Prisma + callWithFallback for others

```
shouldCompact
  ✓ returns true when tokensAccumulated >= SESSION_TOKEN_THRESHOLD
  ✓ returns false when tokensAccumulated < SESSION_TOKEN_THRESHOLD
  ✓ returns false when compactionFailed >= MAX_COMPACT_RETRIES (3)
  ✓ returns false when lockedAt is not null
  ✓ returns true when all conditions met: tokens>=threshold, failed<3, lockedAt=null
  ✓ boundary: tokensAccumulated === SESSION_TOKEN_THRESHOLD → true
  ✓ boundary: compactionFailed === 2 (< 3) → true
  ✓ boundary: compactionFailed === 3 → false

rebuildContext
  ✓ includes [SESSION COMPACTED] header
  ✓ includes compaction count in header
  ✓ includes POST_COMPACT_BUDGET value
  ✓ includes JSON-serialized state
  ✓ includes "Do not acknowledge this summary" instruction
  ✓ with 0 recentNotes → still produces valid context string
  ✓ with recentNotes → includes noteTitle and truncated content
  ✓ truncates note content to MAX_TOKENS_PER_REINJECTED_NOTE chars
  ✓ takes max MAX_RECENT_NOTES_REINJECT (5) notes even if more provided
  ✓ notes beyond MAX_RECENT_NOTES_REINJECT are silently dropped
```

---

## Tier 2 — ETAPI Client (mocked fetch)

### `src/etapi/client.test.ts`
**Mocks:** `global.fetch` via `mock()`

```
etapiFetch (internal — tested via public functions)
  ✓ constructs URL as BASE_URL + /etapi + path
  ✓ includes Authorization header with token
  ✓ includes Content-Type: application/json header
  ✓ throws Error with status code on non-ok response
  ✓ error message includes method, path, and status
  ✓ options.headers merge with DEFAULT_HEADERS (options win on conflict)

getAllCodexNotes
  ✓ calls GET /etapi/notes?search=<encoded>
  ✓ URL-encodes the search string (# → %23)
  ✓ returns results array from response
  ✓ returns empty array when results: []
  ✓ throws on 401 response
  ✓ throws on 500 response

getNote
  ✓ calls GET /etapi/notes/:noteId
  ✓ returns parsed JSON response
  ✓ throws on 404

getNoteContent
  ✓ calls GET /etapi/notes/:noteId/content
  ✓ returns response as text (not JSON)
  ✓ throws on 404

createNote
  ✓ calls POST /etapi/create-note
  ✓ sends parentNoteId, title, type in body
  ✓ sends optional noteId when provided
  ✓ sends optional content when provided
  ✓ returns { note, branch } from response
  ✓ throws on 400

updateNote
  ✓ calls PATCH /etapi/notes/:noteId
  ✓ sends only provided fields in body (partial patch)
  ✓ returns updated note from response
  ✓ throws on 404

setNoteContent
  ✓ calls PUT /etapi/notes/:noteId/content
  ✓ sends Content-Type: text/html header
  ✓ sends content string as body
  ✓ returns void on success (204)
  ✓ throws on 404

createAttribute
  ✓ calls POST /etapi/attributes
  ✓ sends noteId, type, name, value in body
  ✓ sends isInheritable when provided
  ✓ returns created attribute from response
  ✓ throws on 400

setNoteTemplate
  ✓ calls createAttribute with type="relation", name="template"
  ✓ passes templateNoteId as value
  ✓ passes noteId correctly

tagNote
  ✓ calls createAttribute with type="label"
  ✓ passes noteId, labelName, value correctly
  ✓ defaults value to "" when not provided

createRelation
  ✓ creates forward relation: source → target with correct attrName
  ✓ creates inverse relation: target → source when bidirectional=true (default)
  ✓ does NOT create inverse when bidirectional=false
  ✓ maps "ally" → "relAlly"
  ✓ maps "enemy" → "relEnemy"
  ✓ maps "family" → "relFamily"
  ✓ maps unknown type → "relOther"
  ✓ creates description label on source when description provided
  ✓ creates inverse description label on target when bidirectional + description
  ✓ does NOT create description label when description is undefined

checkAllCodexHealth
  ✓ returns { ok: true, version } on success
  ✓ calls GET /etapi/app-info
  ✓ extracts appVersion from response
  ✓ returns { ok: false, error } when fetch throws
  ✓ returns { ok: false, error } on non-ok response
  ✓ never throws — always returns object
```

---

## Tier 3 — Pipeline (mocked external calls)

### `src/rag/chunk-compactor.test.ts`
**Mocks:** `callWithFallback` from model-router

```
compactChunk
  ✓ returns chunk unchanged when token count <= threshold
  ✓ calls callWithFallback("compact", ...) when token count > threshold
  ✓ returns chunk with summarized content when LLM succeeds
  ✓ appends "[summarized]" to noteTitle on summary
  ✓ returns original chunk unchanged when LLM throws (never propagates error)
  ✓ caches summary: second call with same content does not call LLM again
  ✓ cache TTL: stale entry (>1 hour) is evicted and LLM called again
  ✓ cache max size: 201st entry evicts oldest before inserting
  ✓ LLM response is trimmed before storing

compactChunks
  ✓ returns empty array for empty input
  ✓ processes all chunks
  ✓ concurrency limit: max 3 concurrent LLM calls (verify with timing or mock tracking)
  ✓ one chunk failure does not affect other chunks
  ✓ small chunks (below threshold) are returned unchanged without LLM call
  ✓ mixed: some chunks compact, some pass through
```

### `src/rag/embedder.test.ts`
**Mocks:** `openrouterClient.embeddings.create`

```
embed
  ✓ calls embedBatch with single-element array
  ✓ returns first element of embedBatch result
  ✓ returns number array of correct length (EMBEDDING_DIMENSIONS)

embedBatch
  ✓ returns empty array for empty input
  ✓ calls openrouterClient.embeddings.create with correct model and input
  ✓ sorts results by index before returning
  ✓ handles out-of-order API response (sorts correctly)
  ✓ returns embeddings in same order as input regardless of API response order
  ✓ throws when API call fails (propagates error)
```

### `src/rag/indexer.test.ts`
**Mocks:** `getNoteContent`, `getAllCodexNotes`, `upsertNoteChunks`, `prisma.ragIndexMeta.upsert`

```
indexNote
  ✓ fetches note content via getNoteContent
  ✓ strips HTML tags before embedding (plain text only)
  ✓ normalizes multiple whitespace to single space
  ✓ calls upsertNoteChunks with noteId, title, chunks
  ✓ fetches note title via getAllCodexNotes("#noteId=...")
  ✓ falls back to noteId as title when ETAPI returns no results
  ✓ upserts ragIndexMeta with noteId, title, chunkCount, model
  ✓ returns immediately when content is empty string
  ✓ returns immediately when content is whitespace-only
  ✓ throws (propagates) when getNoteContent throws
  ✓ throws (propagates) when upsertNoteChunks throws
  ✓ logs success with noteId, noteTitle, chunkCount

fullReindex
  ✓ calls getAllCodexNotes("#lore")
  ✓ calls indexNote for each found note
  ✓ returns { indexed: N, failed: 0 } on all success
  ✓ increments failed count when indexNote throws (non-fatal)
  ✓ continues indexing remaining notes after one failure
  ✓ returns { indexed: 0, failed: 0 } when no lore notes found

reindexStaleNotes
  ✓ fetches lore notes and ragIndexMeta in parallel
  ✓ skips notes where noteModified <= embeddedAt (upToDate++)
  ✓ reindexes notes where noteModified > embeddedAt
  ✓ reindexes notes with no embeddedAt record (never indexed)
  ✓ increments failed on indexNote throw, continues
  ✓ returns correct { reindexed, failed, upToDate } counts
```

### `src/pipeline/relations.test.ts`
**Mocks:** `queryLore`, `callLLM`, `createRelation`, `prisma.relationHistory.create`

```
suggestRelationsForNote
  ✓ calls queryLore with noteContent and limit=15
  ✓ returns [] when queryLore returns empty array
  ✓ logs warning when queryLore returns empty
  ✓ builds context block from queryLore results (truncated at 200 chars)
  ✓ calls callLLM with SUGGEST_RELATIONS_SYSTEM, user message, "suggest" task
  ✓ parses and validates LLM response against SuggestRelationsResponseSchema
  ✓ returns validated suggestions array
  ✓ filters out self-referential suggestions when noteId !== "unknown"
  ✓ does NOT filter self-refs when noteId === "unknown"
  ✓ returns [] when LLM response fails Zod validation
  ✓ returns [] when LLM response is invalid JSON
  ✓ logs warning on validation failure (does not throw)
  ✓ logs warning on JSON parse failure (does not throw)

applyRelations
  ✓ calls createRelation for each relation in array
  ✓ calls prisma.relationHistory.create for each successful relation
  ✓ returns applied array with targetNoteId and type
  ✓ non-fatal: continues when one createRelation throws
  ✓ failed relation goes to failed array with reason
  ✓ failed relation does NOT write to RelationHistory
  ✓ bidirectional=true passed to createRelation by default
  ✓ bidirectional=false respected when provided
  ✓ empty relations array → returns { applied: [], failed: [] }
  ✓ logs error for each failed relation
```

### `src/pipeline/brain-dump.test.ts`
**Mocks:** `queryLore`, `buildBrainDumpPrompt`, `callLLM`, `parseBrainDumpResponse`,
         `createNote`, `updateNote`, `setNoteContent`, `setNoteTemplate`,
         `tagNote`, `createAttribute`, `getAllCodexNotes`,
         `suggestRelationsForNote`, `applyRelations`,
         `prisma.brainDumpHistory`, `prisma.appConfig`

```
runBrainDump — inbox mode
  ✓ mode="inbox" returns { mode: "inbox", queued: true }
  ✓ mode="inbox" never calls queryLore
  ✓ mode="inbox" never calls callLLM

runBrainDump — cache hit (auto mode)
  ✓ hashes rawText with SHA-256
  ✓ queries prisma.brainDumpHistory.findFirst with rawTextHash
  ✓ on cache hit, returns [cached] prefixed summary
  ✓ on cache hit, returns empty created/updated/skipped arrays
  ✓ on cache hit, never calls queryLore or callLLM
  ✓ cache only applies to mode="auto" (review always re-runs)

runBrainDump — auto mode (cache miss)
  ✓ calls queryLore(rawText, 10) for general context
  ✓ calls getAllCodexNotes("#statblock") for statblock-grounded retrieval
  ✓ merges statblock context at top of merged context
  ✓ statblock context failure is non-fatal (continues without it)
  ✓ calls buildBrainDumpPrompt with rawText and mergedContext
  ✓ calls callLLM with system, user, "brain-dump", context
  ✓ calls parseBrainDumpResponse with raw LLM output
  ✓ creates note for each entity with action="create"
  ✓ applies template to created note via setNoteTemplate
  ✓ tags note with "lore" and "loreType" labels
  ✓ applies all attributes from entity.attributes
  ✓ applies all tags from entity.tags
  ✓ skips null/undefined/empty attribute values
  ✓ converts array attribute values to comma-joined string
  ✓ updates existing note when action="update" with existingNoteId
  ✓ calls updateNote + setNoteContent for updates
  ✓ duplicate detection: skips entity when exact title match found (score > 0.88)
  ✓ duplicate detection: does not skip when only partial match (no exact title)
  ✓ failed entity write goes to skipped array with reason (non-fatal)
  ✓ auto-relate: calls suggestRelationsForNote for each created note
  ✓ auto-relate: only applies high-confidence suggestions
  ✓ auto-relate: failure is non-fatal (continues without it)
  ✓ auto-relate: skipped when autoRelate=false
  ✓ persists to prisma.brainDumpHistory with all fields
  ✓ returns { summary, created, updated, skipped, reindexIds }
  ✓ reindexIds contains noteIds of all created + updated notes

runBrainDump — review mode
  ✓ calls LLM (not skipped like auto cache)
  ✓ returns { mode: "review", summary, proposedEntities }
  ✓ does NOT write to AllCodex
  ✓ does NOT write to brainDumpHistory
  ✓ proposes action="create" for new entities
  ✓ proposes action="update" for entities with existingNoteId
  ✓ runs duplicate detection for create proposals
  ✓ includes duplicates array when matches found
  ✓ omits duplicates when no matches

commitReviewedEntities
  ✓ skips LLM — calls _writeEntitiesToAllCodex directly
  ✓ uses "commit:" prefix in rawTextHash
  ✓ adapts ProposedEntity shape to internal entity shape
  ✓ returns { summary, created, updated, skipped, reindexIds }
```

### `src/pipeline/session-compactor.test.ts` (async functions)
**Mocks:** `prisma.loreSession`, `prisma.loreSessionMessage`, `callWithFallback`

```
compactSession
  ✓ acquires optimistic lock before proceeding
  ✓ throws CompactionLockError when lock already held
  ✓ fetches message history ordered by createdAt asc
  ✓ calls callWithFallback("session-compact", ...) with history
  ✓ validates LLM output against LoreSessionStateSchema
  ✓ persists compacted state to prisma.loreSession
  ✓ resets tokensAccumulated to POST_COMPACT_BUDGET (50000)
  ✓ increments compactionCount
  ✓ resets compactionFailed to 0 on success
  ✓ releases lock in finally block (success path)
  ✓ releases lock in finally block (failure path)
  ✓ increments compactionFailed on LLM error
  ✓ increments compactionFailed on Zod parse failure
  ✓ re-throws original error after incrementing
  ✓ stale lock (> 5 min old) is treated as unheld

pruneStaleSession
  ✓ calls prisma.loreSession.deleteMany with updatedAt < 30 days ago
  ✓ returns count of deleted sessions
  ✓ logs pruned count
```

---

## Tier 4 — Routes (Elysia handle + mocked services)

**Pattern for all route tests:**
```ts
const res = await app.handle(new Request("http://localhost/path", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
}));
```

### `src/routes/health.test.ts`
**Mocks:** `checkAllCodexHealth`, `checkLanceDbHealth`, `prisma.$queryRaw`

```
GET /health
  ✓ returns 200 with { status: "ok" } when all checks pass
  ✓ returns 503 with { status: "degraded" } when any check fails
  ✓ includes allcodex, lancedb, database in checks object
  ✓ degraded when allcodex.ok = false
  ✓ degraded when lancedb.ok = false
  ✓ degraded when database.ok = false
  ✓ all checks run in parallel (Promise.allSettled)
  ✓ one check throwing does not crash response (settled)
  ✓ includes error message in degraded check
```

### `src/routes/brain-dump.test.ts`
**Mocks:** `runBrainDump`, `commitReviewedEntities`, `indexNote`, auth bypass

```
POST /brain-dump
  ✓ rejects rawText shorter than 10 chars with 400
  ✓ rejects rawText longer than 50000 chars with 400
  ✓ rejects missing rawText with 400
  ✓ defaults mode to "auto" when not provided
  ✓ passes mode="review" to runBrainDump
  ✓ passes mode="inbox" to runBrainDump
  ✓ rejects invalid mode value with 400
  ✓ returns 200 with brain dump result body
  ✓ strips reindexIds from response body
  ✓ queues indexNote backgroundTask for each reindexId
  ✓ returns 401 without valid auth

POST /brain-dump/commit
  ✓ calls commitReviewedEntities with rawText and approvedEntities
  ✓ strips reindexIds from response body
  ✓ queues indexNote for each reindexId
  ✓ rejects missing rawText with 400
  ✓ rejects missing approvedEntities with 400

GET /brain-dump/history
  ✓ returns last 20 entries ordered by createdAt desc
  ✓ returns only selected fields (no parsedJson)
  ✓ returns 200 with array

GET /brain-dump/history/:id
  ✓ returns entry with summary extracted from parsedJson
  ✓ returns 404 when id not found
  ✓ includes rawText, model, tokensUsed in response
  ✓ summary is null when parsedJson is null
```

### `src/routes/rag.test.ts`
**Mocks:** `queryLore`, `indexNote`, `fullReindex`, `reindexStaleNotes`, `prisma.ragIndexMeta`, auth bypass

```
POST /rag/query
  ✓ calls queryLore with body.text and body.topK
  ✓ defaults topK to 10 when not provided
  ✓ rejects topK > 50 with 400
  ✓ rejects topK < 1 with 400
  ✓ returns { results: [...chunks] }
  ✓ rejects empty text with 400

POST /rag/reindex/:noteId
  ✓ calls indexNote with params.noteId
  ✓ returns { ok: true, noteId } on success
  ✓ returns 404 when indexNote throws "not found" message
  ✓ returns 500 when indexNote throws other error
  ✓ includes error message in response

POST /rag/reindex
  ✓ calls fullReindex()
  ✓ returns { indexed, failed }

POST /rag/reindex-stale
  ✓ calls reindexStaleNotes()
  ✓ returns { reindexed, failed, upToDate }

GET /rag/status
  ✓ returns indexedNotes count from prisma
  ✓ returns lastIndexed and model from latest record
  ✓ returns null for lastIndexed when no records exist
```

### `src/routes/consistency.test.ts`
**Mocks:** `getAllCodexNotes`, `getNoteContent`, `queryLore`, `callLLM`, auth bypass

```
POST /consistency/check — with noteIds
  ✓ fetches notes matching the provided noteIds
  ✓ fetches content for each note
  ✓ strips HTML from content before sending to LLM
  ✓ truncates content to MAX_NOTE_CHARS (2000) per note
  ✓ returns { issues: [], summary } on empty results
  ✓ calls callLLM with CONSISTENCY_SYSTEM, "consistency" task
  ✓ validates response against ConsistencyResponseSchema
  ✓ returns { issues, summary } on valid response
  ✓ returns fallback on invalid JSON from LLM
  ✓ returns fallback on Zod validation failure

POST /consistency/check — without noteIds (semantic sampling)
  ✓ uses CONSISTENCY_PROBES to query via queryLore
  ✓ deduplicates results across probe queries
  ✓ returns { issues: [], summary: "No lore notes found" } when RAG empty
  ✓ builds context from sampled chunk content
  ✓ calls callLLM with sampled context

POST /consistency/check — auth
  ✓ returns 401 without valid session
```

### `src/routes/suggest.test.ts`
**Mocks:** `suggestRelationsForNote`, `applyRelations`, `getAllCodexNotes`,
         `callLLM`, `queryLore`, `prisma.ragIndexMeta`, auth bypass

```
POST /suggest/relationships
  ✓ calls suggestRelationsForNote with body.text and body.noteId
  ✓ uses "unknown" when noteId not provided
  ✓ returns { suggestions: [...] }
  ✓ returns 401 without auth

POST /suggest/relationships/apply
  ✓ calls applyRelations with sourceNoteId, relations, options
  ✓ bidirectional defaults to true
  ✓ bidirectional=false is passed through
  ✓ returns { applied, failed }
  ✓ rejects missing sourceNoteId with 400
  ✓ rejects empty relations array with 400

GET /suggest/gaps
  ✓ calls getAllCodexNotes("#lore")
  ✓ builds lore census from attributes
  ✓ caps entries per type at 20 in context
  ✓ calls callLLM with GAP_DETECT_SYSTEM, "gap-detect" task
  ✓ validates response against GapDetectResponseSchema
  ✓ returns { gaps, summary, typeCounts, totalNotes }
  ✓ returns fallback on invalid LLM response

GET /suggest/autocomplete?q=...
  ✓ phase 1: queries ragIndexMeta for title prefix match
  ✓ phase 2: queries queryLore when prefix results < limit
  ✓ phase 3: calls LLM when phase1+2 < 3 results
  ✓ deduplicates across phases
  ✓ respects limit param (default 10, max 20)
  ✓ rejects limit > 20 with 400
  ✓ rejects empty q with 400
  ✓ returns { suggestions: [{ noteId, title }] }
  ✓ LLM phase failure is non-fatal (best-effort)
```

### `src/routes/setup.test.ts`
**Mocks:** `createNote`, `tagNote`, `createAttribute`, auth bypass (note: setupRoute has no auth guard — verify this is intentional)

```
POST /setup/seed-templates
  ✓ creates container note "_lore_templates_container"
  ✓ tags container with "loreTemplates"
  ✓ creates one template note per entry in TEMPLATE_ID_MAP
  ✓ tags each template note with "template"
  ✓ creates promoted attribute labels for each template field
  ✓ promoted attribute format: name="label:FIELDNAME", value="promoted,TYPE"
  ✓ container already-exists error is swallowed (non-fatal)
  ✓ template already-exists error is reported as "already_exists" (not "error")
  ✓ unexpected template error is reported as "error" with message
  ✓ returns { summary: "N created, M already existed, K failed", results }
  ✓ summary counts are accurate
  ✓ all 21 entity types in TEMPLATE_ID_MAP are present in results
  ✓ idempotent: calling twice does not throw — second call returns all already_exists
```

### `src/routes/import.test.ts`
**Mocks:** `createNote`, `setNoteTemplate`, `tagNote`, `getAllCodexNotes`,
         `importAzgaarMap`, `isAzgaarMapData`, `getMapPreview`

```
POST /import/system-pack
  ✓ rejects empty notes array with 400
  ✓ creates note for each valid entry
  ✓ applies _template_statblock template
  ✓ tags with "statblock", "importSource=system-pack", "crName"
  ✓ maps cr → challengeRating attribute
  ✓ maps all ATTR_MAP fields as labels
  ✓ skips null/empty attribute values
  ✓ skipDuplicates=true: skips entries matching existing #statblock titles
  ✓ skipDuplicates=false: creates regardless of existing titles
  ✓ entry with missing name goes to errors (not created)
  ✓ ETAPI error for one entry goes to errors, continues with rest
  ✓ returns { created, skipped, errors, detail }

POST /import/azgaar/preview
  ✓ returns 400 with INVALID_FORMAT when isAzgaarMapData returns false
  ✓ calls getMapPreview when valid
  ✓ returns preview object directly

GET /import/azgaar/preview
  ✓ returns 400 when url param missing
  ✓ returns 501 NOT_IMPLEMENTED always

POST /import/azgaar
  ✓ returns 400 INVALID_FORMAT when mapData not valid Azgaar
  ✓ calls importAzgaarMap with mapData and options
  ✓ passes parentNoteId defaulting to "root"
  ✓ all import flags default to true
  ✓ skipDuplicates defaults to true
  ✓ returns importAzgaarMap result on success
  ✓ returns 500 IMPORT_ERROR when importAzgaarMap throws
```

---

## Tier 5 — LanceDB Integration (real embedded DB)

### Singleton reset — Option A (required code change)

LanceDB maintains two module-level singletons in `src/rag/lancedb.ts`:

```ts
let _db: lancedb.Connection | null = null;
let _table: lancedb.Table | null = null;
```

These are never exported. Without a reset mechanism, `getTable()` returns the
cached connection from the first test for all subsequent tests, ignoring the
per-test temp directory. Add this export to `lancedb.ts`:

```ts
/** For testing only — resets the singleton connection so the next
 *  getTable() call creates a fresh DB at the current LANCEDB_PATH. */
export function _resetConnection(): void {
    _db = null;
    _table = null;
}
```

### Test file setup pattern

```ts
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import { mock } from "bun:test";

// 1. Override LANCEDB_PATH BEFORE any import that touches lancedb.ts,
//    because mkdirSync(DB_PATH) runs at module load time.
const TEST_DB_PATH = join(tmpdir(), `allknower-test-${process.pid}-${Date.now()}`);
process.env.LANCEDB_PATH = TEST_DB_PATH;
process.env.EMBEDDING_DIMENSIONS = "4"; // tiny vectors — no real API calls

// 2. Mock the embedder module so no real OpenRouter calls are made.
mock.module("../rag/embedder", () => ({
    embed: async (_text: string) => [0.1, 0.2, 0.3, 0.4],
    embedBatch: async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3, 0.4]),
    EMBEDDING_DIMENSIONS: 4,
}));

// 3. Import AFTER env override and mock registration.
import { _resetConnection, getTable, upsertNoteChunks,
         deleteNoteChunks, checkLanceDbHealth, queryLore } from "./lancedb";

beforeAll(() => {
    mkdirSync(TEST_DB_PATH, { recursive: true });
});

afterEach(() => {
    // Reset singleton so next test gets a fresh connection.
    _resetConnection();
    // Wipe the LanceDB table data but keep the directory.
    rmSync(join(TEST_DB_PATH, "lore_embeddings.lance"), {
        recursive: true,
        force: true,
    });
});

afterAll(() => {
    _resetConnection();
    rmSync(TEST_DB_PATH, { recursive: true, force: true });
});
```

The `process.pid` in the path prevents parallel `bun test` worker processes
from colliding on the same temp directory.

### `src/rag/lancedb.integration.test.ts`
**Mocks:** `../rag/embedder` (mock module — returns deterministic tiny vectors)
**Setup:** see pattern above — temp directory per run, `_resetConnection()` between tests

```
getTable
  ✓ creates DB directory if it doesn't exist
  ✓ creates table on first call
  ✓ returns same table instance on subsequent calls (singleton)
  ✓ seed record (__seed__) is removed — table starts with 0 rows
  ✓ opens existing table on second process start (table persists to disk)

upsertNoteChunks
  ✓ inserts records for each chunk
  ✓ each record has noteId, noteTitle, chunkIndex, content, vector
  ✓ calling twice with same noteId deletes old chunks and inserts new
  ✓ empty chunks array → deletes existing records, inserts nothing
  ✓ chunkIndex is sequential (0, 1, 2...)
  ✓ vectors come from embedBatch (mocked — returns [0.1, 0.2, 0.3, 0.4])
  ✓ two different noteIds coexist without interfering

deleteNoteChunks
  ✓ removes all chunks for specified noteId
  ✓ leaves other noteIds' chunks intact
  ✓ no-op when noteId has no chunks (does not throw)
  ✓ throws "Invalid filter value format" for noteId with special chars

checkLanceDbHealth
  ✓ returns { ok: true } when table is accessible
  ✓ returns { ok: false, error } when DB path is broken
  ✓ never throws — always returns object

queryLore (integration — with mocked embedder returning identical vectors)
  ✓ returns empty array when table is empty
  ✓ returns at most topK results
  ✓ filters results below SIMILARITY_THRESHOLD (0.3)
  ✓ deduplicates by noteId — returns best chunk per note
  ✓ results are sorted by score descending
  ✓ includeNoteIds allowlist filters to only those notes
  ✓ empty includeNoteIds has no filtering effect
  ✓ queryText triggers embed() call (mocked)
  ✓ reranking failure is non-fatal (falls back to vector scores)
```

---

## Tier 6 — Plugins / Middleware

### `src/plugins/auth-guard.test.ts`
**Mocks:** `auth.api.getSession`

```
requireAuth plugin
  ✓ resolves session from request headers
  ✓ calls auth.api.getSession with request headers
  ✓ allows request through when session is valid (non-null)
  ✓ returns 401 JSON when session is null
  ✓ returned 401 body is { error: "Unauthorized" }
  ✓ sets response status to 401
  ✓ scoped: only applies to routes that use this plugin
```

### `src/plugins/request-id.test.ts`

```
requestIdPlugin
  ✓ derives requestId for each request
  ✓ requestId is 8-char string (UUID slice)
  ✓ requestId is unique across concurrent requests
  ✓ derives log as rootLogger.child({ requestId })
  ✓ log is available in route handler context
  ✓ global scope: requestId available on all routes
```

---

## Tier 7 — Schema validation

### `src/pipeline/schemas/response-schemas.test.ts`

```
ConsistencyResponseSchema
  ✓ accepts valid response with issues array and summary
  ✓ accepts empty issues array
  ✓ rejects missing summary
  ✓ rejects missing issues
  ✓ rejects issue with invalid type enum
  ✓ rejects issue with invalid severity enum
  ✓ rejects issue with missing affectedNoteIds
  ✓ accepts all valid type values: contradiction|timeline|orphan|naming|logic|power
  ✓ accepts all valid severity values: high|medium|low

GapDetectResponseSchema
  ✓ accepts valid response with gaps array and summary
  ✓ accepts empty gaps array
  ✓ rejects gap with invalid severity
  ✓ rejects missing description or suggestion
  ✓ accepts all valid severity values

SuggestRelationsResponseSchema
  ✓ accepts valid response with suggestions
  ✓ accepts suggestion with optional targetTitle and confidence
  ✓ rejects suggestion with invalid relationshipType
  ✓ accepts all 17 valid relationshipType values
  ✓ accepts all valid confidence values: high|medium|low
  ✓ confidence is optional (undefined accepted)
  ✓ targetTitle is optional
```

---

## Cross-cutting concerns to verify

```
Error propagation audit
  ✓ No pipeline function silently swallows errors that should surface
  ✓ All "non-fatal" catch blocks log before swallowing
  ✓ All route handlers return structured error JSON (not raw Error.message)

Auth coverage audit
  ✓ /brain-dump/* requires auth
  ✓ /rag/* requires auth
  ✓ /consistency/check requires auth
  ✓ /suggest/* requires auth
  ✓ /health does NOT require auth (public health check)
  ✓ /setup/seed-templates — VERIFY if this should require auth (currently no guard)
  ✓ /import/* — VERIFY if these should require auth (currently no guard)

Security audit
  ✓ sanitizeFilterValue rejects all non-alphanumeric-hyphen-underscore input
  ✓ ETAPI token never appears in logs
  ✓ BETTER_AUTH_SECRET never appears in logs
  ✓ OPENROUTER_API_KEY never appears in logs
```

---

## Running the tests

```bash
# All tests
bun test

# Watch mode
bun test --watch

# Specific file
bun test src/rag/chunk-dedup.test.ts

# With coverage
bun test --coverage

# Integration tests only (slower)
bun test --testPathPattern integration
```

## Coverage targets

| Module | Target |
|--------|--------|
| `src/utils/` | 100% |
| `src/rag/chunk-dedup.ts` | 100% |
| `src/rag/lancedb.ts` (pure) | 100% |
| `src/pipeline/parser.ts` | 100% |
| `src/pipeline/azgaar.ts` (pure) | 100% |
| `src/pipeline/model-router.ts` (`getModelChain`) | 100% |
| `src/etapi/client.ts` | 95%+ |
| `src/pipeline/brain-dump.ts` | 90%+ |
| `src/routes/` | 85%+ |
| `src/rag/lancedb.ts` (integration) | 80%+ |
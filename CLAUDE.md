# CLAUDE.md — AllKnower

AI orchestrator service. Bun runtime, Elysia HTTP framework, Prisma/Postgres for state, LanceDB for vector embeddings, OpenRouter for all LLM calls.

## Development Commands

```bash
bun install
bun dev                    # dev on :3001
bun db:generate && bun db:migrate   # after schema changes
bun run check              # tsc --noEmit && bun test (per-directory groups)
bun typecheck              # tsc --noEmit only
```

## Coding Conventions

- Bun ESM, `moduleResolution: "bundler"` — imports use `.ts` extensions
- Elysia `t` schemas at HTTP boundaries; Zod for domain/LLM validation
- All LLM/embedding calls go through OpenRouter via `src/pipeline/model-router.ts`
- Routes use a factory/DI pattern: `createXRoute({ dep1, dep2 })` — inject mocks in tests, real impls in production
- Pipeline modules (`src/pipeline/`) are the core business logic
- Lore types defined in `src/types/lore.ts` — single source of truth for entity schemas

## Key Files

| What | Where |
|---|---|
| App setup + route registration | `src/app.ts` |
| Brain dump pipeline | `src/pipeline/brain-dump.ts` |
| Article copilot pipeline | `src/pipeline/article-copilot.ts` |
| Model router (LLM dispatch) | `src/pipeline/model-router.ts` |
| ETAPI client (→ AllCodex Core) | `src/etapi/client.ts` |
| Credential resolver | `src/integrations/allcodex.ts` |
| RAG embedder + vector search | `src/rag/embedder.ts`, `src/rag/lancedb.ts` |
| Prisma schema | `prisma/schema.prisma` |
| Lore type definitions (21 types) | `src/types/lore.ts` |

## Testing

### Running Tests

```bash
bun run check              # canonical CI command — typecheck + all test groups + E2E
bun test test/*.test.ts test/unit/ test/integration/   # unit + integration (excludes E2E)
bun run test:e2e           # E2E tests only (each file isolated)
bun test src/etapi/        # ETAPI client tests
bun test src/pipeline/parser.test.ts   # each pipeline file individually
bun test src/routes/       # route tests
bun test src/rag/indexer.test.ts       # each rag file individually
```

**Never run `bun test test/` (recursive)** — it includes `test/e2e/` which has different mock surfaces. Use `bun test test/*.test.ts test/unit/ test/integration/` instead.

**Never run `bun test src/pipeline/` or `bun test src/rag/` as a directory** — CI runs each file individually to avoid cross-file mock.module() contamination. Use `bun run check` for the canonical CI-equivalent command.

### E2E Tests

E2E tests live in `test/e2e/` and hit real Postgres via Prisma + real LanceDB (temp dir), with mocked LLM and ETAPI.

**Architecture:**
- `test/helpers/e2e-mock-setup.ts` — top-level `mock.module()` calls imported as side effect (must run before app.ts)
- `test/helpers/mock-llm.ts` — LLM response map + model-router/prompt mocks
- `test/helpers/e2e-harness.ts` — utilities only (no mocks), re-exports helpers
- DI routes (brain-dump, copilot, import, setup, consistency, config) use `createXRoute()` factory
- Non-DI routes (rag, suggest, integrations) use `await import("../../src/app.ts")` with auth-guard mocked in setup

**Adding new E2E tests:**
1. Create `test/e2e/feature.e2e.test.ts`
2. Import `test/helpers/e2e-mock-setup.ts` before any app imports
3. Add `bun test test/e2e/feature.e2e.test.ts` to `test`, `check`, and `test:e2e` scripts in package.json
4. If the route uses DI factory, import `createXRoute` directly; otherwise dynamic-import `src/app.ts`

### Contract Tests

Contract tests live in `test/contracts/` and validate cross-service HTTP boundary shapes — "does the JSON shape match what the other service expects?"

**Three contract surfaces:**
- `portal-allknower.contract.test.ts` — 19 tests: mocks pipelines, hits all AllKnower routes via `app.handle()`, validates response shapes Portal depends on
- `allknower-core.contract.test.ts` — 6 tests: mock ETAPI server on port 18080, validates etapi/client.ts parses Core responses correctly
- `portal-core.contract.test.ts` — 10 tests: pure fixture-shape validation (no server), checks recorded ETAPI responses match Portal's expectations
- `schema-drift.test.ts` — 3 tests: regex comparison of Portal vs AllKnower Zod schema names, warns on drift

**Key infrastructure:**
- `test/helpers/contract-helpers.ts` — `assertMatchesSchema()`, `assertFieldsPresent()`, `assertArrayOf()`
- `test/helpers/etapi-fixtures.ts` — `ETAPI_FIXTURES` object + `createMockEtapiServer(port)`
- `test/fixtures/etapi-responses/` — 6 recorded JSON/txt files matching real Core ETAPI shapes

**Critical pattern — Portal→AllKnower tests:**
Use ONLY dynamic `import("../../src/app.ts")` for fullApp. Do NOT statically import DI factory routes (e.g., `createCopilotRoute`) — the static import triggers the real auth-guard module graph before `mock.module()` takes effect, breaking auth bypass.

**Adding new contract tests:**
1. Create `test/contracts/feature.contract.test.ts`
2. Add `bun test test/contracts/feature.contract.test.ts` to `test`, `check`, and `test:contracts` scripts in package.json
3. For Portal→AllKnower contracts: mock all pipeline deps, use dynamic import for app.ts

```bash
bun run test:contracts     # contract tests only
```

### mock.module() Rules (Critical)

Bun's `mock.module()` replaces the entire module in the shared registry for the duration of the `bun test` invocation. This creates a hard requirement:

1. **Every `mock.module()` must export the full surface area of the real module** — not just the functions the test uses. Missing exports cascade as `SyntaxError: Export named 'X' not found` in downstream test files.
2. **When adding a new export to a source module**, grep for all `mock.module()` calls targeting it and add the export to each.
3. Pipeline and rag tests run as **individual file invocations** (not per-directory) to prevent cross-file contamination. `db/client.ts` has a top-level `await` that `mock.module()` cannot suppress — env mocks that lack `DATABASE_URL` will crash it. See `package.json` `test` script for canonical groups.
4. **When mocking `../env.ts`**, always include `DATABASE_URL` and `NODE_ENV` — even if the test doesn't use them. Other files' side-effects read env during module graph resolution.

The two most-mocked modules are `src/etapi/client.ts` (13 function exports) and `src/integrations/allcodex.ts` (5 exports + 1 class). Both need complete mocks in every test file that references them.

### Load & Performance Tests

Load tests live in `perf/` and use k6 + a mock OpenRouter server. Not part of CI — run manually.

```bash
# Prerequisites: AllKnower running on :3001, k6 installed
bun run perf/seed/seed-perf-data.ts   # seed test data (once)
./perf/run.sh health-baseline          # run a scenario
./perf/run.sh mixed-workload           # realistic traffic mix
```

**Key files:**
- `perf/mock-openrouter/server.ts` — instant-response mock LLM on :19001
- `perf/k6/scenarios/` — 8 scenarios (health, RAG, brain-dump, copilot, suggest, mixed, lock contention)
- `perf/run.sh` — orchestrates mock server startup + k6 execution
- `perf/seed/seed-perf-data.ts` — seeds 20 brain dumps + RAG reindex

**To use mock LLM:** set `OPENROUTER_BASE_URL=http://localhost:19001/api/v1` in AllKnower `.env`.

## Common Pitfalls

1. **Prisma tests need live Postgres**: routes that call Prisma inline (e.g. `history/:id`) cannot be tested with the DI mock — they require a running Postgres instance.
2. **Elysia listen race**: always `await app.listen(PORT)` before accessing `app.server` — synchronous `app.listen()` leaves `app.server` null.
3. **`.env.test` requires server restart**: env vars load once at startup — `/health` returning 200 does not mean the new env is active. After editing `.env.test`, kill the watcher and restart with `bun --env-file=.env.test dev`.
4. **LLM JSON schema `required` array prevents silent no-ops**: fallback models (e.g. `x-ai/grok-4.3`) silently omit fields absent from `required` even if present in `properties`. Always include all expected output fields in `required`.
5. **`autoRelate` latency scales with entity count**: `suggestRelationsForNote` runs once per created note (~30-40s each). A 3-entity brain dump triggers 3 sequential LLM calls; keep integration test fixtures to 1 entity to stay under timeout ceilings.
6. **Single credential provider**: `src/integrations/allcodex.ts` is the only credential module. The old `core.ts` and `crypto.ts` modules (and the migration script) have been deleted — do not recreate them.
7. **`/config/wipe` is user-scoped**: deleteMany calls filter by `session.user.id`. RAG + `ragIndexMeta` are full-wiped (note-scoped, not user-scoped). `LoreSessionMessage` cascades via `onDelete: Cascade` on the `LoreSession` FK.
8. **`etapiFetch` has a 30s default timeout**: if no `signal` is provided, `AbortSignal.timeout(30_000)` is used. Callers that need different timeouts must pass their own signal.

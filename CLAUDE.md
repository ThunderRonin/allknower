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
bun run check              # canonical CI command — typecheck + all test groups
bun test test/             # unit tests (test/ directory)
bun test src/etapi/        # ETAPI client tests
bun test src/pipeline/     # pipeline tests
bun test src/routes/       # route tests
bun test src/rag/indexer.test.ts   # individual rag files (not bun test src/rag/)
```

**Never run `bun test src/rag/` as a directory** — CI runs each rag test file individually to avoid cross-file contamination. Use `bun run check` for the canonical CI-equivalent command.

### mock.module() Rules (Critical)

Bun's `mock.module()` replaces the entire module in the shared registry for the duration of the `bun test` invocation. This creates a hard requirement:

1. **Every `mock.module()` must export the full surface area of the real module** — not just the functions the test uses. Missing exports cascade as `SyntaxError: Export named 'X' not found` in downstream test files.
2. **When adding a new export to a source module**, grep for all `mock.module()` calls targeting it and add the export to each.
3. Tests run as separate per-directory invocations (`bun test test/`, `bun test src/etapi/`, etc.) to limit contamination scope. See `package.json` `test` script for the canonical groups.

The two most-mocked modules are `src/etapi/client.ts` (13 function exports) and `src/integrations/allcodex.ts` (5 exports + 1 class). Both need complete mocks in every test file that references them.

## Common Pitfalls

1. **Prisma tests need live Postgres**: routes that call Prisma inline (e.g. `history/:id`) cannot be tested with the DI mock — they require a running Postgres instance.
2. **Elysia listen race**: always `await app.listen(PORT)` before accessing `app.server` — synchronous `app.listen()` leaves `app.server` null.
3. **`.env.test` requires server restart**: env vars load once at startup — `/health` returning 200 does not mean the new env is active. After editing `.env.test`, kill the watcher and restart with `bun --env-file=.env.test dev`.
4. **LLM JSON schema `required` array prevents silent no-ops**: fallback models (e.g. `x-ai/grok-4.1-fast`) silently omit fields absent from `required` even if present in `properties`. Always include all expected output fields in `required`.
5. **`autoRelate` latency scales with entity count**: `suggestRelationsForNote` runs once per created note (~30-40s each). A 3-entity brain dump triggers 3 sequential LLM calls; keep integration test fixtures to 1 entity to stay under timeout ceilings.

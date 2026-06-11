# <img src="../logo/grimoire.svg" width="40" height="40" align="center" style="margin-right: 10px;" /> AllKnower

The intelligence layer behind [AllCodex](https://github.com/ThunderRonin/AllCodex). An AI orchestration service for managing the **All Reach** fantasy world grimoire, built with **Elysia** on **Bun**.

---

## What it does

AllKnower provides the following services:

| Feature | Description |
|---|---|
| **Brain Dump** | Paste raw worldbuilding notes to extract structured lore entities and create or update notes in AllCodex via the ETAPI. AllKnower auto-applies high-confidence relation suggestions after creation. |
| **RAG System** | AllKnower embeds all lore via Qwen and stores it in LanceDB. It handles reranking via OpenRouter's native `/rerank` endpoint (`cohere/rerank-4-pro`) for second-pass relevance scoring, falling back to vector similarity on timeout. |
| **Article Copilot** | Conversational AI assistant scoped to a single lore article. It proposes edits, creates linked notes, and updates labels and relations within an explicit writable scope to prevent unintended changes to other notes. |
| **Lore Autocomplete** | Instant title suggestions via two-phase lookup (SQL prefix match and semantic fallback) for inline linking in AllCodex. |
| **Consistency Checker** | On-demand scan for contradictions, timeline conflicts, orphaned references, and naming inconsistencies. |
| **Relationship Suggester** | Suggests connections between entities with `high/medium/low` confidence. AllKnower auto-applies high-confidence suggestions during brain dumps. |
| **Relation Writing** | `POST /suggest/relationships/apply`: Writes approved relation suggestions as Trilium `relation` attributes (bidirectional by default). AllKnower logs applied relations to `relation_history`. |
| **Lore Gap Detector** | Identifies underdeveloped areas in the worldbuilding (e.g., "many characters, few locations"). |

---

## Stack

| Layer | Tech |
|---|---|
| Runtime | Bun |
| Framework | Elysia |
| Database | PostgreSQL + Prisma |
| Auth | better-auth (supports Bearer + Session) |
| Vector DB | LanceDB (embedded) |
| Embeddings | `qwen/qwen3-embedding-8b` via OpenRouter |
| Reranker | `cohere/rerank-4-pro` via OpenRouter `/rerank` endpoint (not chat completions) |
| LLM — Brain Dump | `minimax/minimax-m2.5` via OpenRouter |
| LLM — Consistency | `moonshotai/kimi-k2.5` via OpenRouter |
| Background Jobs | `elysia-background` (with version 1.2.1 patch) |
| API Docs | Scalar at `/reference` |
| Type Safety | Hybrid (TypeBox for HTTP, Zod for LLM Data) |

---

## Getting started

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.2
- PostgreSQL, or Docker for the included `docker-compose.yml`
- A running AllCodex instance with an ETAPI token
- An [OpenRouter](https://openrouter.ai) API key

### Setup

```bash
# 1. Install dependencies
bun install

# Troubleshooting for limited bandwidth:
# bun install --network-concurrency 1 --concurrent-scripts 1

# 2. Start local Postgres
docker compose up -d postgres

# 3. Configure environment
cp .env.example .env
# .env.example already matches docker-compose.yml:
# DATABASE_URL=postgresql://allknower:allknower@localhost:5436/allknower
# Fill in OPENROUTER_API_KEY, ALLCODEX_ETAPI_TOKEN, BETTER_AUTH_SECRET

# 4. Run database migrations
bun db:migrate

# 5. Start the server
bun dev

# 6. Check dependency health
curl http://localhost:3001/health
```

Server starts at `http://localhost:3001`.
API docs at `http://localhost:3001/reference`.

`/health` is a composite dependency check. It returns `503` with `status: "degraded"` until required dependencies like Postgres, AllCodex Core, and LanceDB are reachable. Degraded status occurs during partial local setups when dependencies are offline.

---

## Environment variables

See [`.env.example`](.env.example) for the full list. Required vars:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `BETTER_AUTH_SECRET` | Random secret ≥ 16 chars for session signing |
| `INTEGRATION_CREDENTIALS_KEY` | 32-byte secret for encrypting user-scoped Core tokens at rest |
| `PORTAL_INTERNAL_SECRET` | Shared secret for Portal to resolve credentials |
| `ALLCODEX_ETAPI_TOKEN` | AllCodex ETAPI token (used *only* as a fallback for local dev) |
| `*_MODEL` / `*_FALLBACK` | Refer to `.env.example` for task-specific LLM model preferences |

---

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/brain-dump` | Process raw worldbuilding text |
| `GET` | `/brain-dump/history` | Last 20 brain dump operations |
| `POST` | `/rag/query` | Semantic search over lore index |
| `POST` | `/rag/reindex/:noteId` | Reindex a single note (background) |
| `POST` | `/rag/reindex` | Full corpus reindex |
| `GET` | `/rag/status` | Index stats |
| `POST` | `/consistency/check` | Run consistency scan |
| `POST` | `/suggest/relationships` | Suggest lore connections |
| `POST` | `/suggest/relationships/apply` | Write suggested relations back to AllCodex |
| `GET\|POST` | `/suggest/gaps` | Detect lore gaps |
| `POST` | `/copilot/article` | Article-scoped copilot turn (returns proposal) |
| `GET` | `/suggest/autocomplete` | Title autocomplete (prefix + semantic fallback) |
| `POST` | `/import/azgaar` | Bulk-import locations and factions from an Azgaar FMG export |
| `GET` | `/health` | Deep service health check (ETAPI, Postgres, LanceDB) |
| `GET` | `/reference` | Scalar API docs |

---

## Project structure

```
src/
├── index.ts              # App entry point
├── env.ts                # Typesafe env schema
├── auth/                 # better-auth setup (Bearer enabled)
├── db/                   # Prisma client
├── etapi/                # AllCodex ETAPI client (createRelation, createAttribute, etc.)
├── pipeline/
│   ├── brain-dump.ts     # Main orchestrator (includes auto-relate step)
│   ├── relations.ts      # Shared relation suggest + apply pipeline
│   ├── prompt.ts         # LLM calls (callLLM)
│   └── parser.ts         # Zod LLM response parser
├── plugins/              # Elysia infrastructure plugins
├── rag/
│   ├── embedder.ts       # Service-agnostic cloud embedder
│   ├── lancedb.ts        # Vector store + OpenRouter native reranker
│   └── indexer.ts        # Index lifecycle management
├── routes/               # API route handlers
└── types/
    └── lore.ts           # Central Zod schemas (lore entities, relation types, etc.)
```

---

## Contributing

This project is purpose-built for the All Reach grimoire, but the architecture is generic enough to work with any worldbuilding project on top of a Trilium/AllCodex instance.

If you want to contribute:

- Open an issue before starting significant work so we can discuss direction
- Keep PRs focused — one feature or fix per PR
- Follow the existing code style (TypeScript strict, Elysia routes, Zod schemas in `src/types/lore.ts`)
- New routes need an entry in the API table in this README

See [docs/remaining-features-plan.md](docs/remaining-features-plan.md) for a list of planned features with detailed specs if you're looking for something to pick up.

## License

MIT

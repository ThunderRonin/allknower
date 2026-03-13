# AllKnower

The intelligence layer behind [AllCodex](https://github.com/ThunderRonin/AllCodex). An AI orchestration service for managing the **All Reach** fantasy world grimoire, built with **Elysia** on **Bun**.

---

## What it does

AllKnower sits behind AllCodex and provides:

| Feature | Description |
|---|---|
| **Brain Dump** | Paste raw worldbuilding notes → LLM extracts structured lore entities → creates/updates notes in AllCodex via ETAPI. Auto-applies high-confidence relation suggestions after creation. |
| **RAG System** | All lore is embedded via cloud models (Qwen) and stored in LanceDB. Hybrid reranking auto-dispatches between a local Xenova cross-encoder (simple queries) and LLM-as-a-Judge (complex relational queries) for optimal context quality. |
| **Lore Autocomplete** | Instant title suggestions via two-phase lookup (SQL prefix match + semantic fallback) for inline linking in AllCodex. |
| **Consistency Checker** | On-demand scan for contradictions, timeline conflicts, orphaned references, and naming inconsistencies. |
| **Relationship Suggester** | Suggests connections between entities with `high/medium/low` confidence. High-confidence suggestions are auto-applied to AllCodex on brain dump. |
| **Relation Writing** | `POST /suggest/relationships/apply` — writes approved relation suggestions as Trilium `relation` attributes (bidirectional by default). All applied relations logged to `relation_history`. |
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
| Reranker (simple) | `Xenova/ms-marco-MiniLM-L-6-v2` (local, ~80MB one-time download) |
| Reranker (complex) | LLM-as-a-Judge via `RERANK_MODEL` (auto-dispatched) |
| LLM — Brain Dump | `minimax/minimax-m2.5` via OpenRouter |
| LLM — Consistency | `moonshotai/kimi-k2.5` via OpenRouter |
| Background Jobs | `elysia-background` (with version 1.2.1 patch) |
| API Docs | Scalar at `/reference` |
| Type Safety | Hybrid (TypeBox for HTTP, Zod for LLM Data) |

---

## Getting started

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.2
- PostgreSQL
- A running AllCodex instance with an ETAPI token
- An [OpenRouter](https://openrouter.ai) API key

### Setup

```bash
# 1. Install dependencies
bun install

# Troubleshooting for limited bandwidth:
# bun install --network-concurrency 1 --concurrent-scripts 1

# 2. Configure environment
cp .env.example .env
# Fill in DATABASE_URL, OPENROUTER_API_KEY, ALLCODEX_ETAPI_TOKEN, BETTER_AUTH_SECRET

# 3. Run database migrations
bun db:migrate

# 4. Start the server
bun dev
```

Server starts at `http://localhost:3001`.
API docs at `http://localhost:3001/reference`.

---

## Environment variables

See [`.env.example`](.env.example) for the full list. Required vars:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `ALLCODEX_ETAPI_TOKEN` | AllCodex ETAPI token (from AllCodex settings) |
| `BETTER_AUTH_SECRET` | Random secret ≥ 16 chars for session signing |

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
| `GET` | `/suggest/gaps` | Detect lore gaps |
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
│   ├── lancedb.ts        # Vector store + hybrid reranker (Xenova / LLM-as-a-Judge)
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

---

## License

MIT

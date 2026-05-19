# AllKnower Performance Tests

## Prerequisites

- AllKnower running locally on `:3001`
- k6 installed (`brew install k6`)
- Bun installed

## Quick Start

```bash
# Seed test data (run once)
bun run perf/seed/seed-perf-data.ts

# Run a specific scenario
./perf/run.sh health-baseline
./perf/run.sh rag-query
./perf/run.sh brain-dump-single
./perf/run.sh mixed-workload
./perf/run.sh compaction-lock

# Run all scenarios
for s in health-baseline rag-query brain-dump-single copilot-session suggest-relationships mixed-workload; do
    ./perf/run.sh $s
done
```

## Scenarios

| Scenario | VUs | Duration | Target |
|---|---|---|---|
| health-baseline | 5→20 | 90s | p95<100ms |
| rag-query | 5→20 | 90s | p95<500ms |
| brain-dump-single | 2 | 30s | p95<3s |
| brain-dump-concurrent | 10 | 60s | p95<5s |
| copilot-session | 2 | 30s | p95<3s |
| suggest-relationships | 2 | 30s | p95<5s |
| mixed-workload | 5→20 | 90s | p95<2s |
| compaction-lock | 5 | 30s | <20% failure |

## Interpreting Results

- **http_req_duration**: end-to-end latency. p95 is the primary metric.
- **http_reqs**: throughput (requests/sec). Higher is better.
- **http_req_failed**: error rate. Should be <5% for most scenarios.
- **iteration_duration**: time per k6 iteration (may include sleep).

## Environment Variables

- `ALLKNOWER_URL`: AllKnower base URL (default: `http://localhost:3001`)
- `AUTH_TOKEN`: Bearer token for authenticated endpoints
- `MOCK_PORT`: Mock OpenRouter port (default: `19001`)
- `OPENROUTER_BASE_URL`: Set to `http://localhost:19001/api/v1` in AllKnower .env

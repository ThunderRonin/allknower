# Compaction Accuracy Evaluation

## What This Measures

Tests whether the session compaction system retains critical context across compaction boundaries. Each golden session contains tagged facts — after compaction, we check how many facts survive in the compressed state.

## Prerequisites

- AllKnower DB running (Postgres)
- LLM endpoint configured (real or mock via OPENROUTER_BASE_URL)

## Running

```bash
# Run all sessions
bun run eval/compaction-eval.ts

# Run single session
bun run eval/compaction-eval.ts --session=kingdom-founding

# Custom threshold (default 80%)
bun run eval/compaction-eval.ts --threshold=0.9
```

## Interpreting Results

- **State accuracy**: facts found in compacted JSON state
- **Context accuracy**: facts found in rebuilt context string (includes re-injected notes)
- **Degradation**: accuracy drop between 1st and 2nd compaction (multi-compaction session only)

## Thresholds

| Metric | Target | Action if Below |
|---|---|---|
| Overall accuracy | >=80% | Investigate compaction prompt or schema |
| Weighted accuracy | >=70% | Hard facts (names, numbers) being lost |
| Degradation | <5% drop | Compaction prompt losing cumulative context |
| Hard difficulty probes | >=60% | Specific detail categories being dropped |

## When to Run

- Before/after changing `SESSION_COMPACT_SYSTEM` prompt
- Before/after changing `LoreSessionStateSchema`
- Before/after changing `POST_COMPACT_BUDGET` or `SESSION_TOKEN_THRESHOLD`
- After model changes for `session-compact` task

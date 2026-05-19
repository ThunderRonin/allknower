# AllKnower Load & Performance Tests — Implementation Plan

> **Status: COMPLETE — Executed 2026-05-19. 8 k6 scenarios, mock OpenRouter server, seed script, run orchestrator.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable load/perf test suite for AllKnower that measures latency, throughput, and resource behavior under concurrent load. Identify bottlenecks in LLM-dependent endpoints, database lock contention, and RAG query scalability.

**Architecture:** k6 scripts targeting a locally-running AllKnower instance with real Postgres + LanceDB. LLM calls hit a mock OpenRouter server (instant responses) to isolate infrastructure perf from LLM latency. Tests produce JSON results and optional HTML reports.

**Tech Stack:** k6 (Grafana load testing tool), Bun (mock OpenRouter server), Postgres, LanceDB.

**CI:** No — load tests are manual/scheduled, not gating. Too variable for CI pass/fail. Run locally or in a dedicated perf environment.

**Prerequisite:** AllKnower running locally with seeded data (brain dump history, RAG index, lore sessions). Mock OpenRouter server running on a separate port.

---

## File Structure

```
perf/
├── k6/
│   ├── config.js                    # NEW — shared k6 config (thresholds, stages)
│   ├── helpers/
│   │   ├── auth.js                  # NEW — auth token helper for k6
│   │   └── checks.js               # NEW — shared response checks
│   ├── scenarios/
│   │   ├── health-baseline.js       # NEW — baseline: /health RPS ceiling
│   │   ├── brain-dump-single.js     # NEW — single brain dump under load
│   │   ├── brain-dump-concurrent.js # NEW — concurrent brain dumps
│   │   ├── rag-query.js             # NEW — RAG vector query throughput
│   │   ├── copilot-session.js       # NEW — multi-turn copilot sessions
│   │   ├── suggest-relationships.js # NEW — relationship suggestion latency
│   │   ├── mixed-workload.js        # NEW — realistic multi-endpoint mix
│   │   └── compaction-lock.js       # NEW — session compaction lock contention
│   └── results/                     # gitignored — JSON output dir
├── mock-openrouter/
│   └── server.ts                    # NEW — instant-response mock LLM server
├── seed/
│   └── seed-perf-data.ts            # NEW — seed DB with test data for perf runs
├── run.sh                           # NEW — orchestrates mock server + k6 run
└── README.md                        # NEW — how to run, interpret results
```

---

## Task 1: Mock OpenRouter Server

**Files:**
- Create: `perf/mock-openrouter/server.ts`

LLM calls dominate AllKnower latency. To isolate infrastructure perf, we replace OpenRouter with an instant-response mock that returns valid JSON matching each task's expected schema.

- [ ] **Step 1: Create mock OpenRouter server**

```typescript
// perf/mock-openrouter/server.ts

const MOCK_RESPONSES: Record<string, string> = {
    default: JSON.stringify({
        entities: [
            { type: "character", title: "Aldric", content: "<p>King of Valorheim.</p>", action: "create" },
        ],
        summary: "Extracted Aldric.",
    }),
    compact: JSON.stringify({
        intent: "Building kingdom lore",
        loreTypesInPlay: ["character", "location"],
        noteIdsModified: ["note-1"],
        skippedEntities: [],
        rawInputsSummary: "User described Aldric.",
        unresolvedGaps: [],
        currentFocus: "Aldric",
        lastCompactedAt: new Date().toISOString(),
        totalTokensConsumed: 85000,
        schemaVersion: 1,
    }),
    copilot: JSON.stringify({
        reply: "Aldric is a compelling character. Consider adding his lineage.",
        proposal: null,
        citations: [],
    }),
    consistency: JSON.stringify({
        issues: [{ noteId: "note-1", noteTitle: "Aldric", issue: "Missing birth year", severity: "low", suggestion: "Add it" }],
    }),
    gaps: JSON.stringify({
        areas: [{ category: "character", gap: "No antagonist", suggestion: "Create one" }],
    }),
    relations: JSON.stringify({
        suggestions: [{ sourceNoteId: "note-1", targetNoteId: "note-2", type: "rulerOf", name: "rules", description: "Rules Valorheim", confidence: 0.9 }],
    }),
};

function detectTask(body: any): string {
    const messages = body?.messages ?? [];
    const lastMsg = messages[messages.length - 1]?.content ?? "";
    if (lastMsg.includes("compact") || lastMsg.includes("archivist")) return "compact";
    if (lastMsg.includes("copilot") || lastMsg.includes("article")) return "copilot";
    if (lastMsg.includes("consistency")) return "consistency";
    if (lastMsg.includes("gap")) return "gaps";
    if (lastMsg.includes("relation")) return "relations";
    return "default";
}

const server = Bun.serve({
    port: parseInt(process.env.MOCK_PORT ?? "19001"),
    async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/api/v1/chat/completions") {
            const body = await req.json().catch(() => ({}));
            const task = detectTask(body);
            const content = MOCK_RESPONSES[task] ?? MOCK_RESPONSES.default;

            // Simulate minimal latency (5ms)
            await new Promise((r) => setTimeout(r, 5));

            return Response.json({
                id: `chatcmpl-perf-${Date.now()}`,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: body.model ?? "test-model",
                choices: [{
                    index: 0,
                    message: { role: "assistant", content },
                    finish_reason: "stop",
                }],
                usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
            });
        }

        if (url.pathname === "/api/v1/models") {
            return Response.json({ data: [{ id: "test-model", name: "Test Model" }] });
        }

        return new Response("Not Found", { status: 404 });
    },
});

console.log(`Mock OpenRouter running on :${server.port}`);
```

- [ ] **Step 2: Verify mock starts**

```bash
bun run perf/mock-openrouter/server.ts &
curl -s http://localhost:19001/api/v1/models | jq .
kill %1
```

- [ ] **Step 3: Commit**

```bash
git add perf/mock-openrouter/server.ts
git commit -m "perf: add mock OpenRouter server for load testing

Instant-response mock that returns valid JSON for each AllKnower task type.
5ms simulated latency to isolate infrastructure perf from LLM latency."
```

---

## Task 2: k6 Shared Config + Helpers

**Files:**
- Create: `perf/k6/config.js`
- Create: `perf/k6/helpers/auth.js`
- Create: `perf/k6/helpers/checks.js`

- [ ] **Step 1: Create shared k6 config**

```javascript
// perf/k6/config.js
export const BASE_URL = __ENV.ALLKNOWER_URL || "http://localhost:3001";
export const AUTH_TOKEN = __ENV.AUTH_TOKEN || "perf-test-token";

export const defaultThresholds = {
    http_req_duration: ["p(95)<2000", "p(99)<5000"],
    http_req_failed: ["rate<0.05"],
    http_reqs: ["rate>10"],
};

export const defaultStages = [
    { duration: "10s", target: 5 },   // ramp up
    { duration: "30s", target: 5 },   // steady
    { duration: "10s", target: 20 },  // spike
    { duration: "30s", target: 20 },  // sustained spike
    { duration: "10s", target: 0 },   // ramp down
];

export const lightStages = [
    { duration: "5s", target: 2 },
    { duration: "20s", target: 2 },
    { duration: "5s", target: 0 },
];

export const heavyStages = [
    { duration: "10s", target: 10 },
    { duration: "60s", target: 10 },
    { duration: "10s", target: 50 },
    { duration: "60s", target: 50 },
    { duration: "10s", target: 0 },
];
```

- [ ] **Step 2: Create auth helper**

```javascript
// perf/k6/helpers/auth.js
import { BASE_URL, AUTH_TOKEN } from "../config.js";

export function authHeaders() {
    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AUTH_TOKEN}`,
    };
}

export function url(path) {
    return `${BASE_URL}${path}`;
}
```

- [ ] **Step 3: Create checks helper**

```javascript
// perf/k6/helpers/checks.js
import { check } from "k6";

export function checkStatus(res, expected = 200, name = "") {
    const label = name || `status is ${expected}`;
    check(res, { [label]: (r) => r.status === expected });
}

export function checkJson(res, name = "response is JSON") {
    check(res, {
        [name]: (r) => {
            try {
                JSON.parse(r.body);
                return true;
            } catch {
                return false;
            }
        },
    });
}

export function checkLatency(res, maxMs, name = "") {
    const label = name || `latency < ${maxMs}ms`;
    check(res, { [label]: (r) => r.timings.duration < maxMs });
}
```

- [ ] **Step 4: Commit**

```bash
git add perf/k6/
git commit -m "perf: k6 shared config, auth helper, response checks

Thresholds: p95<2s, p99<5s, <5% failure rate.
Three stage profiles: light (2 VUs), default (5→20 VUs), heavy (10→50 VUs)."
```

---

## Task 3: Baseline Scenarios

**Files:**
- Create: `perf/k6/scenarios/health-baseline.js`
- Create: `perf/k6/scenarios/rag-query.js`

- [ ] **Step 1: Health baseline — measures raw framework overhead**

```javascript
// perf/k6/scenarios/health-baseline.js
import http from "k6/http";
import { url } from "../helpers/auth.js";
import { checkStatus, checkLatency } from "../helpers/checks.js";
import { defaultThresholds, defaultStages } from "../config.js";

export const options = {
    stages: defaultStages,
    thresholds: {
        ...defaultThresholds,
        http_req_duration: ["p(95)<100", "p(99)<200"], // health should be fast
    },
};

export default function () {
    const res = http.get(url("/health"));
    checkStatus(res, 200);
    checkLatency(res, 200, "health < 200ms");
}
```

- [ ] **Step 2: RAG query throughput**

```javascript
// perf/k6/scenarios/rag-query.js
import http from "k6/http";
import { url, authHeaders } from "../helpers/auth.js";
import { checkStatus, checkJson } from "../helpers/checks.js";
import { defaultThresholds, defaultStages } from "../config.js";

export const options = {
    stages: defaultStages,
    thresholds: {
        ...defaultThresholds,
        http_req_duration: ["p(95)<500", "p(99)<1000"],
    },
};

const queries = [
    "Aldric king Valorheim",
    "magic sword ancient",
    "northern kingdom winter",
    "dragon lair mountains",
    "royal court politics",
];

export default function () {
    const query = queries[Math.floor(Math.random() * queries.length)];
    const payload = JSON.stringify({ query, topK: 5 });
    const res = http.post(url("/rag/query"), payload, { headers: authHeaders() });
    checkStatus(res, 200);
    checkJson(res);
}
```

- [ ] **Step 3: Run baseline**

```bash
k6 run perf/k6/scenarios/health-baseline.js
k6 run perf/k6/scenarios/rag-query.js
```

- [ ] **Step 4: Commit**

```bash
git add perf/k6/scenarios/health-baseline.js perf/k6/scenarios/rag-query.js
git commit -m "perf: health baseline and RAG query throughput scenarios

Health: p95<100ms target, measures Elysia framework overhead.
RAG: p95<500ms target, rotates 5 query variants, measures LanceDB throughput."
```

---

## Task 4: LLM-Dependent Scenarios

**Files:**
- Create: `perf/k6/scenarios/brain-dump-single.js`
- Create: `perf/k6/scenarios/brain-dump-concurrent.js`
- Create: `perf/k6/scenarios/copilot-session.js`
- Create: `perf/k6/scenarios/suggest-relationships.js`

- [ ] **Step 1: Single brain dump**

```javascript
// perf/k6/scenarios/brain-dump-single.js
import http from "k6/http";
import { url, authHeaders } from "../helpers/auth.js";
import { checkStatus, checkJson, checkLatency } from "../helpers/checks.js";
import { defaultThresholds, lightStages } from "../config.js";

export const options = {
    stages: lightStages,
    thresholds: {
        ...defaultThresholds,
        http_req_duration: ["p(95)<3000"],
    },
};

const texts = [
    "Aldric is the king of Valorheim. He rules from the Iron Citadel.",
    "Elara is a sorceress who studies the ancient texts of the Mage Tower.",
    "The Dragon's Spine mountains separate the northern and southern realms.",
];

export default function () {
    const rawText = texts[Math.floor(Math.random() * texts.length)];
    const payload = JSON.stringify({ rawText, mode: "auto" });
    const res = http.post(url("/brain-dump"), payload, {
        headers: authHeaders(),
        timeout: "10s",
    });
    checkStatus(res, 200);
    checkJson(res);
    checkLatency(res, 5000, "brain-dump < 5s");
}
```

- [ ] **Step 2: Concurrent brain dumps**

```javascript
// perf/k6/scenarios/brain-dump-concurrent.js
import http from "k6/http";
import { url, authHeaders } from "../helpers/auth.js";
import { checkStatus } from "../helpers/checks.js";
import { defaultThresholds } from "../config.js";

export const options = {
    scenarios: {
        concurrent_dumps: {
            executor: "constant-vus",
            vus: 10,
            duration: "60s",
        },
    },
    thresholds: {
        ...defaultThresholds,
        http_req_duration: ["p(95)<5000"],
        http_req_failed: ["rate<0.10"], // 10% failure acceptable under high concurrency
    },
};

export default function () {
    const id = __VU * 1000 + __ITER;
    const payload = JSON.stringify({
        rawText: `Character ${id}: A warrior from the ${id % 3 === 0 ? "north" : "south"}.`,
        mode: "auto",
    });
    const res = http.post(url("/brain-dump"), payload, {
        headers: authHeaders(),
        timeout: "15s",
    });
    checkStatus(res, 200);
}
```

- [ ] **Step 3: Copilot multi-turn session**

```javascript
// perf/k6/scenarios/copilot-session.js
import http from "k6/http";
import { url, authHeaders } from "../helpers/auth.js";
import { checkStatus, checkJson } from "../helpers/checks.js";
import { defaultThresholds, lightStages } from "../config.js";
import { sleep } from "k6";

export const options = {
    stages: lightStages,
    thresholds: {
        ...defaultThresholds,
        http_req_duration: ["p(95)<3000"],
    },
};

const turns = [
    "Tell me more about Aldric's background.",
    "What about his family lineage?",
    "How does he relate to the northern kingdoms?",
];

export default function () {
    const noteId = `note-perf-${__VU}`;
    const messages = [];

    for (const turn of turns) {
        messages.push({ role: "user", content: turn });
        const payload = JSON.stringify({
            noteId,
            messages: [...messages],
            noteContext: {
                noteId,
                title: "Aldric",
                content: "<p>Aldric is the king.</p>",
                labels: [{ name: "loreType", value: "character" }],
                relations: [],
            },
            ragChunks: [],
        });

        const res = http.post(url("/copilot/article"), payload, {
            headers: authHeaders(),
            timeout: "10s",
        });
        checkStatus(res, 200);
        checkJson(res);

        if (res.status === 200) {
            const body = JSON.parse(res.body);
            messages.push({ role: "assistant", content: body.reply || "..." });
        }

        sleep(0.5); // realistic inter-turn delay
    }
}
```

- [ ] **Step 4: Relationship suggestion**

```javascript
// perf/k6/scenarios/suggest-relationships.js
import http from "k6/http";
import { url, authHeaders } from "../helpers/auth.js";
import { checkStatus, checkJson, checkLatency } from "../helpers/checks.js";
import { defaultThresholds, lightStages } from "../config.js";

export const options = {
    stages: lightStages,
    thresholds: {
        ...defaultThresholds,
        http_req_duration: ["p(95)<5000"],
    },
};

export default function () {
    const noteId = `note-${Math.floor(Math.random() * 10) + 1}`;
    const payload = JSON.stringify({ noteId });
    const res = http.post(url("/suggest/relationships"), payload, {
        headers: authHeaders(),
        timeout: "10s",
    });
    checkStatus(res, 200);
    checkJson(res);
    checkLatency(res, 5000, "suggest < 5s");
}
```

- [ ] **Step 5: Run scenarios**

```bash
k6 run perf/k6/scenarios/brain-dump-single.js
k6 run perf/k6/scenarios/copilot-session.js
k6 run perf/k6/scenarios/suggest-relationships.js
k6 run perf/k6/scenarios/brain-dump-concurrent.js
```

- [ ] **Step 6: Commit**

```bash
git add perf/k6/scenarios/
git commit -m "perf: brain dump, copilot, and suggest load scenarios

Single/concurrent brain dump, multi-turn copilot session,
relationship suggestion. Light stages for LLM-dependent endpoints."
```

---

## Task 5: Mixed Workload + Lock Contention

**Files:**
- Create: `perf/k6/scenarios/mixed-workload.js`
- Create: `perf/k6/scenarios/compaction-lock.js`

- [ ] **Step 1: Mixed workload — realistic traffic distribution**

```javascript
// perf/k6/scenarios/mixed-workload.js
import http from "k6/http";
import { url, authHeaders } from "../helpers/auth.js";
import { checkStatus } from "../helpers/checks.js";
import { defaultThresholds, defaultStages } from "../config.js";
import { sleep } from "k6";

export const options = {
    stages: defaultStages,
    thresholds: defaultThresholds,
};

const weights = [
    { fn: healthCheck, weight: 30 },
    { fn: ragQuery, weight: 25 },
    { fn: autocomplete, weight: 20 },
    { fn: brainDump, weight: 10 },
    { fn: copilotTurn, weight: 10 },
    { fn: ragStatus, weight: 5 },
];

const totalWeight = weights.reduce((s, w) => s + w.weight, 0);

function pickAction() {
    let r = Math.random() * totalWeight;
    for (const w of weights) {
        r -= w.weight;
        if (r <= 0) return w.fn;
    }
    return weights[0].fn;
}

function healthCheck() {
    return http.get(url("/health"));
}

function ragQuery() {
    return http.post(url("/rag/query"), JSON.stringify({ query: "kingdom", topK: 5 }), {
        headers: authHeaders(),
    });
}

function autocomplete() {
    const q = ["Ald", "Val", "Daw", "Ela", "Nor"][Math.floor(Math.random() * 5)];
    return http.get(url(`/suggest/autocomplete?q=${q}`));
}

function brainDump() {
    return http.post(url("/brain-dump"), JSON.stringify({
        rawText: "A wandering bard sings tales of ancient heroes.",
        mode: "auto",
    }), { headers: authHeaders(), timeout: "10s" });
}

function copilotTurn() {
    return http.post(url("/copilot/article"), JSON.stringify({
        noteId: `note-mixed-${__VU}`,
        messages: [{ role: "user", content: "Expand this lore entry." }],
        noteContext: { noteId: `note-mixed-${__VU}`, title: "T", content: "", labels: [], relations: [] },
        ragChunks: [],
    }), { headers: authHeaders(), timeout: "10s" });
}

function ragStatus() {
    return http.get(url("/rag/status"));
}

export default function () {
    const action = pickAction();
    const res = action();
    checkStatus(res, 200);
    sleep(Math.random() * 0.5); // jitter
}
```

- [ ] **Step 2: Compaction lock contention test**

```javascript
// perf/k6/scenarios/compaction-lock.js
import http from "k6/http";
import { url, authHeaders } from "../helpers/auth.js";
import { check } from "k6";

export const options = {
    scenarios: {
        lock_contention: {
            executor: "constant-vus",
            vus: 5,
            duration: "30s",
        },
    },
    thresholds: {
        http_req_failed: ["rate<0.20"], // some lock contention expected
    },
};

// All VUs target the same noteId to trigger lock contention
const SHARED_NOTE = "note-lock-test";

export default function () {
    // Build a conversation with enough tokens to approach compaction threshold
    const messages = [];
    for (let i = 0; i < 20; i++) {
        messages.push({
            role: i % 2 === 0 ? "user" : "assistant",
            content: `Turn ${i}: ${"Lorem ipsum dolor sit amet. ".repeat(50)}`,
        });
    }

    const payload = JSON.stringify({
        noteId: SHARED_NOTE,
        messages,
        noteContext: {
            noteId: SHARED_NOTE,
            title: "Lock Test",
            content: "<p>Lock contention test.</p>",
            labels: [],
            relations: [],
        },
        ragChunks: [],
    });

    const res = http.post(url("/copilot/article"), payload, {
        headers: authHeaders(),
        timeout: "30s",
    });

    check(res, {
        "not 500": (r) => r.status !== 500,
        "lock contention handled gracefully": (r) => r.status === 200 || r.status === 409 || r.status === 423,
    });
}
```

- [ ] **Step 3: Commit**

```bash
git add perf/k6/scenarios/mixed-workload.js perf/k6/scenarios/compaction-lock.js
git commit -m "perf: mixed workload and compaction lock contention scenarios

Mixed: weighted traffic distribution (30% health, 25% RAG, 20% autocomplete,
10% brain dump, 10% copilot, 5% status).
Lock: 5 VUs targeting same noteId to stress compaction lock."
```

---

## Task 6: Seed Script + Run Orchestrator

**Files:**
- Create: `perf/seed/seed-perf-data.ts`
- Create: `perf/run.sh`
- Create: `perf/README.md`
- Create: `perf/.gitignore`

- [ ] **Step 1: Create seed script**

```typescript
// perf/seed/seed-perf-data.ts
// Seeds AllKnower DB with test data for perf runs.
// Run: bun run perf/seed/seed-perf-data.ts

const BASE_URL = process.env.ALLKNOWER_URL || "http://localhost:3001";
const AUTH_TOKEN = process.env.AUTH_TOKEN || "perf-test-token";

async function seed() {
    const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AUTH_TOKEN}`,
    };

    // Seed 20 brain dump entries for history pagination testing
    console.log("Seeding brain dump history...");
    for (let i = 0; i < 20; i++) {
        const res = await fetch(`${BASE_URL}/brain-dump`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                rawText: `Performance test entity ${i}: A ${
                    ["warrior", "mage", "thief", "cleric", "ranger"][i % 5]
                } from the ${["north", "south", "east", "west"][i % 4]}.`,
                mode: "auto",
            }),
        });
        if (!res.ok) console.warn(`Brain dump ${i} failed: ${res.status}`);
        else console.log(`  Created brain dump ${i + 1}/20`);
    }

    // Trigger full RAG reindex to populate LanceDB
    console.log("Triggering RAG reindex...");
    const reindexRes = await fetch(`${BASE_URL}/rag/reindex`, {
        method: "POST",
        headers,
    });
    console.log(`  Reindex: ${reindexRes.status}`);

    console.log("Seed complete.");
}

seed().catch(console.error);
```

- [ ] **Step 2: Create run script**

```bash
#!/usr/bin/env bash
# perf/run.sh — Orchestrate mock server + k6 run
set -euo pipefail

SCENARIO="${1:-mixed-workload}"
MOCK_PORT="${MOCK_PORT:-19001}"

echo "=== AllKnower Load Test ==="
echo "Scenario: $SCENARIO"
echo "Mock OpenRouter port: $MOCK_PORT"

# Start mock OpenRouter
echo "Starting mock OpenRouter..."
MOCK_PORT=$MOCK_PORT bun run perf/mock-openrouter/server.ts &
MOCK_PID=$!
trap "kill $MOCK_PID 2>/dev/null || true" EXIT
sleep 1

# Ensure AllKnower is running
if ! curl -sf http://localhost:3001/health > /dev/null 2>&1; then
    echo "ERROR: AllKnower not running on :3001. Start it first."
    exit 1
fi

# Run k6
echo "Running k6 scenario: $SCENARIO"
mkdir -p perf/k6/results
k6 run \
    --out json="perf/k6/results/${SCENARIO}-$(date +%Y%m%d-%H%M%S).json" \
    "perf/k6/scenarios/${SCENARIO}.js"

echo "=== Done ==="
```

- [ ] **Step 3: Create .gitignore**

```
# perf/.gitignore
k6/results/
*.json.gz
```

- [ ] **Step 4: Create README**

```markdown
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
```

- [ ] **Step 5: Commit**

```bash
chmod +x perf/run.sh
git add perf/
git commit -m "perf: seed script, run orchestrator, README, gitignore

Seed: 20 brain dump entries + RAG reindex.
Run: starts mock OpenRouter, verifies AllKnower, runs k6 scenario.
Results saved to perf/k6/results/ (gitignored)."
```

---

## Verification

```bash
# Verify mock server
bun run perf/mock-openrouter/server.ts &
curl -s http://localhost:19001/api/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{"model":"test","messages":[{"role":"user","content":"test"}]}' | jq .choices[0].message.content
kill %1

# Verify k6 scripts parse
k6 inspect perf/k6/scenarios/health-baseline.js

# Full run (requires AllKnower running)
./perf/run.sh health-baseline
```

**Performance baselines to establish on first run:**

| Endpoint | Expected p95 (mock LLM) | Notes |
|---|---|---|
| GET /health | <50ms | Pure framework + DB ping |
| POST /rag/query | <200ms | LanceDB vector search |
| GET /suggest/autocomplete | <300ms | RAG + LLM (mock) |
| POST /brain-dump | <1s | Parse + mock LLM + DB write |
| POST /copilot/article | <1s | Session lookup + mock LLM |
| POST /suggest/relationships | <2s | Multi-note fetch + mock LLM |
| Mixed workload | <500ms avg | Weighted mix |

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

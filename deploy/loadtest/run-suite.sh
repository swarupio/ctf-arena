#!/usr/bin/env bash
# Bounded load-test suite for docs/LOADTEST.md. Portable: Git Bash on Windows and Linux. Needs Node 20+ and `npm ci` in this folder.
# It only sends GET requests to public endpoints, so it needs no login. Point it at a stack you started yourself
# (see docs/LOADTEST.md for a throwaway stack on port 18080) - NEVER at a real or shared deployment.
#
#   BASE=http://localhost:18080 OUT=./results deploy/loadtest/run-suite.sh [ramp|endpoints|all]
#   DURATION=30 RUNS=2 CONNS="10 50 100 200"     # defaults
#
# Output: one JSON per run in $OUT, plus docker stats samples when STATS_FILTER is set (e.g. STATS_FILTER=ctf-loadtest).
set -euo pipefail
cd "$(dirname "$0")"
BASE="${BASE:-http://localhost:18080}"
OUT="${OUT:-./results}"
DURATION="${DURATION:-30}"
RUNS="${RUNS:-2}"
CONNS="${CONNS:-10 50 100 200}"
WARMUP="${WARMUP:-3}"
MODE="${1:-all}"
mkdir -p "$OUT"

sample_stats() {  # sample_stats <label>: one docker stats line per container, appended to $OUT/stats.txt
  [ -n "${STATS_FILTER:-}" ] || return 0
  docker stats --no-stream --format "$1 {{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}} pids={{.PIDs}}" \
    $(docker ps --filter "name=${STATS_FILTER}" --format '{{.Names}}') >> "$OUT/stats.txt" 2>/dev/null || true
}

phase() {  # phase <name> <path> <connections>
  local name="$1" path="$2" conns="$3" run
  for run in $(seq 1 "$RUNS"); do
    echo "== $name c=$conns run $run"
    node loadtest.mjs --url "$BASE$path" --connections "$conns" --duration "$DURATION" --warmup "$WARMUP" \
      --label "$name-c$conns" --no-probe --json "$OUT/$name-c$conns-run$run.json" | grep -E "Requests/sec|Latency|Status mix|X-Served-By"
    sample_stats "$name-c$conns-run$run"
  done
}

if [ "$MODE" = ramp ] || [ "$MODE" = all ]; then
  for c in $CONNS; do phase health /api/health "$c"; done
fi
if [ "$MODE" = endpoints ] || [ "$MODE" = all ]; then
  phase event /api/event 100
  phase announcement /api/announcement 100
  phase honeypot /api/internal/config 50       # public decoy: writes one deduplicated signal per caller
  phase noauth401 /api/leaderboard 100         # protected route without a token: measures the 401 path
fi

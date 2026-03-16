#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

pnpm exec tsc --project tsconfig.test.json --noEmit >/dev/null
pnpm exec tsc --project tsconfig.json --outDir .autoresearch-dist >/dev/null

results=()
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51; do
  output="$(node benchmarks/core-runtime.mjs)"
  metric="$(printf '%s\n' "$output" | awk -F= '/METRIC total_ms=/{print $2}' | tail -n 1)"
  if [[ -z "$metric" ]]; then
    printf '%s\n' "$output"
    echo "Failed to parse METRIC total_ms from benchmark output" >&2
    exit 1
  fi
  results+=("$metric")
done

sorted_results=($(printf '%s\n' "${results[@]}" | sort -n))
echo "METRIC total_ms=${sorted_results[25]}"

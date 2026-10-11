#!/usr/bin/env bash
# Regression test for extend-ttl.sh's ledgers_to_days(), the helper
# that turns a ledger count into the one-decimal day figure the new
# skip-reporting log line prints. Deliberately pure bash integer
# arithmetic, not `bc`: deploy/Dockerfile.live-poster never installs
# `bc`, and this script has to run there for real.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTEND_TTL_SH="$REPO_ROOT/deploy/extend-ttl.sh"

FAILED=0

# Pulls just the ledgers_to_days() function body out of extend-ttl.sh
# by line range (from its own `ledgers_to_days() {` line to the
# matching closing brace) and evals it directly, rather than sourcing
# the whole script (which would require a full testnet.json /
# RPC_URL / keeper identity setup this test has no business needing).
func_src="$(sed -n '/^ledgers_to_days() {/,/^}/p' "$EXTEND_TTL_SH")"
[[ -n "$func_src" ]] || { echo "FATAL: could not extract ledgers_to_days() from $EXTEND_TTL_SH - has it been renamed?" >&2; exit 1; }
eval "$func_src"

SECS_PER_LEDGER=5

check() {
  local label="$1" ledgers="$2" expected="$3"
  local got
  got="$(ledgers_to_days "$ledgers")"
  if [[ "$got" != "$expected" ]]; then
    echo "FAIL: $label - expected \"$expected\", got \"$got\"" >&2
    FAILED=1
  else
    echo "PASS: $label -> \"$got\""
  fi
}

check "zero ledgers remaining" 0 "0.0"
check "exactly 30 days (518400 ledgers @ 5s/ledger)" 518400 "30.0"
check "exactly 14 days (241920 ledgers), the extend threshold" 241920 "14.0"
check "a large, pre-existing instance (over 100 days)" 2041445 "118.1"
check "under one full day" 10000 "0.5"

if (( FAILED )); then
  echo "" >&2
  echo "One or more ledgers_to_days checks failed." >&2
  exit 1
fi
echo ""
echo "All ledgers_to_days checks passed."

#!/usr/bin/env bash
# Regression test for the jq precedence bug in deploy/extend-ttl.sh's
# own NextEventId read. `|` binds more loosely than `//`, so an
# unparenthesized `storage[] | select(...) | .val.u64 // "0"` puts
# the fallback inside the per-element pipe; when no element matches,
# that pipe produces nothing, so the whole read comes back empty.
# Caught for real on a brand new EventRegistry that had never had
# propose_tier1 called (NextEventId is written only by
# storage::next_event_id, called only from propose_tier1, never from
# register_definition - every previously tested deploy already had a
# real event posted, so this path was never exercised before).
#
# Reads the real filter out of extend-ttl.sh's own NEXT_EVENT_ID_JQ
# constant, rather than keeping a second copy here that could drift
# from the real one, then runs it against small, hand-built JSON
# samples standing in for a real instance storage map: the key
# missing entirely, the key present with a real nonzero value, and
# the key present storing a literal 0 (which must still read as "0",
# not be mistaken for "missing" and also read as "0" - the two cases
# must be reachable through different paths in the expression, not
# accidentally collapse to the same one for the wrong reason).
#
# Run directly (deploy/test-extend-ttl-jq.sh) or from CI; exits
# non-zero and prints every failing case if any assertion fails.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTEND_TTL_SH="$REPO_ROOT/deploy/extend-ttl.sh"

FAILED=0

# Extracts NEXT_EVENT_ID_JQ's own value from extend-ttl.sh without
# running it (running it would make real network calls and need real
# deployment files, neither of which belongs in this test). The
# assignment is a single line, single-quoted, with no embedded single
# quotes of its own (the jq expression's own quoting is all double
# quotes) - safe to grep and strip rather than needing a real shell
# parse.
NEXT_EVENT_ID_JQ="$(grep '^NEXT_EVENT_ID_JQ=' "$EXTEND_TTL_SH" | sed "s/^NEXT_EVENT_ID_JQ='//; s/'$//")"
[[ -n "$NEXT_EVENT_ID_JQ" ]] || { echo "FATAL: could not extract NEXT_EVENT_ID_JQ from $EXTEND_TTL_SH - has it been renamed or reformatted?" >&2; exit 1; }

check() {
  local label="$1" input="$2" expected="$3"
  local got
  got="$(echo "$input" | jq -r "$NEXT_EVENT_ID_JQ")"
  if [[ "$got" != "$expected" ]]; then
    echo "FAIL: $label - expected \"$expected\", got \"$got\"" >&2
    FAILED=1
  else
    echo "PASS: $label -> \"$got\""
  fi
}

# Samples match the REAL nesting extend-ttl.sh's own input has
# (.contract_data.val.contract_instance.storage[], the decoded
# LedgerEntryData shape `stellar xdr decode` produces), not a
# shortened stand-in - so this test exercises the exact same filter
# against the exact same shape of input the real script feeds it.
check "NextEventId key missing entirely (brand new EventRegistry, never had propose_tier1 called)" \
  '{"contract_data": {"val": {"contract_instance": {"storage": [{"key": {"vec": [{"symbol": "Config"}]}, "val": {"map": []}}]}}}}' \
  "0"

check "NextEventId present with a real nonzero value" \
  '{"contract_data": {"val": {"contract_instance": {"storage": [{"key": {"vec": [{"symbol": "NextEventId"}]}, "val": {"u64": "5"}}]}}}}' \
  "5"

check "NextEventId present storing a literal 0 (not the same as missing, must still read 0)" \
  '{"contract_data": {"val": {"contract_instance": {"storage": [{"key": {"vec": [{"symbol": "NextEventId"}]}, "val": {"u64": "0"}}]}}}}' \
  "0"

check "NextEventId present alongside other unrelated keys" \
  '{"contract_data": {"val": {"contract_instance": {"storage": [{"key": {"vec": [{"symbol": "Config"}]}, "val": {"map": []}}, {"key": {"vec": [{"symbol": "NextEventId"}]}, "val": {"u64": "3"}}]}}}}' \
  "3"

# The bug this test exists to catch, demonstrated directly against
# the UNPARENTHESIZED version of the same real filter: it must FAIL
# the missing-key case, confirming the fixed expression above is not
# accidentally correct for a reason unrelated to the actual fix. Built
# by stripping NEXT_EVENT_ID_JQ's own outer parentheses mechanically
# (not retyped by hand), so this stays the real filter's own inverse,
# not a second, independently-written copy that could itself drift.
buggy_jq="$(echo "$NEXT_EVENT_ID_JQ" | sed -E 's/^\((.*)\)( \/\/ .*)$/\1\2/')"
if [[ "$buggy_jq" == "$NEXT_EVENT_ID_JQ" ]]; then
  echo "FATAL: could not strip the outer parentheses from NEXT_EVENT_ID_JQ to build the buggy comparison filter - has its shape changed?" >&2
  exit 1
fi
buggy_got="$(echo '{"contract_data": {"val": {"contract_instance": {"storage": [{"key": {"vec": [{"symbol": "Config"}]}, "val": {"map": []}}]}}}}' | jq -r "$buggy_jq")"
if [[ -n "$buggy_got" ]]; then
  echo "FAIL: the buggy (unparenthesized) expression was expected to produce empty output for a missing key, got \"$buggy_got\" - this test's own understanding of the bug may be wrong" >&2
  FAILED=1
else
  echo "PASS: confirmed the buggy expression (without parentheses) still produces empty output for a missing key, same failure this test exists to catch"
fi

if (( FAILED )); then
  echo "" >&2
  echo "One or more jq precedence checks failed." >&2
  exit 1
fi
echo ""
echo "All jq precedence checks passed."

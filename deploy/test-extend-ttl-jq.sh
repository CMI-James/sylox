#!/usr/bin/env bash
# Regression test for the jq precedence bug in deploy/extend-ttl.sh's
# own NextEventId read (`| binds more loosely than //`, so
# `storage[] | select(...) | .val.u64 // "0"` applied the fallback
# PER ELEMENT inside the pipe, never once over the whole expression -
# a select() over zero matching elements produces no output at all,
# not a null value, so `// "0"` never ran and the read came back
# empty). Caught for real on a brand new EventRegistry that had never
# had propose_tier1 called (NextEventId is written only by
# storage::next_event_id, called only from propose_tier1, never from
# register_definition - every previously tested deploy already had a
# real event posted, so this path was never exercised before).
#
# This script runs the SAME jq expression extend-ttl.sh itself uses,
# against three small, hand-built JSON samples standing in for a real
# instance storage map: the key missing entirely, the key present with
# a real nonzero value, and the key present storing a literal 0 (which
# must still read as "0", not be mistaken for "missing" and also read
# as "0" - the two cases must be reachable through different paths in
# the expression, not accidentally collapse to the same one for the
# wrong reason).
#
# Run directly (deploy/test-extend-ttl-jq.sh) or from CI; exits
# non-zero and prints every failing case if any assertion fails.

set -uo pipefail

FAILED=0

# The exact expression extend-ttl.sh uses for NextEventId, applied to
# a bare storage array here (extend-ttl.sh's own real input is nested
# one level deeper, inside .contract_data.val.contract_instance; the
# expression under test is the part after that nesting, which is what
# actually has the precedence bug - the nesting itself is not at risk).
JQ_EXPR='(.storage[] | select(.key.vec[0].symbol == "NextEventId") | .val.u64) // "0"'

check() {
  local label="$1" input="$2" expected="$3"
  local got
  got="$(echo "$input" | jq -r "$JQ_EXPR")"
  if [[ "$got" != "$expected" ]]; then
    echo "FAIL: $label - expected \"$expected\", got \"$got\"" >&2
    FAILED=1
  else
    echo "PASS: $label -> \"$got\""
  fi
}

check "NextEventId key missing entirely (brand new EventRegistry, never had propose_tier1 called)" \
  '{"storage": [{"key": {"vec": [{"symbol": "Config"}]}, "val": {"map": []}}]}' \
  "0"

check "NextEventId present with a real nonzero value" \
  '{"storage": [{"key": {"vec": [{"symbol": "NextEventId"}]}, "val": {"u64": "5"}}]}' \
  "5"

check "NextEventId present storing a literal 0 (not the same as missing, must still read 0)" \
  '{"storage": [{"key": {"vec": [{"symbol": "NextEventId"}]}, "val": {"u64": "0"}}]}' \
  "0"

check "NextEventId present alongside other unrelated keys" \
  '{"storage": [{"key": {"vec": [{"symbol": "Config"}]}, "val": {"map": []}}, {"key": {"vec": [{"symbol": "NextEventId"}]}, "val": {"u64": "3"}}]}' \
  "3"

# The bug this test exists to catch, demonstrated directly: the SAME
# expression without the fix (fallback applied inside the pipe, per
# element, per jq's own `|` < `//` precedence) must FAIL the
# missing-key case - confirming the fixed expression above is not
# accidentally correct for a reason unrelated to the actual fix.
BUGGY_JQ_EXPR='.storage[] | select(.key.vec[0].symbol == "NextEventId") | .val.u64 // "0"'
buggy_got="$(echo '{"storage": [{"key": {"vec": [{"symbol": "Config"}]}, "val": {"map": []}}]}' | jq -r "$BUGGY_JQ_EXPR")"
if [[ -n "$buggy_got" ]]; then
  echo "FAIL: the buggy (unfixed) expression was expected to produce empty output for a missing key, got \"$buggy_got\" - this test's own understanding of the bug may be wrong" >&2
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

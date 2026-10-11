#!/usr/bin/env bash
# Regression test for demo-asset-trigger.sh's parse_i128(). `stellar
# contract invoke --send=no` wraps a plain i128 return value in
# literal double quotes (e.g. ["1500000000"], not 1500000000), which
# broke a bare ^[0-9]+$ match against the raw string: every holder
# that already had a real, nonzero balance read as "not a number",
# silently falling through to "needs minting" instead of "already
# funded". That let a real run double-mint (the real holder history:
# 100 + 100 - 50 = 150, not the 100 - 50 = 50 an earlier fix assumed -
# see docs/event-0-demousd-issuer-freeze.md).
#
# Extracts the real function body out of demo-asset-trigger.sh (by
# line range) and evals it directly, rather than keeping a second,
# hand-copied implementation that could drift from the real one.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRIGGER_SH="$REPO_ROOT/deploy/demo-asset-trigger.sh"

FAILED=0

func_src="$(sed -n '/^parse_i128() {/,/^}/p' "$TRIGGER_SH")"
[[ -n "$func_src" ]] || { echo "FATAL: could not extract parse_i128() from $TRIGGER_SH - has it been renamed?" >&2; exit 1; }
eval "$func_src"

die() { echo "DIE_CALLED: $*"; exit 1; }

check() {
  local label="$1" raw="$2" expected="$3"
  local got rc
  got="$(parse_i128 "$raw" "test value" 2>&1)"
  rc=$?
  if [[ "$got" != "$expected" || $rc -ne 0 ]]; then
    echo "FAIL: $label - expected \"$expected\" (exit 0), got \"$got\" (exit $rc)" >&2
    FAILED=1
  else
    echo "PASS: $label -> \"$got\""
  fi
}

check_dies() {
  local label="$1" raw="$2"
  local got rc
  got="$(parse_i128 "$raw" "test value" 2>&1)"
  rc=$?
  if [[ $rc -eq 0 ]]; then
    echo "FAIL: $label - expected parse_i128 to die, but it returned \"$got\"" >&2
    FAILED=1
  else
    echo "PASS: $label -> died as expected (\"$got\")"
  fi
}

# The real shape `stellar contract invoke --send=no` returns for a
# plain i128: the value wrapped in literal double quotes, exactly the
# case that broke the original ^[0-9]+$ match against the raw string.
check "quoted nonzero value, the real --send=no shape" '"1500000000"' "1500000000"
check "quoted zero" '"0"' "0"

# Defensive: an unquoted value (not what --send=no actually returns,
# but parse_i128 should not depend on the quotes being present) still
# parses correctly.
check "unquoted value" "42" "42"

# Must never fall back to "0" or silently succeed on garbage - a wrong
# parse here is what let the real double-mint happen.
check_dies "empty string" ""
check_dies "non-numeric garbage" '"not a number"'
# A single stray leading/trailing quote (never --send=no's own real
# shape) still parses: # and % each strip at most one matching quote
# independently, not as a matched pair, so "12345 and 12345" both
# reduce to the same digits. Documented here, not "fixed" into a
# stricter parse the real bug never needed - the real CLI output is
# always either cleanly quoted or cleanly bare, never mismatched.
check "one stray leading quote (still parses; not the real CLI shape)" '"12345' "12345"

if (( FAILED )); then
  echo "" >&2
  echo "One or more parse_i128 checks failed." >&2
  exit 1
fi
echo ""
echo "All parse_i128 checks passed."

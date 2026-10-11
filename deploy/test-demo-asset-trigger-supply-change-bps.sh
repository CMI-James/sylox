#!/usr/bin/env bash
# Regression test for demo-asset-trigger.sh's compute_supply_change_bps(),
# which copies check_supply_change_consistency's own formula exactly
# (contracts/risk-oracle/src/lib.rs): ((supply - previous.supply) *
# 10_000) / previous.supply, i128 division truncating toward zero.
#
# Exists because the triggering post hardcoded supply_change_bps: 0,
# which check_supply_change_consistency correctly rejected once the
# real supply genuinely moved (the clawback that happens right before
# the triggering post): a real -2000 bps change posted as 0 is a
# diff of 2000, far past SUPPLY_CHANGE_TOLERANCE_BPS = 1.
#
# Extracts the real function body out of demo-asset-trigger.sh (by
# line range) and evals it directly, same self-extraction pattern the
# other deploy/test-*.sh files use.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRIGGER_SH="$REPO_ROOT/deploy/demo-asset-trigger.sh"

FAILED=0

func_src="$(sed -n '/^compute_supply_change_bps() {/,/^}/p' "$TRIGGER_SH")"
[[ -n "$func_src" ]] || { echo "FATAL: could not extract compute_supply_change_bps() from $TRIGGER_SH - has it been renamed?" >&2; exit 1; }
eval "$func_src"

check() {
  local label="$1" supply="$2" previous_supply="$3" expected="$4"
  local got
  got="$(compute_supply_change_bps "$supply" "$previous_supply")"
  if [[ "$got" != "$expected" ]]; then
    echo "FAIL: $label - expected \"$expected\", got \"$got\"" >&2
    FAILED=1
  else
    echo "PASS: $label -> \"$got\""
  fi
}

# The real figures from this session's own failed trigger attempt:
# supply dropped from 2,500,000,000 (the backfill's last posted
# epoch) to 2,000,000,000 (after the real clawback) - a genuine -20%
# move. (2000000000 - 2500000000) * 10000 / 2500000000 = -2000 exactly
# (no remainder), confirmed by hand against both bash's own $(( ))
# and the contract's i128 arithmetic before writing this test.
check "real session figures: 2.5B -> 2.0B" 2000000000 2500000000 "-2000"

# Truncation toward zero, not floor division, matters when the result
# isn't an exact multiple - confirmed by hand: bash's $(( -7 / 2 )) is
# -3 (truncate toward zero, matching Rust's i128), not Python's floor
# -4 (floor(-3.5) = -4). This case (supply 1, previous 3) is
# engineered to land on a genuinely non-exact division: (1 - 3) *
# 10000 / 3 = -20000 / 3 = -6666.66..., which truncates to -6666 but
# floors to -6667 - confirmed both in python and against bash's own
# $(( )) directly before writing this test, so this case really does
# distinguish the two, unlike an evenly-divisible pair.
check "truncation toward zero, not floor (non-exact division)" 1 3 "-6666"

# No change at all: 0 bps, trivially.
check "no change" 1000000 1000000 "0"

# A real increase (e.g. a later mint, not this session's path, but a
# legitimate future case) - must handle a positive change correctly.
check "supply increase" 3000000000 2500000000 "2000"

# No previous slot at all (epoch 0, or a genuine gap) - compute_supply_
# change_bps must return "0" (the contract's own unconditional-pass
# case), not die or guess, when read_previous_supply's own empty
# string is passed through.
check "no previous slot (empty string, as read_previous_supply returns for epoch 0 or a gap)" 2000000000 "" "0"

# Previous supply of exactly 0 - check_supply_change_consistency skips
# its own check here too (dividing by zero is undefined), so this
# must also return "0", not attempt the division.
check "previous supply is zero" 1000000000 0 "0"

if (( FAILED )); then
  echo "" >&2
  echo "One or more compute_supply_change_bps checks failed." >&2
  exit 1
fi
echo ""
echo "All compute_supply_change_bps checks passed."

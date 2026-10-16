#!/usr/bin/env bash
# Regression test for deploy/post-demo-signals.sh's
# candidate_build_hours(), the pure half of build_recent_hours().
#
# Exists because the live poster's own inline build_hour attempt
# (post_sub_signals, on whichever call happens to complete an hour's
# last sub-epoch) almost always fires too early - most of an hour's
# own sub-epochs are still inside their 2h SIGNAL_DISPUTE_SECS pending
# window at that exact moment - and nothing ever retries it. Sub(asset)'s
# own ring only holds SUB_RING_SPAN_SECS (5h) of raw sub-epoch data, so
# once an hour ages past that window, build_hour can never succeed for
# it again. USDC's own hourly Signals slot genuinely stopped advancing
# on the real live deployment because of this; confirmed directly this
# session (an old, never-built hour simulates build_hour successfully
# but with sub_count_final: 0, nothing left to read).
#
# candidate_build_hours(hour_now) must return exactly the hours still
# safely inside that 5h ring: hour_now - 4 through hour_now - 1
# inclusive, oldest first. Getting either boundary wrong either misses
# hours that are still buildable (too narrow) or wastes a call on an
# hour whose data is already gone (too old, past 5h) - this test
# checks both edges precisely, not just the middle of the range.
#
# Extracts the real function body out of deploy/post-demo-signals.sh
# (by line range) and evals it directly, same self-extraction pattern
# the other deploy/test-*.sh files use. No network calls.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POSTER_SH="$REPO_ROOT/deploy/post-demo-signals.sh"

FAILED=0

func_src="$(sed -n '/^candidate_build_hours() {/,/^}/p' "$POSTER_SH")"
[[ -n "$func_src" ]] || { echo "FATAL: could not extract candidate_build_hours() from $POSTER_SH - has it been renamed?" >&2; exit 1; }
eval "$func_src"

check() {
  local label="$1" hour_now="$2" expected="$3"
  local got
  got="$(candidate_build_hours "$hour_now" | tr '\n' ' ')"
  got="${got% }"
  if [[ "$got" != "$expected" ]]; then
    echo "FAIL: $label - expected \"$expected\", got \"$got\"" >&2
    FAILED=1
  else
    echo "PASS: $label -> \"$got\""
  fi
}

# The real case this fix exists for: a plausible current hour from
# this session's own testnet observation (497811). Must return exactly
# the 4 hours before it, oldest first - the 4 most recently closed
# hours still inside the 5h ring, confirmed by hand this session
# against real build_hour simulations at this exact boundary
# (497808-497810 all simulated real outcomes; 497807 and older, when
# checked separately, had already rotated out of the ring).
check "real session hour (497811)" 497811 "497807 497808 497809 497810"

# Small, hand-countable numbers, to directly verify the exact boundary
# rather than trusting a large realistic number alone: hour_now = 10
# must return 6,7,8,9 - four hours, ending at hour_now - 1, nothing
# touching hour_now itself (still open; not even closed yet, let alone
# ring-eligible to check).
check "small hour_now (10)" 10 "6 7 8 9"

# hour_now = 4: hour_now - 4 is exactly 0, the oldest hour the ring
# can ever represent (there is no negative hour) - must still return
# all 4 candidates, not fewer, since 0 is a perfectly valid hour
# number, not something to skip.
check "hour_now - 4 lands exactly on hour 0" 4 "0 1 2 3"

# hour_now = 3: hour_now - 4 would be -1, which must never appear in
# the output - the real testnet clock never produces a negative hour
# number, but this proves the guard holds rather than assuming it from
# the hand-read code alone.
check "hour_now - 4 goes negative, must be skipped" 3 "0 1 2"

# hour_now = 1: only one real candidate (hour 0); hour_now - 4 through
# hour_now - 2 are all negative and must all be skipped, not just the
# first one.
check "only one hour old enough to exist" 1 "0"

# hour_now = 0: no candidate at all - hour -1 through hour -4 are all
# negative, and hour 0 itself is excluded (it's hour_now, not a closed
# hour before it).
check "hour_now is 0: no real candidates" 0 ""

if (( FAILED )); then
  echo "" >&2
  echo "One or more candidate_build_hours checks failed." >&2
  exit 1
fi
echo ""
echo "All candidate_build_hours checks passed."

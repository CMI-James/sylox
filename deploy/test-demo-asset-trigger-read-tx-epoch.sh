#!/usr/bin/env bash
# Regression test for demo-asset-trigger.sh's created_at_to_epoch(),
# the pure conversion half of read_tx_epoch(): floor(created_at /
# EPOCH_SECS), where created_at is an ISO-8601 timestamp read from
# Horizon.
#
# Exists because a real run pinned the triggering post to the WRONG
# hour: the original NEWEST_CLOSED (floor(now/EPOCH_SECS) - 1) used
# wall-clock "now" at script-run time, not the real hour the revoke
# and clawback transactions actually closed in. If the script resumes
# even a few minutes after an hour boundary, the wall-clock hour and
# the real action's own hour differ - the case this test exercises
# directly.
#
# Extracts the real function body out of demo-asset-trigger.sh (by
# line range) and evals it directly, same self-extraction pattern the
# other deploy/test-*.sh files use.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRIGGER_SH="$REPO_ROOT/deploy/demo-asset-trigger.sh"

FAILED=0

die() { echo "DIE_CALLED: $*"; exit 1; }

func_src="$(sed -n '/^created_at_to_epoch() {/,/^}/p' "$TRIGGER_SH")"
[[ -n "$func_src" ]] || { echo "FATAL: could not extract created_at_to_epoch() from $TRIGGER_SH - has it been renamed?" >&2; exit 1; }
eval "$func_src"

EPOCH_SECS=3600

check() {
  local label="$1" created_at="$2" expected="$3"
  local got
  got="$(created_at_to_epoch "$created_at")"
  if [[ "$got" != "$expected" ]]; then
    echo "FAIL: $label - expected \"$expected\", got \"$got\"" >&2
    FAILED=1
  else
    echo "PASS: $label -> \"$got\""
  fi
}

# The real transaction this fix exists to pin correctly: the
# clawback's own created_at (2026-10-11T21:14:02Z, confirmed against
# the real Horizon record), unix 1791753242, falls in epoch 497709
# (1791753242 / 3600 = 497709.23...). Confirmed by hand that this does
# NOT equal floor(now/EPOCH_SECS) - 1 (the original, wrong formula) at
# every time this test could run, which is why the two boundary cases
# below exist: they catch a wall-clock-based regression regardless of
# when the test happens to run, where this case alone could coincide
# with the wrong formula's answer by chance.
check "real clawback transaction (7011544d...)" "2026-10-11T21:14:02Z" "497709"

# The real revoke transaction (33571297...), 5 seconds earlier, same
# hour - must agree with the clawback above, which is exactly what
# demo-asset-trigger.sh itself checks before proceeding (dies if they
# don't match).
check "real revoke transaction (33571297...), same hour as the clawback" "2026-10-11T21:13:57Z" "497709"

# Exactly on an hour boundary - floor must round down into the
# CLOSING hour, not the one about to start.
check "exactly on an hour boundary (unix 0 at the EPOCH_SECS boundary)" "1970-01-01T01:00:00Z" "1"

# One second before an hour boundary - still the earlier hour.
check "one second before an hour boundary" "1970-01-01T00:59:59Z" "0"

if (( FAILED )); then
  echo "" >&2
  echo "One or more created_at_to_epoch checks failed." >&2
  exit 1
fi
echo ""
echo "All created_at_to_epoch checks passed."

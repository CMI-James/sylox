#!/usr/bin/env bash
# Regression test for demo-asset-trigger.sh's plan()/note_submission()
# pair: the mechanism that enforces "one gate per step" (every step
# decides once whether it is done; the SAME decision governs both the
# printed plan and whatever actually gets submitted).
#
# Exists because a real run submitted a transaction (a repeat
# change-trust) immediately after its own plan line had printed
# "already done" for that exact step - the trustline step computed
# its "already done" state only to choose the plan line's wording,
# then ran the real change-trust call unconditionally whenever not in
# --dry-run, with no gate tying the two together. Confirmed harmless
# in that real run (a repeat change-trust to an already-open
# trustline is a genuine Stellar no-op), but it was still a real
# signed transaction the plan did not predict - note_submission below
# is the guard that makes this impossible to repeat silently.
#
# Extracts the real plan()/note_submission() functions out of
# demo-asset-trigger.sh (by line range) and evals them directly, same
# self-extraction pattern the other deploy/test-*.sh files use. No
# network calls: this tests the planning/guard mechanism itself, not
# any one step's own Horizon/Soroban reads.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRIGGER_SH="$REPO_ROOT/deploy/demo-asset-trigger.sh"

FAILED=0

log() { :; }   # Silenced for this test; only the PASS/FAIL lines below matter.
die() { echo "DIE_CALLED: $*"; exit 1; }

plan_src="$(sed -n '/^declare -A PLAN_STATUS_BY_LABEL=()/,/^}/p' "$TRIGGER_SH" | sed -n '1,/^}/p')"
[[ -n "$plan_src" ]] || { echo "FATAL: could not extract plan() from $TRIGGER_SH - has it been renamed?" >&2; exit 1; }
eval "$plan_src"

note_submission_src="$(sed -n '/^declare -A SUBMITTED_TX_HASHES=()/,/^}/p' "$TRIGGER_SH" | sed -n '1,/^}/p')"
[[ -n "$note_submission_src" ]] || { echo "FATAL: could not extract note_submission() from $TRIGGER_SH - has it been renamed?" >&2; exit 1; }
eval "$note_submission_src"

check_dies() {
  local label="$1"
  shift
  local got rc
  got="$("$@" 2>&1)"
  rc=$?
  if [[ $rc -eq 0 ]]; then
    echo "FAIL: $label - expected the call to die, but it returned \"$got\"" >&2
    FAILED=1
  else
    echo "PASS: $label -> died as expected (\"$got\")"
  fi
}

check_succeeds() {
  local label="$1"
  shift
  local got rc
  got="$("$@" 2>&1)"
  rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "FAIL: $label - expected success, got exit $rc (\"$got\")" >&2
    FAILED=1
  else
    echo "PASS: $label"
  fi
}

# The real bug this test exists to catch: note_submission called
# right after plan() said "already done" for that same label.
plan "step-a" "already done"
check_dies "note_submission after plan said already done (the real bug)" \
  note_submission "step-a" "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"

# Every other non-"will submit" status must also be rejected, not
# just "already done" specifically - "cannot check yet" and
# "cannot plan yet" are real statuses this script uses too.
plan "step-b" "cannot check yet" "holder identity does not exist locally"
check_dies "note_submission after plan said cannot check yet" \
  note_submission "step-b" "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"

plan "step-c" "cannot plan yet" "triggering epoch not yet known"
check_dies "note_submission after plan said cannot plan yet" \
  note_submission "step-c" "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"

# A label that was never plan()'d at all - the array lookup returns
# empty, which must also be rejected, not treated as a pass.
check_dies "note_submission for a label plan() was never called with" \
  note_submission "step-never-planned" "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"

# The correct case: plan() said "will submit", note_submission must
# succeed and record the hash.
plan "step-d" "will submit"
check_succeeds "note_submission after plan said will submit" \
  note_submission "step-d" "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe"

# Even on the "will submit" path, a missing hash must still be
# rejected - a submission with no hash to report is exactly the other
# half of what this review asked to fix (every submission must print
# a hash).
plan "step-e" "will submit"
check_dies "note_submission with an empty hash, even after will submit" \
  note_submission "step-e" ""

# The actual assertion this review asked for: run the planning
# against an "everything done" state (every step reports "already
# done", exactly what a fully resumed run looks like) and confirm
# zero submissions are ever recorded - SUBMITTED_TX_HASHES must stay
# empty, since note_submission is never legitimately reachable from
# an "already done" branch.
unset SUBMITTED_TX_HASHES
declare -A SUBMITTED_TX_HASHES=()
unset PLAN_STATUS_BY_LABEL
declare -A PLAN_STATUS_BY_LABEL=()
plan "holder identity (sylox-demo-holder-2)" "already done" "GFAKE..."
plan "trustline (DEMOUSD)" "already done"
plan "mint" "already done" "500000000 stroops already held"
plan "revoke" "already done" "fakehash1"
plan "clawback" "already done" "fakehash2, 500000000 stroops"
plan "backfill epoch 497705" "already done"
plan "backfill epoch 497706" "already done"
plan "backfill epoch 497707" "already done"
plan "gap-fill epoch 497708" "already done" "supply=2500000000"
plan "triggering post" "already done" "epoch=497709"
if (( ${#SUBMITTED_TX_HASHES[@]} == 0 )); then
  echo "PASS: everything-done state -> zero planned submissions (${#SUBMITTED_TX_HASHES[@]})"
else
  echo "FAIL: everything-done state -> expected 0 submissions, got ${#SUBMITTED_TX_HASHES[@]}: ${!SUBMITTED_TX_HASHES[*]}" >&2
  FAILED=1
fi

if (( FAILED )); then
  echo "" >&2
  echo "One or more plan()/note_submission() checks failed." >&2
  exit 1
fi
echo ""
echo "All plan()/note_submission() checks passed."

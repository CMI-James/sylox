#!/usr/bin/env bash
# Regression test for demo-asset-trigger.sh's
# select_revoke_tx_hash_from_ops(), the jq half of find_revoke_tx_hash
# that picks the real revoke transaction hash out of Horizon's own
# /accounts/{id}/operations response. Exists so that when
# read_trustline_authorized finds a trustline already deauthorized (a
# prior interrupted run got that far before dying), the evidence
# posted later still carries the real revoke transaction hash instead
# of an empty string.
#
# Extracts the real function body out of demo-asset-trigger.sh (by
# line range) and evals it directly, against small local JSON samples
# standing in for Horizon's own operations response - no real network
# call, same self-extraction pattern the other deploy/test-*.sh files
# use.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRIGGER_SH="$REPO_ROOT/deploy/demo-asset-trigger.sh"

FAILED=0

func_src="$(sed -n '/^select_revoke_tx_hash_from_ops() {/,/^}/p' "$TRIGGER_SH")"
[[ -n "$func_src" ]] || { echo "FATAL: could not extract select_revoke_tx_hash_from_ops() from $TRIGGER_SH - has it been renamed?" >&2; exit 1; }
eval "$func_src"

check() {
  local label="$1" ops_json="$2" trustor="$3" asset_code="$4" expected="$5"
  local got
  got="$(select_revoke_tx_hash_from_ops "$ops_json" "$trustor" "$asset_code")"
  if [[ "$got" != "$expected" ]]; then
    echo "FAIL: $label - expected \"$expected\", got \"$got\"" >&2
    FAILED=1
  else
    echo "PASS: $label -> \"$got\""
  fi
}

# Shape matches Horizon's real /accounts/{id}/operations response
# (order=desc), trimmed to just the fields the real jq filter reads.
# clear_flags_s is the real field confirmed against the actual revoke
# operation's own Horizon record (deploy/demo-asset-trigger.sh's own
# select_revoke_tx_hash_from_ops comment) - an array of strings,
# "authorized" present only on an operation that actually cleared it.
ONE_MATCH='{"_embedded":{"records":[
  {"type":"set_trust_line_flags","trustor":"GHOLDER","asset_code":"DEMOUSD","clear_flags_s":["authorized"],"transaction_hash":"aaaa"},
  {"type":"clawback","trustor":null,"asset_code":"DEMOUSD","transaction_hash":"bbbb"}
]}}'
check "single real match" "$ONE_MATCH" "GHOLDER" "DEMOUSD" "aaaa"

# order=desc means index 0 is the NEWEST - if the issuer ever revoked
# and (hypothetically) re-authorized and revoked again, this must
# return the most recent one, not the oldest.
TWO_MATCHES='{"_embedded":{"records":[
  {"type":"set_trust_line_flags","trustor":"GHOLDER","asset_code":"DEMOUSD","clear_flags_s":["authorized"],"transaction_hash":"newest"},
  {"type":"set_trust_line_flags","trustor":"GHOLDER","asset_code":"DEMOUSD","clear_flags_s":["authorized"],"transaction_hash":"oldest"}
]}}'
check "two matches, must pick index 0 (newest, order=desc)" "$TWO_MATCHES" "GHOLDER" "DEMOUSD" "newest"

# The newest set_trust_line_flags operation for this trustor SETS a
# flag (set_flags_s, no clear_flags_s at all) rather than clearing
# authorized - e.g. the issuer re-authorizing, or clearing some other
# flag entirely. The older operation is the real revoke. Must skip the
# newest and return the older one, not the first set_trust_line_flags
# match by position.
NEWEST_SETS_OLDER_CLEARS='{"_embedded":{"records":[
  {"type":"set_trust_line_flags","trustor":"GHOLDER","asset_code":"DEMOUSD","set_flags_s":["authorized"],"transaction_hash":"newest_sets_a_flag"},
  {"type":"set_trust_line_flags","trustor":"GHOLDER","asset_code":"DEMOUSD","clear_flags_s":["authorized"],"transaction_hash":"older_real_revoke"}
]}}'
check "newest sets a flag, older clears authorized - older must win" "$NEWEST_SETS_OLDER_CLEARS" "GHOLDER" "DEMOUSD" "older_real_revoke"

# Must not match a different trustor's revoke, or a different asset's
# revoke on the same trustor - this issuer could in principle issue
# more than one asset.
WRONG_TRUSTOR='{"_embedded":{"records":[
  {"type":"set_trust_line_flags","trustor":"GSOMEONE_ELSE","asset_code":"DEMOUSD","clear_flags_s":["authorized"],"transaction_hash":"wrong"}
]}}'
check "no match: right type, wrong trustor" "$WRONG_TRUSTOR" "GHOLDER" "DEMOUSD" ""

WRONG_ASSET='{"_embedded":{"records":[
  {"type":"set_trust_line_flags","trustor":"GHOLDER","asset_code":"OTHERASSET","clear_flags_s":["authorized"],"transaction_hash":"wrong"}
]}}'
check "no match: right trustor, wrong asset_code" "$WRONG_ASSET" "GHOLDER" "DEMOUSD" ""

# Must not match a different operation type against the same
# trustor/asset (e.g. the clawback operation itself).
WRONG_TYPE='{"_embedded":{"records":[
  {"type":"clawback","trustor":"GHOLDER","asset_code":"DEMOUSD","transaction_hash":"wrong"}
]}}'
check "no match: right trustor/asset, wrong type" "$WRONG_TYPE" "GHOLDER" "DEMOUSD" ""

# Right type/trustor/asset, but this one never cleared authorization
# at all (e.g. it only cleared clawback_enabled, or only set a flag) -
# must not match just because it is a set_trust_line_flags operation.
RIGHT_TYPE_WRONG_FLAG='{"_embedded":{"records":[
  {"type":"set_trust_line_flags","trustor":"GHOLDER","asset_code":"DEMOUSD","clear_flags_s":["clawback_enabled"],"transaction_hash":"wrong"}
]}}'
check "no match: right type/trustor/asset, but authorized not cleared" "$RIGHT_TYPE_WRONG_FLAG" "GHOLDER" "DEMOUSD" ""

NO_RECORDS='{"_embedded":{"records":[]}}'
check "empty operations list" "$NO_RECORDS" "GHOLDER" "DEMOUSD" ""

if (( FAILED )); then
  echo "" >&2
  echo "One or more select_revoke_tx_hash_from_ops checks failed." >&2
  exit 1
fi
echo ""
echo "All select_revoke_tx_hash_from_ops checks passed."

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
ONE_MATCH='{"_embedded":{"records":[
  {"type":"set_trust_line_flags","trustor":"GHOLDER","asset_code":"DEMOUSD","transaction_hash":"aaaa"},
  {"type":"clawback","trustor":null,"asset_code":"DEMOUSD","transaction_hash":"bbbb"}
]}}'
check "single real match" "$ONE_MATCH" "GHOLDER" "DEMOUSD" "aaaa"

# order=desc means index 0 is the NEWEST - if the issuer ever revoked
# and (hypothetically) re-authorized and revoked again, this must
# return the most recent one, not the oldest.
TWO_MATCHES='{"_embedded":{"records":[
  {"type":"set_trust_line_flags","trustor":"GHOLDER","asset_code":"DEMOUSD","transaction_hash":"newest"},
  {"type":"set_trust_line_flags","trustor":"GHOLDER","asset_code":"DEMOUSD","transaction_hash":"oldest"}
]}}'
check "two matches, must pick index 0 (newest, order=desc)" "$TWO_MATCHES" "GHOLDER" "DEMOUSD" "newest"

# Must not match a different trustor's revoke, or a different asset's
# revoke on the same trustor - this issuer could in principle issue
# more than one asset.
WRONG_TRUSTOR='{"_embedded":{"records":[
  {"type":"set_trust_line_flags","trustor":"GSOMEONE_ELSE","asset_code":"DEMOUSD","transaction_hash":"wrong"}
]}}'
check "no match: right type, wrong trustor" "$WRONG_TRUSTOR" "GHOLDER" "DEMOUSD" ""

WRONG_ASSET='{"_embedded":{"records":[
  {"type":"set_trust_line_flags","trustor":"GHOLDER","asset_code":"OTHERASSET","transaction_hash":"wrong"}
]}}'
check "no match: right trustor, wrong asset_code" "$WRONG_ASSET" "GHOLDER" "DEMOUSD" ""

# Must not match a different operation type against the same
# trustor/asset (e.g. the clawback operation itself).
WRONG_TYPE='{"_embedded":{"records":[
  {"type":"clawback","trustor":"GHOLDER","asset_code":"DEMOUSD","transaction_hash":"wrong"}
]}}'
check "no match: right trustor/asset, wrong type" "$WRONG_TYPE" "GHOLDER" "DEMOUSD" ""

NO_RECORDS='{"_embedded":{"records":[]}}'
check "empty operations list" "$NO_RECORDS" "GHOLDER" "DEMOUSD" ""

if (( FAILED )); then
  echo "" >&2
  echo "One or more select_revoke_tx_hash_from_ops checks failed." >&2
  exit 1
fi
echo ""
echo "All select_revoke_tx_hash_from_ops checks passed."

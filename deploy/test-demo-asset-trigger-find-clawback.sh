#!/usr/bin/env bash
# Regression test for demo-asset-trigger.sh's
# select_clawback_tx_hash_from_ops(), the jq half of
# find_clawback_tx_hash that picks the real clawback transaction hash
# out of Horizon's own /accounts/{id}/operations response. Exists so
# that a rerun detects a clawback that already happened BEFORE it
# computes a new request amount (half of whatever the holder holds
# RIGHT NOW) - computing or submitting that on a rerun would claw back
# half of the REMAINING balance a second time.
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

func_src="$(sed -n '/^select_clawback_tx_hash_from_ops() {/,/^}/p' "$TRIGGER_SH")"
[[ -n "$func_src" ]] || { echo "FATAL: could not extract select_clawback_tx_hash_from_ops() from $TRIGGER_SH - has it been renamed?" >&2; exit 1; }
eval "$func_src"

check() {
  local label="$1" ops_json="$2" holder="$3" asset_code="$4" expected="$5"
  local got
  got="$(select_clawback_tx_hash_from_ops "$ops_json" "$holder" "$asset_code")"
  if [[ "$got" != "$expected" ]]; then
    echo "FAIL: $label - expected \"$expected\", got \"$got\"" >&2
    FAILED=1
  else
    echo "PASS: $label -> \"$got\""
  fi
}

# Shape matches Horizon's real /accounts/{id}/operations response -
# a clawback operation's holder-identifying field is `from`, not
# `trustor` (confirmed against the real clawback operation's own
# Horizon record: trustor is null for a clawback, since it is not a
# trustline operation).
ONE_MATCH='{"_embedded":{"records":[
  {"type":"clawback","trustor":null,"from":"GHOLDER","asset_code":"DEMOUSD","transaction_hash":"aaaa"},
  {"type":"set_trust_line_flags","trustor":"GHOLDER","asset_code":"DEMOUSD","transaction_hash":"bbbb"}
]}}'
check "single real match" "$ONE_MATCH" "GHOLDER" "DEMOUSD" "aaaa"

# order=desc means index 0 is the NEWEST - if this holder were ever
# clawed back twice (not this script's own normal flow, but a
# possible real history), this must return the most recent one.
TWO_MATCHES='{"_embedded":{"records":[
  {"type":"clawback","trustor":null,"from":"GHOLDER","asset_code":"DEMOUSD","transaction_hash":"newest"},
  {"type":"clawback","trustor":null,"from":"GHOLDER","asset_code":"DEMOUSD","transaction_hash":"oldest"}
]}}'
check "two matches, must pick index 0 (newest, order=desc)" "$TWO_MATCHES" "GHOLDER" "DEMOUSD" "newest"

# Must not match a different holder's clawback, or a different
# asset's clawback on the same holder - this issuer could in
# principle issue more than one asset.
WRONG_HOLDER='{"_embedded":{"records":[
  {"type":"clawback","trustor":null,"from":"GSOMEONE_ELSE","asset_code":"DEMOUSD","transaction_hash":"wrong"}
]}}'
check "no match: right type, wrong holder" "$WRONG_HOLDER" "GHOLDER" "DEMOUSD" ""

WRONG_ASSET='{"_embedded":{"records":[
  {"type":"clawback","trustor":null,"from":"GHOLDER","asset_code":"OTHERASSET","transaction_hash":"wrong"}
]}}'
check "no match: right holder, wrong asset_code" "$WRONG_ASSET" "GHOLDER" "DEMOUSD" ""

# Must not match a different operation type against the same
# holder/asset (e.g. the set_trust_line_flags revoke itself, which
# also touches this exact trustor and asset_code).
WRONG_TYPE='{"_embedded":{"records":[
  {"type":"set_trust_line_flags","trustor":"GHOLDER","asset_code":"DEMOUSD","transaction_hash":"wrong"}
]}}'
check "no match: right holder/asset, wrong type (the revoke itself)" "$WRONG_TYPE" "GHOLDER" "DEMOUSD" ""

# Same point, but with an operation type that DOES carry a `from`
# field matching this holder/asset (a payment, not a clawback) - this
# is the case that actually exercises the .type == "clawback" filter;
# the set_trust_line_flags case above has no `from` field at all
# (only `trustor`), so it would pass even without that filter.
WRONG_TYPE_WITH_FROM='{"_embedded":{"records":[
  {"type":"payment","from":"GHOLDER","asset_code":"DEMOUSD","transaction_hash":"wrong"}
]}}'
check "no match: a payment (has from, but is not a clawback)" "$WRONG_TYPE_WITH_FROM" "GHOLDER" "DEMOUSD" ""

# The normal, expected state for a genuinely first run: no clawback
# has happened yet. Must return empty, not die and not a placeholder -
# this is what tells the caller to compute a real request amount.
NO_RECORDS='{"_embedded":{"records":[]}}'
check "empty operations list (first run, nothing clawed back yet)" "$NO_RECORDS" "GHOLDER" "DEMOUSD" ""

if (( FAILED )); then
  echo "" >&2
  echo "One or more select_clawback_tx_hash_from_ops checks failed." >&2
  exit 1
fi
echo ""
echo "All select_clawback_tx_hash_from_ops checks passed."

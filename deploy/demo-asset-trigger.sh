#!/usr/bin/env bash
# ONE-TIME script: creates a DEMOUSD holder, posts a little real
# history, then performs a REAL authorization revocation and a REAL
# clawback against that holder from the DEMOUSD issuer, posts a
# signal recording those exact actions (amount and supply read back
# from the chain, never hardcoded; the real transaction hashes folded
# into the posted inputs), and refuses to post if the real numbers
# would not actually clear the registered IssuerFreeze threshold.
#
# Run deploy/demo-asset.sh testnet first; this script reads
# deployments/testnet.json and deployments/testnet-demo-asset.json,
# which that script writes.
#
# Running this script TWICE mints a second batch and claws back a
# second amount; it is not meant to be re-run to "redo" the demo, only
# to retry a step that failed partway (minting is the one step below
# with no "already done" guard, since there's no natural amount to
# check against — a second deliberate mint is a legitimate thing to
# want, just not from re-running this whole script by habit). If the
# demo needs resetting, that means a fresh holder identity and a fresh
# DEMOUSD asset (deploy/demo-asset.sh again, under a different issuer),
# not re-running this script against the same holder.
#
# technical-doc.md Section 8.2 / contracts/event-registry/src/lib.rs's
# own check_issuer_freeze: unlike score()'s 7 day calendar requirement
# (Section 6.5), IssuerFreeze's own 168-epoch window has NO history
# minimum — a missing epoch only undercounts, never falsely triggers
# (PR #27 review round 2, see check_issuer_freeze's own doc comment).
# DEMOUSD does not need a long backfill: it needs ONE Final epoch
# holding real supply (for the clawback_amount/supply percentage) and
# ONE Final epoch (the same one, here) holding the real revocation/
# clawback counts.
#
# Review finding (this session): a FIRST version of this script posted
# an invented, round SUPPLY figure (1,000,000 units) unrelated to what
# was actually minted (100 units) and clawed back (50 units).
# check_issuer_freeze computes clawback_amount * 10000 / supply in
# INTEGER arithmetic; the real 50-of-100 (50%) became a fictional
# 50-of-1,000,000 (0.005%, truncating to 0 bps), so propose_tier1
# failed. Fixed by reading the REAL circulating supply from Horizon at
# the moment of posting (every field below marked "real" is read from
# the chain, not invented), and by refusing to post at all if the real
# numbers would not clear the registered threshold (step 5).
#
# Which fields are real, which are sample:
#   - peg_ratio, peg_ratio_p10, liquidity_2pct: SAMPLE. DEMOUSD has no
#     real market to observe a peg or liquidity from; these are
#     plausible placeholder values, the same convention deploy/post-
#     demo-signals.sh uses for USDC's own synthetic backfill.
#   - supply: REAL. Read from Horizon's asset-stats endpoint
#     immediately before each post (steps 3 and 5), the actual
#     authorized + authorized_to_maintain_liabilities + unauthorized
#     balance total for DEMOUSD at that moment.
#   - supply_change_bps: REAL. Computed from the previous epoch's own
#     REAL stored supply (read via RiskOracle.signals(), not Horizon -
#     see read_previous_supply's own comment for why), using
#     check_supply_change_consistency's exact formula
#     (contracts/risk-oracle/src/lib.rs). A prior version of this
#     script hardcoded 0 here, which the contract correctly rejected
#     once the real supply genuinely moved between the backfill's last
#     post and the triggering post (the clawback itself does that).
#   - clawback_amount, auth_revocations: REAL. The revocation and
#     clawback in step 4 are genuine Stellar operations against the
#     holder's own trustline; clawback_amount is read back from the
#     clawback transaction's own Horizon effects (the amount it
#     actually moved), never the amount requested.
#   - revoke_tx_hash, clawback_tx_hash: REAL transaction hashes,
#     stellar.expert-linkable, folded into the posted inputs so anyone
#     can check the posted numbers against the chain.
#
# Usage: deploy/demo-asset-trigger.sh testnet [backfill_hours] [--dry-run]
#   backfill_hours: hours of plain DEMOUSD history to post before the
#                   triggering post, oldest first. Default 3, capped
#                   at 71 (same bound as post-demo-signals.sh, for the
#                   same reason).
#   --dry-run: print the resume plan (every step: "already done (tx
#              ...)" or "will submit") and exit before anything is
#              signed. Safe to run any number of times; makes no
#              on-chain calls beyond the same reads a real run would
#              make anyway.
#
# Resumable by design, not just safe to retry: every step below checks
# the REAL chain state before deciding whether to submit anything, the
# same principle steps 1/2/4's "already done" guards already used, now
# extended to the clawback too (previously the one step with no guard
# at all - see RESUME NOTE below). A rerun against today's real state
# submits nothing before the triggering post: holder exists and funded
# (step 1), already minted (step 2), already backfilled (step 3, via
# post_signals's own #103 EpochAlreadyPosted), already revoked and
# already clawed back (step 4, this run's fix) - each detected from
# the chain, not from a local marker file this script could lose or
# never had reason to trust over the chain itself.
#
# RESUME NOTE: a rerun's own CLAWBACK_REQUEST (half of whatever the
# holder holds RIGHT NOW) must never be computed, let alone submitted,
# once a real clawback already exists for this holder - doing so would
# claw back half of the REMAINING balance a second time, corrupting
# the evidence this script exists to produce. find_clawback_tx_hash
# below looks up the real, already-posted clawback from Horizon FIRST;
# only when none exists does this script compute a request amount and
# submit anything.

set -uo pipefail

NETWORK="${1:-}"
BACKFILL_HOURS="${2:-3}"
DRY_RUN=0
for arg in "$@"; do
  [[ "$arg" == "--dry-run" ]] && DRY_RUN=1
done
if [[ "$NETWORK" != "testnet" ]]; then
  echo "usage: $0 testnet [backfill_hours] [--dry-run]" >&2
  exit 1
fi
if ! [[ "$BACKFILL_HOURS" =~ ^[0-9]+$ ]] || (( BACKFILL_HOURS < 1 || BACKFILL_HOURS > 71 )); then
  echo "backfill_hours must be an integer between 1 and 71" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RECORD="$REPO_ROOT/deployments/testnet.json"
DEMO_RECORD="$REPO_ROOT/deployments/testnet-demo-asset.json"
[[ -f "$RECORD" ]] || { echo "FATAL: $RECORD not found; run deploy/deploy.sh testnet first" >&2; exit 1; }
[[ -f "$DEMO_RECORD" ]] || { echo "FATAL: $DEMO_RECORD not found; run deploy/demo-asset.sh testnet first" >&2; exit 1; }

STELLAR_BIN="${STELLAR_CLI_BIN:-stellar}"
EPOCH_SECS=3600
HORIZON_URL="https://horizon-testnet.stellar.org"

RO_ID="$(jq -r '.contracts.risk_oracle.id' "$RECORD")"
ER_ID="$(jq -r '.contracts.event_registry.id' "$RECORD")"
KEEPER_ADDR="$(jq -r '.identities.keeper' "$RECORD")"
DEMO_ID="$(jq -r '.demo_asset.contract_id' "$DEMO_RECORD")"
DEMO_CODE="$(jq -r '.demo_asset.asset_code' "$DEMO_RECORD")"
DEMO_ISSUER_ADDR="$(jq -r '.demo_asset.issuer' "$DEMO_RECORD")"
DEMO_ISSUER=sylox-demo-issuer

log() { echo "==> $*"; }
die() { echo "FATAL: $*" >&2; exit 1; }

# Parses an i128 value out of `stellar contract invoke --send=no`'s
# own output, which wraps a plain integer return in literal double
# quotes (e.g. "1500000000", not 1500000000). A bare ^[0-9]+$ match
# against that raw string never matches, so a check written as "if it
# looks like a number and is > 0" silently fell through to its own
# else branch for every holder that already had a real, nonzero
# balance, treating "already funded" as "needs minting" (see
# docs/event-0-demousd-issuer-freeze.md for what that actually caused
# on this testnet). Strips one leading/trailing double quote if
# present, then requires the result to be ALL digits - never falls
# back to treating an unparseable value as zero or "skip", since
# either of those silently mints into an unknown real balance.
parse_i128() {
  local raw="$1" label="$2"
  local cleaned="${raw#\"}"
  cleaned="${cleaned%\"}"
  if [[ ! "$cleaned" =~ ^[0-9]+$ ]]; then
    die "could not parse $label as an integer (got: $raw)"
  fi
  echo "$cleaned"
}

# Runs `stellar contract invoke --send=no ...` (every argument after
# `label` passed through verbatim) and prints ONLY its stdout -
# whatever that call's own return value actually is, never mixed with
# a CLI warning on stderr. A stray stderr line (a deprecation notice,
# a retry warning) landing in the same string as the real return value
# is exactly the kind of thing that broke the quoted-i128 parsing this
# script already had to fix once; capturing them separately stops that
# class of bug from coming back through a different call site. Dies
# with the real exit status and the real stderr content (read back
# from a temp file, not re-merged into stdout) on failure, rather than
# the caller trying to parse a failure message as if it were data.
invoke_read() {
  local label="$1"
  shift
  local stderr_file out rc
  stderr_file="$(mktemp)"
  out="$("$STELLAR_BIN" contract invoke "$@" 2>"$stderr_file")"
  rc=$?
  if (( rc != 0 )); then
    local err
    err="$(cat "$stderr_file")"
    rm -f "$stderr_file"
    die "$label: stellar contract invoke failed (exit $rc): $err"
  fi
  rm -f "$stderr_file"
  echo "$out"
}

# Reads whether `trustor`'s trustline to `asset_code:asset_issuer` is
# currently authorized, straight from Horizon (not assumed from this
# script's own prior actions, which may not be the only thing that
# ever touched this trustline - e.g. a previous run of this same
# script, now treated as a legitimate prior state to detect and skip
# past, not an error). Returns "true", "false", or dies if the
# trustline cannot be found at all (a holder with no trustline yet is
# a different, earlier problem than this function is meant to check).
read_trustline_authorized() {
  local trustor="$1" asset_code="$2" asset_issuer="$3"
  local account_json
  account_json="$(curl -sSf "$HORIZON_URL/accounts/$trustor" 2>&1)" \
    || die "could not read $trustor's account from Horizon: $account_json"
  local authorized
  authorized="$(echo "$account_json" | jq -r --arg code "$asset_code" --arg issuer "$asset_issuer" \
    '.balances[] | select(.asset_code == $code and .asset_issuer == $issuer) | .is_authorized')"
  [[ -n "$authorized" && "$authorized" != "null" ]] \
    || die "$trustor has no $asset_code:$asset_issuer trustline to check authorization on"
  echo "$authorized"
}

# The jq half of find_revoke_tx_hash, factored out so it can be tested
# against small local JSON samples (deploy/test-demo-asset-trigger-
# find-revoke.sh) without a real Horizon call. Takes Horizon's own
# /accounts/{id}/operations response (already fetched) and returns the
# most recent (the list is order=desc, so [0] is newest)
# set_trust_line_flags operation that actually cleared authorization
# (clear_flags_s contains "authorized", confirmed against the real
# revoke's own operation record) for this exact trustor/asset_code
# pair, or empty if none matches. Checking clear_flags_s and not just
# the operation type matters because set_trust_line_flags is also how
# the OPPOSITE action (re-authorizing) would show up on-chain; this
# script never calls that itself, but a future admin action or a
# different script could, and the newest set_trust_line_flags
# wouldn't then be the real revoke.
select_revoke_tx_hash_from_ops() {
  local ops_json="$1" trustor="$2" asset_code="$3"
  echo "$ops_json" | jq -r --arg trustor "$trustor" --arg code "$asset_code" \
    '[._embedded.records[] | select(.type == "set_trust_line_flags" and .trustor == $trustor and .asset_code == $code and ((.clear_flags_s // []) | index("authorized")))][0].transaction_hash // empty'
}

# Finds the real transaction hash of `issuer`'s most recent
# set_trust_line_flags operation against `trustor`'s trustline to
# asset_code, straight from Horizon. Used only when
# read_trustline_authorized finds the trustline ALREADY deauthorized
# (a prior interrupted run of this script got that far before dying),
# so the evidence posted in step 6 still carries the real revoke
# transaction hash rather than an empty one. This script only ever
# calls set-trustline-flags with --clear-authorize (never a
# re-authorize), so matching on type + trustor + asset_code alone is
# unambiguous for this issuer; there is no second, opposite-direction
# set_trust_line_flags call anywhere in this codebase to confuse it
# with. Dies rather than return empty if no match is found: posting
# evidence with no revoke hash at all is worse than stopping here.
find_revoke_tx_hash() {
  local issuer_addr="$1" trustor="$2" asset_code="$3"
  local ops_json
  ops_json="$(curl -sSf "$HORIZON_URL/accounts/$issuer_addr/operations?order=desc&limit=200" 2>&1)" \
    || die "could not read $issuer_addr's operations from Horizon: $ops_json"
  local tx_hash
  tx_hash="$(select_revoke_tx_hash_from_ops "$ops_json" "$trustor" "$asset_code")"
  [[ -n "$tx_hash" ]] \
    || die "could not find a set_trust_line_flags operation against $trustor's $asset_code trustline in $issuer_addr's last 200 operations; the trustline reads deauthorized but its own revoke transaction cannot be located"
  echo "$tx_hash"
}

# The jq half of find_clawback_tx_hash, factored out the same way
# select_revoke_tx_hash_from_ops is (tested against local JSON samples
# in deploy/test-demo-asset-trigger-find-clawback.sh, no real Horizon
# call). A clawback operation's holder-identifying field is `from`,
# not `trustor` (confirmed against the real clawback operation's own
# Horizon record: trustor is null, from is the holder) - a clawback
# is not a trustline operation, so it has no trustor field at all.
select_clawback_tx_hash_from_ops() {
  local ops_json="$1" holder="$2" asset_code="$3"
  echo "$ops_json" | jq -r --arg holder "$holder" --arg code "$asset_code" \
    '[._embedded.records[] | select(.type == "clawback" and .from == $holder and .asset_code == $code)][0].transaction_hash // empty'
}

# Finds the real transaction hash AND real amount of `issuer`'s most
# recent clawback operation against `holder`'s asset_code balance,
# straight from Horizon. Used to detect "this holder already had a
# real clawback" BEFORE this script computes or submits a new one -
# see this file's own RESUME NOTE in its header for why that ordering
# matters. Returns empty (not a die) when no match is found: unlike a
# missing revoke (which read_trustline_authorized's own state check
# already proved must exist once the trustline reads deauthorized),
# "no clawback yet" is the normal, expected state for the first real
# run and must not be treated as an error here.
find_clawback_tx_hash() {
  local issuer_addr="$1" holder="$2" asset_code="$3"
  local ops_json
  ops_json="$(curl -sSf "$HORIZON_URL/accounts/$issuer_addr/operations?order=desc&limit=200" 2>&1)" \
    || die "could not read $issuer_addr's operations from Horizon: $ops_json"
  select_clawback_tx_hash_from_ops "$ops_json" "$holder" "$asset_code"
}

# Real amount moved by a clawback transaction, in stroops, read from
# ITS OWN account_debited effect - the same technique this script
# already uses right after submitting a new clawback (step 4), now
# shared so a resumed run reads the SAME real number from a PRIOR
# run's clawback instead of recomputing anything.
read_clawback_amount_stroops() {
  local tx_hash="$1"
  local effects decimal
  effects="$(curl -sSf "$HORIZON_URL/transactions/$tx_hash/effects" 2>&1)" \
    || die "could not read clawback transaction's effects from Horizon: $effects"
  decimal="$(echo "$effects" | jq -r '._embedded.records[] | select(.type == "account_debited") | .amount' | head -1)"
  [[ -n "$decimal" && "$decimal" != "null" ]] || die "could not find the clawback's own account_debited effect for $tx_hash"
  jq -n --arg d "$decimal" '($d|tonumber) * 10000000 | round'
}

# Real circulating supply for DEMOUSD, in stroops (SCALE 1e7), read
# fresh from Horizon every time it's needed: authorized +
# authorized_to_maintain_liabilities + unauthorized balances, the
# total actually issued and held outside the issuer account (the
# issuer's own SAC balance always reads as effectively unlimited, not
# a real supply figure).
read_real_supply() {
  local stats
  stats="$(curl -sSf "$HORIZON_URL/assets?asset_code=$DEMO_CODE&asset_issuer=$DEMO_ISSUER_ADDR" 2>&1)" \
    || die "could not read DEMOUSD's asset stats from Horizon: $stats"
  local authorized maintain unauthorized
  authorized="$(echo "$stats" | jq -r '._embedded.records[0].balances.authorized // "0"')"
  maintain="$(echo "$stats" | jq -r '._embedded.records[0].balances.authorized_to_maintain_liabilities // "0"')"
  unauthorized="$(echo "$stats" | jq -r '._embedded.records[0].balances.unauthorized // "0"')"
  # Horizon reports these as decimal strings at 7 decimals ("150.0000000");
  # convert to stroops with jq's own arithmetic, not bash integer math.
  jq -n --arg a "$authorized" --arg m "$maintain" --arg u "$unauthorized" \
    '(($a|tonumber) + ($m|tonumber) + ($u|tonumber)) * 10000000 | round'
}

LIQUIDITY="500000000"        # 50 units at SCALE 1e7. SAMPLE (see header).

# Reads epoch - 1's own REAL stored supply via RiskOracle.signals(),
# not Horizon: check_supply_change_consistency (contracts/risk-oracle/
# src/lib.rs) compares against storage::get_slot's own previous ring
# slot, i.e. what THIS asset's own prior post actually recorded, not
# whatever Horizon reports right now (which can have moved again by
# posting time, exactly what happened here: the clawback drops the
# real Horizon supply AFTER the backfill already posted a higher
# figure for the prior epoch). Echoes empty, not 0 and not a die, when
# there is no prior slot (epoch 0, or a gap) - epoch 0's own
# unconditional pass and the "no previous slot" unconditional pass in
# check_supply_change_consistency are exactly the two cases
# compute_supply_change_bps below also treats as "no check, 0 is
# correct by definition", so empty here must mean 0 there, not an
# error.
read_previous_supply() {
  local epoch="$1"
  if (( epoch == 0 )); then
    echo ""
    return
  fi
  local previous_epoch=$(( epoch - 1 ))
  local out
  out="$(invoke_read "signals(DEMOUSD, $previous_epoch)" --id "$RO_ID" --source-account "$DEMO_ISSUER" \
    --network testnet --send=no -- signals --asset "$DEMO_ID" --epoch "$previous_epoch")"
  if [[ "$out" == "null" ]]; then
    echo ""
    return
  fi
  echo "$out" | jq -r '.supply'
}

# Copies check_supply_change_consistency's own formula exactly
# (contracts/risk-oracle/src/lib.rs): ((supply - previous.supply) *
# 10_000) / previous.supply, i128 division truncating toward zero -
# confirmed this matches bash's own `$(( ))` integer division
# (verified by hand: $(( -7 / 2 )) is -3, the same truncate-toward-
# zero Rust's i128 division uses, not Python's floor -4). Returns "0"
# when there is no previous slot to compare against (read_
# previous_supply returns empty for epoch 0 or a missing prior post) -
# the contract's own two unconditional-pass cases, where ANY posted
# supply_change_bps is accepted, so posting the true, unconstrained
# value of 0 is correct, not a placeholder.
compute_supply_change_bps() {
  local supply="$1" previous_supply="$2"
  if [[ -z "$previous_supply" ]]; then
    echo "0"
    return
  fi
  (( previous_supply != 0 )) || { echo "0"; return; }   # Same zero-previous-supply skip check_supply_change_consistency itself makes.
  echo $(( (supply - previous_supply) * 10000 / previous_supply ))
}

# -- [1/6] Holder identity and trustline -----------------------------
#
# sylox-demo-holder-2, not the original sylox-demo-holder: that first
# holder's own trustline is permanently deauthorized (the real event-0
# revocation, see docs/event-0-demousd-issuer-freeze.md) with 150
# DEMOUSD of real clawback-eligible balance still on it. Reusing it
# here would either collide with read_trustline_authorized's own
# unexpected-state check below (it is neither "authorized" nor the
# pre-change-trust "none" case this script expects at a fresh start)
# or, worse, mint a second batch on top of an already-event-marked
# holder. This script's own header already says a reset means a fresh
# holder, not a re-run against the same one.

# plan() prints one line of the dry-run/resume plan, in the exact
# format the PR's own dry-run evidence uses: "already done (tx ...)"
# or "will submit (...)". Always printed, dry-run or not, so a real
# run's own log carries the same plan a --dry-run would have shown,
# right before actually doing it.
plan() {
  local label="$1" status="$2" detail="${3:-}"
  if [[ -n "$detail" ]]; then
    log "[plan] $label: $status ($detail)"
  else
    log "[plan] $label: $status"
  fi
}

log "[1/6] DEMOUSD holder identity"
HOLDER=sylox-demo-holder-2
HOLDER_EXISTS=0
"$STELLAR_BIN" keys address "$HOLDER" >/dev/null 2>&1 && HOLDER_EXISTS=1

if (( HOLDER_EXISTS )); then
  plan "holder identity ($HOLDER)" "already done" "$("$STELLAR_BIN" keys address "$HOLDER")"
else
  plan "holder identity ($HOLDER)" "will submit" "friendbot funding"
  (( DRY_RUN )) || { "$STELLAR_BIN" keys generate "$HOLDER" --network testnet --fund; log "identity $HOLDER created and funded"; }
fi
# In dry-run, a holder that does not exist yet has no address to check
# a trustline against - every check from here on on an as-yet-
# nonexistent holder reports "cannot check yet", not a false "will
# submit", since this script genuinely cannot know a fresh holder's
# eventual trustline/balance/clawback state before it exists.
HOLDER_ADDR="$("$STELLAR_BIN" keys address "$HOLDER" 2>/dev/null || true)"
if [[ -z "$HOLDER_ADDR" ]]; then
  (( DRY_RUN )) || die "could not read $HOLDER's address after creating it"
fi

if [[ -n "$HOLDER_ADDR" ]]; then
  # Persisted so anything outside this script's own local CLI identity
  # store (deploy/extend-ttl.sh, run from a container that never
  # created or imported "sylox-demo-holder-2") can still find the
  # holder's address without deriving it from the identity itself.
  # Skipped in dry-run: writing this file is a local side effect a
  # dry-run should not perform either.
  if (( ! DRY_RUN )); then
    tmp_demo_record="$(mktemp)"
    jq --arg holder "$HOLDER_ADDR" '.demo_asset.holder = $holder' "$DEMO_RECORD" > "$tmp_demo_record"
    mv "$tmp_demo_record" "$DEMO_RECORD"
  fi

  HOLDER_TRUSTLINE_EXISTS=0
  account_json_step1="$(curl -sSf "$HORIZON_URL/accounts/$HOLDER_ADDR" 2>&1)" || account_json_step1=""
  if [[ -n "$account_json_step1" ]] && echo "$account_json_step1" | jq -e --arg code "$DEMO_CODE" --arg issuer "$DEMO_ISSUER_ADDR" \
      '.balances[]? | select(.asset_code == $code and .asset_issuer == $issuer)' >/dev/null 2>&1; then
    HOLDER_TRUSTLINE_EXISTS=1
  fi
  if (( HOLDER_TRUSTLINE_EXISTS )); then
    plan "trustline ($DEMO_CODE)" "already done"
  else
    plan "trustline ($DEMO_CODE)" "will submit" "change-trust"
  fi
  if (( ! DRY_RUN )); then
    log "Opening $HOLDER's trustline to $DEMO_CODE:$DEMO_ISSUER_ADDR"
    # A repeat change-trust to an already-open trustline is a harmless
    # no-op on Stellar (same limit, same flags), so no "already
    # exists" branch is needed here, unlike the SAC/asset-registration
    # steps.
    "$STELLAR_BIN" tx new change-trust --source-account "$HOLDER" \
      --line "$DEMO_CODE:$DEMO_ISSUER_ADDR" --network testnet >/dev/null
  fi
else
  plan "trustline ($DEMO_CODE)" "cannot check yet" "holder identity does not exist locally"
fi

# -- [2/6] Issue the holder some DEMOUSD, ONCE ------------------------
#
# Review finding (this session): an earlier version of this script
# minted on every run with no "already done" check, unlike every
# other step here. Running the script twice (once after a transient
# RPC timeout, once to retry) silently minted TWICE, corrupting the
# holder's own real balance relative to what the rest of the script
# assumed. Guarded now: mint only if the holder's real balance (read
# from the chain, not assumed) is still zero.

log "[2/6] DEMOUSD balance for $HOLDER_ADDR"
if [[ -z "$HOLDER_ADDR" ]]; then
  plan "mint" "cannot check yet" "holder identity does not exist locally"
else
  holder_balance_before_raw="$(invoke_read "$HOLDER_ADDR's DEMOUSD balance" --id "$DEMO_ID" --source-account "$DEMO_ISSUER" \
    --network testnet --send=no -- balance --id "$HOLDER_ADDR")"
  holder_balance_before="$(parse_i128 "$holder_balance_before_raw" "$HOLDER_ADDR's DEMOUSD balance")"
  if (( holder_balance_before > 0 )); then
    plan "mint" "already done" "$holder_balance_before stroops already held"
    log "$HOLDER_ADDR already holds $holder_balance_before stroops of DEMOUSD; not minting again"
  else
    plan "mint" "will submit" "1000000000 stroops"
    if (( ! DRY_RUN )); then
      HOLDER_BALANCE=1000000000   # 100 units at SCALE 1e7, arbitrary plausible size, enough to partially clawback.
      log "Issuing $HOLDER_BALANCE DEMOUSD to $HOLDER_ADDR"
      "$STELLAR_BIN" contract invoke --id "$DEMO_ID" --source-account "$DEMO_ISSUER" \
        --network testnet -- mint --to "$HOLDER_ADDR" --amount "$HOLDER_BALANCE" >/dev/null
      log "minted $HOLDER_BALANCE DEMOUSD to $HOLDER_ADDR"
    fi
  fi
fi

# -- [3/6] Backfill plain DEMOUSD history (oldest first) -------------
#
# No real issuer action in these hours: just the REAL current supply
# (read fresh per post, since mint/clawback can change it between
# posts) and a SAMPLE liquidity figure, so check_issuer_freeze's own
# latest_supply has something real to read even on the triggering
# epoch itself (clawback_sum / latest_supply).

log "[3/6] Backfilling $BACKFILL_HOURS hour(s) of plain DEMOUSD history"
NOW="$(date +%s)"
NEWEST_CLOSED=$(( NOW / EPOCH_SECS - 1 ))
FIRST_EPOCH=$(( NEWEST_CLOSED - BACKFILL_HOURS ))   # Leaves the newest closed hour for the triggering post itself.

for (( epoch = FIRST_EPOCH; epoch < NEWEST_CLOSED; epoch++ )); do
  existing_signal="$(invoke_read "signals(DEMOUSD, $epoch)" --id "$RO_ID" --source-account "$DEMO_ISSUER" \
    --network testnet --send=no -- signals --asset "$DEMO_ID" --epoch "$epoch")"
  if [[ "$existing_signal" != "null" ]]; then
    plan "backfill epoch $epoch" "already done"
    continue
  fi
  plan "backfill epoch $epoch" "will submit"
  (( DRY_RUN )) && continue

  supply_now="$(read_real_supply)"
  # Same consistency check the triggering post (step 6) has to
  # satisfy - computed for real here too, not hardcoded 0, in case a
  # future run's backfill window ever straddles a real mint/clawback
  # (it does not today, but the computation costs one extra read-only
  # call and removing the risk is cheap; see this file's own header
  # RESUME NOTE for the reasoning behind computing this for real
  # rather than assuming consecutive backfill posts can't differ).
  previous_supply="$(read_previous_supply "$epoch")"
  supply_change_bps="$(compute_supply_change_bps "$supply_now" "$previous_supply")"
  inputs_hash="$(printf 'demo-asset-backfill:%s:%s' "$epoch" "$supply_now" | shasum -a 256 | cut -d' ' -f1)"
  signal_set="{\"epoch\":$epoch,\"posted_at\":0,\"peg_ratio\":\"10000000\",\"peg_ratio_p10\":\"9998000\",\"liquidity_2pct\":\"$LIQUIDITY\",\"redemption_net\":\"0\",\"supply\":\"$supply_now\",\"supply_change_bps\":$supply_change_bps,\"issuer_actions\":{\"clawbacks\":0,\"clawback_amount\":\"0\",\"auth_revocations\":0,\"flag_changes\":0},\"endpoint\":\"Unknown\",\"inputs_hash\":\"$inputs_hash\",\"poster\":\"$KEEPER_ADDR\"}"
  if ! post_out="$("$STELLAR_BIN" contract invoke --id "$RO_ID" --source-account sylox-testnet-keeper --network testnet -- \
    post_signals --keeper "$KEEPER_ADDR" --asset "$DEMO_ID" --s "$signal_set" 2>&1)"; then
    if [[ "$post_out" == *"Error(Contract, #103)"* ]]; then
      log "epoch $epoch already posted; skipping"
      continue
    fi
    die "post_signals(DEMOUSD, $epoch) failed:
$post_out"
  fi
  log "epoch $epoch posted (plain history, real supply=$supply_now, supply_change_bps=$supply_change_bps)"
done

# -- [4/6] The real revocation and clawback --------------------------
#
# Real on-chain transactions against the holder's own trustline, from
# the issuer: this is what makes the event genuine, not a posted
# claim. CLAWBACK_ENABLED was set on the issuer BEFORE this trustline
# was opened in step 1 (deploy/demo-asset.sh's own step 2, a Stellar
# protocol requirement, not a Sylox one), so the clawback below is
# valid. CLAWBACK_REQUEST is what this script ASKS to claw back
# (bounded by the holder's own real balance, read above); the amount
# actually posted in step 5 is read back from the transaction's own
# Horizon effects, not this requested figure, in case the two ever
# differ (they should not, for a single whole clawback, but the posted
# number must be the real one regardless).

log "[4/6] Revoking $HOLDER_ADDR's authorization for $DEMO_CODE"
if [[ -z "$HOLDER_ADDR" ]]; then
  plan "revoke" "cannot check yet" "holder identity does not exist locally"
  plan "clawback" "cannot check yet" "holder identity does not exist locally"
else
  # Checked by real state, not assumed: a fresh holder's trustline
  # reads "true" here (change-trust alone does not revoke anything);
  # only a PRIOR run of this same script (interrupted after revoking
  # but before the clawback) would ever find "false" already. Either
  # is a known, safe-to-continue state; anything else (e.g. the
  # account not holding this trustline at all) is a real problem, not
  # something to paper over by calling set-trustline-flags regardless.
  already_authorized="$(read_trustline_authorized "$HOLDER_ADDR" "$DEMO_CODE" "$DEMO_ISSUER_ADDR")"
  case "$already_authorized" in
    true)
      plan "revoke" "will submit"
      if (( ! DRY_RUN )); then
        if ! revoke_out="$("$STELLAR_BIN" tx new set-trustline-flags --source-account "$DEMO_ISSUER" --network testnet \
          --trustor "$HOLDER_ADDR" --asset "$DEMO_CODE:$DEMO_ISSUER_ADDR" --clear-authorize 2>&1)"; then
          die "revoking $HOLDER_ADDR's authorization failed:
$revoke_out"
        fi
        echo "$revoke_out"
        REVOKE_TX_HASH="$(echo "$revoke_out" | grep -oE '[a-f0-9]{64}' | head -1)"
        log "revocation transaction: $REVOKE_TX_HASH"
      fi
      ;;
    false)
      REVOKE_TX_HASH="$(find_revoke_tx_hash "$DEMO_ISSUER_ADDR" "$HOLDER_ADDR" "$DEMO_CODE")"
      plan "revoke" "already done" "$REVOKE_TX_HASH"
      log "$HOLDER_ADDR's trustline is already deauthorized (a prior run of this script got this far); not revoking again"
      log "found the real revoke transaction from a prior run: $REVOKE_TX_HASH"
      ;;
    *)
      die "$HOLDER_ADDR's $DEMO_CODE trustline authorization read as an unexpected value: $already_authorized"
      ;;
  esac

  # RESUME NOTE (this file's own header): checked BEFORE computing any
  # clawback request amount, not after - a rerun's own "half of
  # whatever the holder holds right now" must never even be computed
  # once a real clawback already exists, since the holder's current
  # balance already reflects that prior clawback and halving it again
  # would be a SECOND real clawback, not a no-op. find_clawback_tx_hash
  # returns empty (not a die) when none exists - that is the normal,
  # expected state on a genuinely first run.
  EXISTING_CLAWBACK_TX_HASH="$(find_clawback_tx_hash "$DEMO_ISSUER_ADDR" "$HOLDER_ADDR" "$DEMO_CODE")"
  if [[ -n "$EXISTING_CLAWBACK_TX_HASH" ]]; then
    CLAWBACK_TX_HASH="$EXISTING_CLAWBACK_TX_HASH"
    CLAWBACK_AMOUNT="$(read_clawback_amount_stroops "$CLAWBACK_TX_HASH")"
    plan "clawback" "already done" "$CLAWBACK_TX_HASH, $CLAWBACK_AMOUNT stroops"
    log "$HOLDER_ADDR already has a real clawback from a prior run; not clawing back again"
    log "found the real clawback transaction from a prior run: $CLAWBACK_TX_HASH ($CLAWBACK_AMOUNT stroops)"
  else
    holder_balance_now_raw="$(invoke_read "$HOLDER_ADDR's real DEMOUSD balance" --id "$DEMO_ID" --source-account "$DEMO_ISSUER" \
      --network testnet --send=no -- balance --id "$HOLDER_ADDR")"
    holder_balance_now="$(parse_i128 "$holder_balance_now_raw" "$HOLDER_ADDR's real DEMOUSD balance")"
    CLAWBACK_REQUEST=$(( holder_balance_now / 2 ))   # Half of whatever the holder really holds right now.
    (( CLAWBACK_REQUEST > 0 )) || die "$HOLDER_ADDR holds $holder_balance_now stroops of DEMOUSD; nothing to claw back"
    plan "clawback" "will submit" "$CLAWBACK_REQUEST of $holder_balance_now stroops held"

    if (( ! DRY_RUN )); then
      log "Clawing back $CLAWBACK_REQUEST (of $holder_balance_now held) from $HOLDER_ADDR"
      if ! clawback_out="$("$STELLAR_BIN" tx new clawback --source-account "$DEMO_ISSUER" --network testnet \
        --from "$HOLDER_ADDR" --asset "$DEMO_CODE:$DEMO_ISSUER_ADDR" --amount "$CLAWBACK_REQUEST" 2>&1)"; then
        die "clawback from $HOLDER_ADDR failed:
$clawback_out"
      fi
      echo "$clawback_out"
      CLAWBACK_TX_HASH="$(echo "$clawback_out" | grep -oE '[a-f0-9]{64}' | head -1)"
      log "clawback transaction: $CLAWBACK_TX_HASH"

      # Read the REAL amount moved from Horizon's own effects for this
      # transaction, not CLAWBACK_REQUEST: that is what was asked for,
      # this is what the chain actually recorded.
      CLAWBACK_AMOUNT="$(read_clawback_amount_stroops "$CLAWBACK_TX_HASH")"
      log "real clawback amount, from Horizon's own effects: $CLAWBACK_AMOUNT stroops"
    fi
  fi
fi

if (( DRY_RUN )); then
  log "dry run complete; nothing was submitted. Re-run without --dry-run to execute the plan above."
  exit 0
fi

# -- [5/6] Refuse to post if the real numbers would not actually trigger --
#
# Review finding (this session): this is the check that makes the
# earlier SUPPLY bug impossible to repeat silently. Mirrors
# check_issuer_freeze's own clawback_amount * 10000 / supply >=
# freeze_pct_bps check (contracts/event-registry/src/lib.rs) exactly,
# including its integer division, against the CURRENT canonical
# IssuerFreeze definition and the REAL supply at posting time.

CANONICAL_VERSION="$(invoke_read "current_version(DEMOUSD, IssuerFreeze)" --id "$ER_ID" --source-account sylox-testnet-admin --network testnet --send=no -- current_version --asset "$DEMO_ID" --kind '"IssuerFreeze"')"
[[ "$CANONICAL_VERSION" =~ ^[1-9][0-9]*$ ]] || die "current_version(DEMOUSD, IssuerFreeze) is not registered ($CANONICAL_VERSION); run deploy/demo-asset.sh testnet first"
def_json="$(invoke_read "definition(DEMOUSD, IssuerFreeze, v$CANONICAL_VERSION)" --id "$ER_ID" --source-account sylox-testnet-admin --network testnet --send=no -- definition --asset "$DEMO_ID" --kind '"IssuerFreeze"' --version "$CANONICAL_VERSION")"
FREEZE_PCT_BPS="$(echo "$def_json" | jq -r '.freeze_pct_bps')"

supply_at_trigger="$(read_real_supply)"
(( supply_at_trigger > 0 )) || die "DEMOUSD's real supply read as 0; cannot check the freeze threshold against it"
bps_reached=$(( CLAWBACK_AMOUNT * 10000 / supply_at_trigger ))
log "[5/6] Check: clawback_amount * 10000 / supply = $CLAWBACK_AMOUNT * 10000 / $supply_at_trigger = $bps_reached bps (threshold: freeze_pct_bps=$FREEZE_PCT_BPS)"
if (( bps_reached < FREEZE_PCT_BPS )); then
  die "the real clawback ($CLAWBACK_AMOUNT stroops) against the real supply ($supply_at_trigger stroops) is only $bps_reached bps, below freeze_pct_bps=$FREEZE_PCT_BPS. Refusing to post a signal that would not actually pass check_issuer_freeze. The revocation and clawback above already happened on-chain and cannot be undone by this script; adjust the holder's balance or claw back a larger share before posting, or accept that this asset's real numbers do not clear the registered threshold."
fi
log "Real numbers clear the threshold ($bps_reached >= $FREEZE_PCT_BPS bps); posting the triggering signal."

# -- [6/6] Post the triggering signal, with the real tx hashes --------
#
# The keeper posts THIS hour's signal set with issuer_actions showing
# exactly the revocation and the REAL clawback amount (read in step 4,
# not requested), the REAL supply at this moment (step 5), and the
# real transaction hashes folded into the inputs the keeper hashes
# (inputs_hash), so anyone can check the posted numbers against the
# chain.

log "[6/6] Posting the triggering signal for hour $NEWEST_CLOSED"

# The bug this PR exists to fix: hardcoding 0 here is only correct
# when the real supply didn't move since the previous epoch's own
# posted supply. It genuinely moves on the triggering post itself
# (the clawback above just dropped it), so this has to be the real
# figure - see compute_supply_change_bps's own comment for exactly
# which contract check this satisfies and how.
previous_supply_at_trigger="$(read_previous_supply "$NEWEST_CLOSED")"
trigger_supply_change_bps="$(compute_supply_change_bps "$supply_at_trigger" "$previous_supply_at_trigger")"
log "supply_change_bps for epoch $NEWEST_CLOSED: ($supply_at_trigger - $previous_supply_at_trigger) * 10000 / $previous_supply_at_trigger = $trigger_supply_change_bps"

inputs_json=$(jq -nc \
  --arg epoch "$NEWEST_CLOSED" \
  --arg clawback_amount "$CLAWBACK_AMOUNT" \
  --arg supply "$supply_at_trigger" \
  --arg revoke_tx "$REVOKE_TX_HASH" \
  --arg clawback_tx "$CLAWBACK_TX_HASH" \
  '{epoch: ($epoch|tonumber), clawback_amount: ($clawback_amount|tonumber), supply: ($supply|tonumber), auth_revocations: 1, revoke_tx_hash: $revoke_tx, clawback_tx_hash: $clawback_tx}')
inputs_hash="$(printf '%s' "$inputs_json" | shasum -a 256 | cut -d' ' -f1)"
signal_set="{\"epoch\":$NEWEST_CLOSED,\"posted_at\":0,\"peg_ratio\":\"10000000\",\"peg_ratio_p10\":\"9998000\",\"liquidity_2pct\":\"$LIQUIDITY\",\"redemption_net\":\"0\",\"supply\":\"$supply_at_trigger\",\"supply_change_bps\":$trigger_supply_change_bps,\"issuer_actions\":{\"clawbacks\":1,\"clawback_amount\":\"$CLAWBACK_AMOUNT\",\"auth_revocations\":1,\"flag_changes\":0},\"endpoint\":\"Unknown\",\"inputs_hash\":\"$inputs_hash\",\"poster\":\"$KEEPER_ADDR\"}"

# RESUME NOTE: if a prior run already posted this exact epoch (e.g.
# this script died between posting and the final log line, or ran
# twice in immediate succession), post_signals itself rejects the
# repeat with #103 EpochAlreadyPosted - the same signal step 3's
# backfill loop already treats as "already done", not a failure, here
# too. The REAL posted record is read back via signals() so this
# run's own report still carries a real epoch/state, not a guess.
if ! trigger_out="$("$STELLAR_BIN" contract invoke --id "$RO_ID" --source-account sylox-testnet-keeper --network testnet -- \
  post_signals --keeper "$KEEPER_ADDR" --asset "$DEMO_ID" --s "$signal_set" 2>&1)"; then
  if [[ "$trigger_out" == *"Error(Contract, #103)"* ]]; then
    log "epoch $NEWEST_CLOSED already posted (a prior run got this far); not posting again"
  else
    die "post_signals(DEMOUSD, $NEWEST_CLOSED, the triggering signal) failed:
$trigger_out"
  fi
else
  echo "$trigger_out"
  log "triggering signal posted for epoch $NEWEST_CLOSED: clawback_amount=$CLAWBACK_AMOUNT (real), supply=$supply_at_trigger (real), supply_change_bps=$trigger_supply_change_bps (real), auth_revocations=1"
  log "inputs (with real tx hashes): $inputs_json"
fi

PENDING_UNTIL=$(( $(date +%s) + 7200 ))
log "This signal is Pending until $(date -u -r "$PENDING_UNTIL" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$PENDING_UNTIL" +%Y-%m-%dT%H:%M:%SZ) UTC (signal_dispute_secs, 2h), then effectively Final."
log "propose_tier1 reads effectively-Final slots (ADR-008): this script does NOT wait for that; run deploy/demo-asset-propose.sh testnet once that time has passed."

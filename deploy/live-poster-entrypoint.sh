#!/usr/bin/env bash
# Entrypoint for the sylox-live-poster Railway cron service's image
# (deploy/Dockerfile.live-poster). Imports the testnet keeper's
# secret key from the SYLOX_KEEPER_SECRET Railway variable as the
# sylox-testnet-keeper identity, confirms the imported address really
# is the keeper deployments/testnet.json names, then runs ONE
# deploy/post-demo-signals.sh testnet --live pass and exits (the
# service's own restart policy is Never: one pass per scheduled run,
# not a daemon).
#
# The secret must never appear in argv, in `set -x` output, or in any
# log line - all three are checked below, not just assumed:
#   - argv: the secret is piped into `stellar keys add ... --secret-
#     key` over stdin, never passed as a command-line argument to
#     anything (confirmed against the real CLI: `--secret-key` alone
#     takes no value and reads stdin when it is not a terminal).
#   - set -x: deliberately NOT enabled anywhere in this script, and
#     SYLOX_KEEPER_SECRET is never echoed, printed, or interpolated
#     into any string this script builds for a log line.
#   - logs: `stellar keys add`'s own stdout/stderr (captured below)
#     never includes the secret it was just given - confirmed by
#     hand against the real CLI output, which only ever names the
#     identity file it wrote, never the secret itself.

set -uo pipefail

KEEPER_IDENTITY=sylox-testnet-keeper
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RECORD="$REPO_ROOT/deployments/testnet.json"

log() { echo "==> $*"; }
die() { echo "FATAL: $*" >&2; exit 1; }

[[ -f "$RECORD" ]] || die "$RECORD not found in this image"
[[ -n "${SYLOX_KEEPER_SECRET:-}" ]] || die "SYLOX_KEEPER_SECRET is not set"

EXPECTED_KEEPER_ADDR="$(jq -r '.identities.keeper' "$RECORD")"
[[ -n "$EXPECTED_KEEPER_ADDR" && "$EXPECTED_KEEPER_ADDR" != "null" ]] \
  || die "could not read .identities.keeper from $RECORD"

log "Importing the keeper identity from SYLOX_KEEPER_SECRET"
# Piped over stdin, never passed as an argument: `stellar keys add`
# reads the secret from stdin when it is not an interactive terminal,
# the same mechanism verified by hand against this exact CLI version
# before writing this script. Every container start is a fresh
# filesystem (no prior ~/.config/stellar state), so there is nothing
# to overwrite and no --overwrite flag is needed.
#
# Review finding: on FAILURE, the CLI's own output is withheld, never
# logged - a rejected input could be the secret itself (e.g. SYLOX_
# KEEPER_SECRET set to something malformed, or to stray extra text
# around the real secret), and an error message that echoes back what
# it could not parse is a real way to leak it. The success path below
# is unaffected: confirmed by hand that a SUCCESSFUL `stellar keys
# add` only ever names the identity file it wrote, never the secret,
# so logging that output on success is still safe.
if ! import_out="$(printf '%s' "$SYLOX_KEEPER_SECRET" | stellar keys add "$KEEPER_IDENTITY" --secret-key 2>&1)"; then
  die "importing the keeper identity failed (output withheld; check SYLOX_KEEPER_SECRET is a valid S... secret)"
fi
log "$import_out"

IMPORTED_ADDR="$(stellar keys address "$KEEPER_IDENTITY" 2>&1)"
if [[ "$IMPORTED_ADDR" != "$EXPECTED_KEEPER_ADDR" ]]; then
  die "the imported keeper identity's address ($IMPORTED_ADDR) does not match .identities.keeper in $RECORD ($EXPECTED_KEEPER_ADDR). Refusing to post as the wrong identity. Check the SYLOX_KEEPER_SECRET variable."
fi
log "Imported keeper identity confirmed: $IMPORTED_ADDR matches .identities.keeper"

exec "$REPO_ROOT/deploy/post-demo-signals.sh" testnet --live

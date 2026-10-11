# Testnet deploy order

Run these in this exact order. Running them out of order is not just
unsupported, it silently makes the asset take far longer to start
scoring (see the note on `first_epoch` below) — `deploy/smoke-
testnet.sh` refuses to run until there is posting history, specifically
to make getting this wrong harder.

1. `deploy/deploy.sh testnet`
   Deploys and wires the four contracts, issues TUSD, registers the
   tracked asset, and writes `deployments/testnet.json`.

2. `deploy/post-demo-signals.sh testnet [epochs]`
   Backfills synthetic demo signals so the oracle has history. Must
   run before step 3. Posts oldest epoch first.

3. `deploy/smoke-testnet.sh`
   Verifies the live deployment. Refuses to run if the tracked asset
   has no posting history yet (`RiskOracle.first_epoch` is `None`),
   specifically to stop this script's own write check from becoming
   the asset's first-ever post (see below).

4. Continuous posting, via `deploy/post-demo-signals.sh testnet --live`
   on a 5-minute loop, first on a local machine as a stopgap, then as
   a Railway cron job once this merges, until a real keeper service
   exists. Never run alongside the backfill or smoke test on the same
   asset; see `--live`'s own section below.

## Why the order matters: `first_epoch` is write-once

`RiskOracle.first_epoch(asset)` is set exactly once, by whichever post
reaches the contract first for that asset
(`storage::set_first_epoch_if_unset`), and it never moves afterward.
`score()`'s 7 day history requirement (`AGGREGATE_SLOTS_7D`, 168
epochs, technical-doc.md Section 6.5) counts forward from `first_epoch`,
not from "now" and not from the oldest epoch ever posted.

If `smoke-testnet.sh` runs before `post-demo-signals.sh`, its own write
check (which posts one fresh epoch if the asset has no history yet)
becomes the asset's first-ever post. `first_epoch` then latches onto
that moment. When the backfill runs afterward and posts OLDER epochs
into the past, that data lands fine in the ring and signal archive, but
`first_epoch` has already been claimed and never moves to reflect the
older history. The asset then needs a full 168 hours counted forward
from that late `first_epoch`, instead of the ~96 additional hours it
would need if `first_epoch` had correctly landed on the oldest
backfilled epoch (168 total, 72 of them already backfilled).

This happened once already during this project's testnet redeploy
(PR #35) and cost a full redeploy-and-backfill cycle to fix. Known gap,
tracked separately (not fixed here): `set_first_epoch_if_unset` could
instead lower `first_epoch` when an older epoch is posted after the
fact, but `first_epoch` is also read by the aggregation's missing-hour
accounting, so that change needs its own review, likely alongside
`upgrade()`.

## `post-demo-signals.sh`'s own timing

This script takes real wall-clock minutes to post a multi-epoch
backfill. It recomputes "now" and the newest closed epoch fresh before
every single post, rather than once at the start, and skips (logging
it) rather than aborts if a requested epoch has not actually closed by
the time its own turn comes. The `epochs` argument is capped at 71, one
less than the 72 hour backfill window `RiskOracle.check_epoch_window`
enforces, so the oldest requested epoch always has at least one epoch
of slack left when the run reaches it.

A second, narrower version of the same timing issue exists one level
down: each sub-epoch within an hour has its OWN close time, strictly
earlier than the hour's close for every sub before the last, and its
own `SUB_BACKFILL_SECS` (2h) staleness bound measured from THAT close,
not the hour's. A long-running backfill can post through most of an
hour's sub-epochs and have the earliest ones go stale before it gets
to them, even while the hour itself is still safely within its own
window — observed for real on the last hour of a 71-epoch run. Fixed
the same way: skip (log it) an individual sub-epoch whose own window
has closed, never abort the hour over it.

## `--live` mode

`deploy/post-demo-signals.sh testnet --live` runs ONE pass of ongoing
posting, meant to be invoked on a fixed interval (every 5 minutes),
never as a long-running process itself. Each pass posts every closed,
not-yet-posted sub-epoch of the current hour and the previous hour (so
a single missed tick still gets caught up on the next one), reading
the asset's real `sub_epoch_secs` from `RiskOracle.sub_epoch_config`.
It never falls back to the hourly path — hours build on their own once
every one of their sub-epochs settles (technical-doc.md Section 5.9
S4) — and treats a sub-epoch that is already posted as a normal,
expected skip, not a failure, since most 5-minute ticks between a
sub-epoch's own close times will hit exactly that.

**One retry on a transient failure, then deferred, not fatal.** A
timeout, a dropped connection (`client error`, `error reading a body
from connection`), or a sequence-number clash (`txBadSeq` - expected
when the Railway cron poster and a local stopgap loop briefly race
the same keeper account, see "Shared keeper account" below) gets
exactly one immediate retry. If that retry also fails, the sub-epoch
is counted as `deferred` in the pass's own summary line and the run
moves on to the next sub-epoch, rather than exiting non-zero over it -
a single flaky sub-epoch should never block every other one already
queued up behind it in the same pass, and `--live` re-checks a
deferred sub-epoch again on its own next scheduled tick regardless,
same as any other not-yet-posted one. A real rejection (anything that
is not one of those transient patterns, and not `Error #103`/`#115`
already-posted) is never retried and still exits the run immediately,
same as before this existed - this is deliberately narrow, not a
general "ignore errors" switch.

Do not run `--live` at the same time as a backfill (`post-demo-
signals.sh testnet <epochs>`) or `smoke-testnet.sh`'s own write check
against the same asset: both can post against the same hour `--live`
is also targeting, and either order of two concurrent posts to the
same sub-epoch is a race, not a correctness issue by itself (the
contract's own `EpochAlreadyPosted`/`HourAlreadyPosted` guards make
the loser a harmless, logged skip either way), but it makes a single
run's own log confusing to read. Finish a backfill and smoke test
fully before starting `--live`, same as the deploy order above.

`--live` only ever targets the one tracked asset in `deployments/
testnet.json`. DEMOUSD (`deploy/demo-asset.sh`, `deploy/demo-asset-
trigger.sh`) is deliberately NOT in the loop: its own `IssuerFreeze`
check has no history minimum (see `deploy/demo-asset-trigger.sh`'s own
header comment), so nothing needs its hours to keep advancing once the
triggering signal is posted. This means DEMOUSD reads as stale once
its last posted hour ages out (`stale_after_epochs`, Section 5.5) —
expected, and harmless for a one-shot IssuerFreeze demo. A cure demo
would be different: Depeg's own cure path (`checkpoint_cure`,
`finalize`'s `cure_outcome`) reads the asset's ring going forward
through the challenge window, so that would need DEMOUSD (or whichever
asset demos it) added to `--live`, extended to target more than one
asset at a time, which it does not do today.

## DEMOUSD's 1 hour challenge window

`deploy/demo-asset.sh` registers DEMOUSD's `IssuerFreeze` definition
with `challenge_secs = 3600` (1 hour, `CHALLENGE_SECS_MIN_EPOCHS`, the
shortest allowed), not the 24 hour window USDC's own `Depeg`
definition uses. This is deliberate and DEMOUSD-only, so `finalize`
becomes reachable within an hour of `propose_tier1` rather than a full
day; it exists purely so a demo can be walked through quickly, not
because it reflects a real challenge period. `checkpoint_cure` is not
relevant here regardless of `challenge_secs`: it explicitly rejects
any non-`Depeg` event (`WrongState`), so `finalize` is the only call
that moves an `IssuerFreeze` event forward. Never change USDC's own
definitions to match this short window.

## DEMOUSD: real fields vs. sample fields, and running it once

`deploy/demo-asset-trigger.sh` is a ONE-TIME script: it creates a
holder, mints it DEMOUSD, and claws part of it back for real. Running
it again does not "redo" the demo cleanly — minting a second time
would corrupt the holder's own real balance relative to what the
script's own math assumes (this happened once, see below), so the
mint step only mints if the holder's real on-chain balance is still
zero. Resetting the demo means a fresh holder identity and a fresh
DEMOUSD asset (`deploy/demo-asset.sh` again, under a different
issuer), not re-running this script.

Which posted fields are REAL (read from the chain at posting time,
never invented) and which are SAMPLE (plausible placeholders, since
DEMOUSD has no real market):

| Field | Real or sample |
|---|---|
| `supply` | Real. Read from Horizon's asset-stats endpoint (`authorized + authorized_to_maintain_liabilities + unauthorized`) immediately before each post. |
| `issuer_actions.clawback_amount` | Real. Read back from the clawback transaction's own Horizon effects (`account_debited`), never the amount requested. |
| `issuer_actions.auth_revocations` | Real: exactly one real `set-trustline-flags --clear-authorize` happened. |
| `revoke_tx_hash`, `clawback_tx_hash` (folded into the posted inputs) | Real, stellar.expert-linkable transaction hashes. |
| `peg_ratio`, `peg_ratio_p10`, `liquidity_2pct` | Sample. DEMOUSD has no real peg or liquidity to observe; same convention as `post-demo-signals.sh`'s own USDC backfill. |

Review finding (this session): an earlier version of this script
posted an invented `supply` of 1,000,000 units, unrelated to what was
actually minted (100) and clawed back (50). `check_issuer_freeze`
computes `clawback_amount * 10000 / supply` in INTEGER arithmetic; the
real 50-of-100 (50%) became a fictional 50-of-1,000,000 (truncating to
0 bps), so `propose_tier1` failed. The script now also refuses to post
the triggering signal at all if the real numbers, checked against the
registered definition's own `freeze_pct_bps` with the same integer
arithmetic `check_issuer_freeze` uses, would not actually clear the
threshold — so this specific mistake cannot happen silently again.

## `sylox-live-poster`: the Railway cron service

`--live` posting (Section above) moves off whichever machine runs it
manually and onto its own Railway cron service once this is reviewed
and deployed. This section is what someone sets up by hand in the
Railway dashboard; none of it is config-as-code, matching
`sylox-app`'s own reasoning in `web/app/README.md`'s "Deployment"
section (Railway's config-as-code / watch-path evaluation has a
confirmed bug on this account).

**Creating the service** (run `railway status` first, to confirm
which project/environment the CLI is linked to before creating
anything):

1. `railway add --service sylox-live-poster --image debian:bookworm-slim`
   (or create it from the dashboard) in the same project as
   `sylox-app`. The image set here is a placeholder; the real one is
   built and pushed by the `deploy-live-poster` CI job below, the
   same pattern `sylox-app` already uses.
2. **`RAILWAY_DOCKERFILE_PATH=deploy/Dockerfile.live-poster`**, as a
   service variable. Railway only looks for a file literally named
   `Dockerfile` at the repo root unless a service sets this variable
   (https://docs.railway.com/builds/dockerfiles); without it,
   `railway up` from the repo root falls back to auto-detection and
   the root `railway.json`, which builds `web/landing`, not this
   service. (`sylox-app` reaches its own, differently-named-and-
   located Dockerfile through a dashboard-level Build setting instead
   of this variable - see `web/app/README.md`'s own "Deployment"
   section for exactly what is and isn't set there. Either mechanism
   works; this service uses the variable because it's the one
   documented directly in Railway's own Dockerfile build docs.)
3. **Cron Schedule** (Settings → the service's own cron field):
   `1-56/5 * * * *`, UTC. One minute after each 5-minute boundary, so
   whichever sub-epoch just closed has actually closed by the time
   the run starts, not racing its own close.
4. **Restart Policy:** `Never`. Each invocation is one `--live` pass
   that runs to completion and exits 0 (or a real, non-#103/#115
   error); this is a cron job, not a daemon that should be restarted
   if it exits.
5. **Watch paths:** leave empty, same fix as `sylox-app`, for the
   same reason (see `web/app/README.md`). Turn this service's own
   Railway auto-deploy OFF once `deploy-live-poster` has deployed it
   successfully at least once, same as `sylox-app`.
6. **Variable:** `SYLOX_KEEPER_SECRET`, the `sylox-testnet-keeper`
   identity's own secret key. Set directly on the service in the
   Railway dashboard by whoever holds that key - never pasted into a
   PR, an issue, a commit, or asked for in chat. The entrypoint
   (`deploy/live-poster-entrypoint.sh`) reads it, imports it as the
   `sylox-testnet-keeper` identity, and refuses to run at all (exits
   non-zero with a clear message) if the imported identity's own
   address does not match `.identities.keeper` in `deployments/
   testnet.json` - a wrong secret fails loudly before it can post as
   the wrong identity, never silently.

   **Railway's cron service reuses the container filesystem between
   scheduled runs** - confirmed in production, not an assumption: the
   second of the first two scheduled runs failed with "An identity
   with the name 'sylox-testnet-keeper' already exists", because
   `~/.config/stellar` from the first run was still there on the
   second. This is NOT the same as a one-off local `docker run`,
   which always starts from a genuinely fresh filesystem. The
   entrypoint's own `stellar keys add ... --overwrite` is what makes
   re-importing the same identity on a reused filesystem succeed
   instead of failing - do not remove `--overwrite`, even though a
   fresh filesystem would never need it.

   **Never run a command that prints variable VALUES on this service**
   (plain `railway variables --service sylox-live-poster`, or `--kv`
   on its own, both print `SYLOX_KEEPER_SECRET`'s real value). This
   happened once, by accident, while checking something unrelated.
   To see which variables are set, without their values: `railway
   variables --service sylox-live-poster --kv | cut -d= -f1`, or use
   the Railway dashboard's own variable list instead of the CLI.

**Root `railway.json` risk:** that file configures the `web/landing`
service's own build/start commands. `sylox-live-poster`, like
`sylox-app`, is built from its own Dockerfile and deployed by
`railway up` from CI, which does not go through Railpack/Nixpacks
auto-detection at all - but confirm this directly after the first real
deploy anyway (`railway logs --service sylox-live-poster`): the logs
should show this entrypoint's own `==>` lines running, never
`web/landing`'s start command. If the landing service's own command
shows up instead, that is the same class of bug `sylox-app` already
hit once; stop and report it rather than working around it.

**Shared keeper account:** both the Railway cron service and any
local stopgap loop post as the same `sylox-testnet-keeper` identity.
Running both at once is expected to occasionally produce a sequence-
number clash on whichever one loses a race for the same sub-epoch -
harmless (the loser's own post just fails and that sub-epoch gets
caught up on its next tick), but keep any overlap short: confirm the
Railway cron service is actually posting successfully before stopping
a local stopgap loop, not the other way around.

**"Done" for the initial rollout:** two consecutive scheduled runs
each logging their own `live: posted N ... skipped M ... deferred K`
summary line with no errors other than the expected `Error #103`/
`#115` (already-posted) skips (confirmed in production, including
through the `--overwrite` fix for the filesystem-reuse bug above),
followed by one `live(asset)` read showing a sub-epoch from within
the last 10 minutes. Met. Ongoing operation just needs an occasional
spot check (a `live(asset)` read, or a glance at `railway logs`) that
the service hasn't gone quiet, not this same close scrutiny every
time.

## `deploy/extend-ttl.sh`: a TTL stopgap for issue #28

**This is a stopgap, not the real fix.** None of RiskOracle,
EventRegistry, Treasury or Staking ever call `extend_ttl` on their own
current-state storage, so every persistent/instance entry they write
quietly ages toward expiry with nothing refreshing it. Measuring every
tracked entry's `liveUntilLedgerSeq` (issue #28) showed the earliest
expiring about 6 days out, too soon to wait for the real fix (extend
TTL on write, per #28's own policy) to ship through `upgrade()`
(#12). **Remove this script and its call site in
`deploy/post-demo-signals.sh` once `upgrade()` ships that fix** - this
script's whole job disappears the moment the contracts extend their
own TTL on write.

`deploy/extend-ttl.sh testnet` runs at the end of every
`post-demo-signals.sh testnet --live` pass (every 5 minutes), after
posting. One `getLedgerEntries` call reads every tracked entry's
current TTL; only entries with less than 14 days left are extended, to
about 30 days, via `stellar contract extend`. Most runs extend
nothing - TTL only needs refreshing roughly every couple of weeks per
entry, not every 5 minutes.

**Entry scope: current-state keys only.** Current-state keys (one
entry per asset/id, never growing) are tracked; per-epoch, per-hour or
per-dispute history keys (`Signals`, `Overturned`, `Dispute`,
`SubSignals`, `SubOverturned`, `SubDispute`, `SubRepostUsed`,
`HeldHour`, `HourPostedVia`, `CommitteeMisses`, `Accrued`) are not -
enumerating every epoch or hour ever posted would make this script's
own cost grow forever, instead of staying flat. A history key ages out
on its own and is individually restorable later if something rare (a
dispute, an audit) ever needs it again; that is an acceptable cost
here, not a live-read outage. The margin backing that call is thin: a
fresh history entry starts with about 7 days of TTL, and the longest a
live call needs one is the 2h dispute window plus the 6 day ruling
window (`SIGNAL_DISPUTE_RULING_SECS` = 518,400s) - about 22 hours of
slack. This script does not widen that margin; only the real fix
(extend on write, through `upgrade()`) can make it unnecessary.

**Token balances: every one of our own contracts x every token, never
a classic account's.** A SAC's `Balance(Address)` key is a real
Soroban `ContractData` entry, with its own TTL, only when the holder
is itself a contract; for a plain classic account (the keeper, the
DEMOUSD holder), the SAC's `balance()` reads the classic trustline
balance straight off the classic ledger instead - confirmed
empirically while reviewing this script (`getLedgerEntries` and even
`stellar contract restore` both report no such entry for the keeper's
own TUSD or the DEMOUSD holder, while Horizon's own account balance
shows the real, current, non-zero amount: nothing archived, nothing
lost, just never a Soroban entry in the first place). This is exactly
why Staking's own TUSD balance matters and the keeper's own TUSD
balance doesn't: `stake()`'s own `usdc.transfer` moves the keeper's
bond out of the keeper's classic account and into Staking's contract
address, which is where it actually needs a TTL extended. The cross
product (`CONTRACT_NAMES` from `testnet.json`'s own `.contracts`
object x `TUSD`/`USDC`/`DEMOUSD`) is built the same way the contract
instance/code tracking is, so a contract added later (protection
markets) is covered automatically, not a hardcoded pairing. Most
combinations don't exist (RiskOracle holds no tokens today) and are
skipped quietly, the same as `Score(USDC)`.

**Manual extra keys**, off by default: `SYLOX_EXTRA_TTL_KEYS`, a
space-separated list of `contract_id:key_json:durability` triples,
extends those alongside the standard set. For when a specific
historical entry (e.g. a disputed `Signals(asset, epoch)` while its
dispute is open) needs to survive past its own natural expiry, without
widening this script's own standard scope. See the script's own header
comment for the exact format.

**Failure handling:** a TTL failure never blocks or masks posting.
`post-demo-signals.sh` captures posting's own exit code first, then
always runs `extend-ttl.sh` after, then combines the two: a failed TTL
step still lets a successful posting pass stand, logs the TTL failure
clearly, and the combined script exits 1 so Railway shows it as a
crashed run (worth investigating, but never at the cost of a posting
pass that already succeeded).

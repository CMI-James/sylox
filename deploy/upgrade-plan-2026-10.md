# Testnet upgrade plan, October 2026

Docs-only. Nothing in this file has been run. Every command below is
written to be copy-pasted when the go-ahead comes, not executed while
writing this.

## The real starting point: the live contracts cannot be upgraded yet

This has to come first, because it changes what "upgrade RiskOracle,
EventRegistry, Staking and Treasury in place" actually means today.

`deploy/README.md`'s own "Upgrading a contract (issue #12)" section
states it directly: the contracts currently deployed to testnet
(`deployments/testnet.json`) **do not have `upgrade()` at all**.
`upgrade()`, `version()`, and `migrate()` were added to the four core
contracts' source in a later change than the one that's actually
live. Calling `stellar contract invoke ... -- upgrade` against the
real, currently-deployed `RiskOracle`/`EventRegistry`/`Staking`/
`Treasury` addresses in `deployments/testnet.json` will fail: that
function does not exist in the WASM those addresses are running.

So "upgrade in place, keeping their addresses and history" is not
available as a first move. The only path to an `upgrade()`-capable
testnet is the one-time fresh redeploy the README already describes
(new addresses, via the constructor flow), after which real
`upgrade()`/`migrate()` calls become possible for every fix after
that. This plan is written in two parts to make that honest:

- **Part A** is the one-time fresh redeploy that makes `upgrade()`
  exist at all on testnet, run once.
- **Part B** is the real, repeatable `upgrade()`/`migrate()`
  procedure this plan was asked to produce, usable on every future
  fix once Part A has happened.

Nothing below runs without an explicit go-ahead. Part A in
particular is destructive to the current deployment's own history
(spelled out under "What is lost," below) and is not something this
plan recommends doing lightly just to unblock this task.

## Part A: the one-time fresh redeploy (makes `upgrade()` exist)

This is `deploy/README.md`'s own "The live contracts cannot be
upgraded yet" sequence, restated here with the exact command and
verification for each step.

1. **Fresh deploy of the four core contracts.**
   ```
   deploy/deploy.sh testnet
   ```
   Signs with `sylox-testnet-deployer` (and funds/creates
   `sylox-testnet-admin`, `sylox-testnet-issuer`,
   `sylox-testnet-keeper` if they don't already exist). Before
   running: bump `CONSTRUCTOR_NONCE` in `deploy/deploy.sh` from its
   current value, `"sylox-v1"` (read from
   `deployments/testnet.json`'s own `constructor_nonce` field), to
   something new - the script refuses to run if any precomputed
   address under the old nonce already has a contract, which the
   current nonce always triggers.

   **Check it worked:** the script itself fails loudly on any
   deployment error (it's not silent on failure). After it finishes,
   confirm each of the four addresses in the fresh
   `deployments/testnet.json` responds to `version()`:
   ```
   stellar contract invoke --id <risk_oracle.id> --source-account sylox-testnet-admin \
     --network testnet --send=no -- version
   ```
   repeated for `event_registry`, `staking`, `treasury`. Each must
   return `1` (RiskOracle/Staking/Treasury) or `2` (EventRegistry) -
   confirms the fresh deploy is running code that actually has
   `upgrade()`/`version()`/`migrate()` (the old deployed code has no
   `version()` to call at all, so this check also doubles as proof
   the new addresses are live, not the old ones).

2. **71 hour USDC backfill.**
   ```
   deploy/post-demo-signals.sh testnet 71
   ```
   Signs with `sylox-testnet-keeper`. Must run before
   `deploy/smoke-testnet.sh` (see that file's own "Why the order
   matters" section - the smoke test's own checks assume real
   backfilled history exists).

   **Check it worked:**
   ```
   stellar contract invoke --id <risk_oracle.id> --source-account sylox-testnet-admin \
     --network testnet --send=no -- first_epoch --asset <usdc_contract_id>
   ```
   should read back the oldest backfilled hour; `newest_epoch` should
   read back the most recent closed hour the backfill posted.

3. **DEMOUSD, from scratch.**
   ```
   deploy/demo-asset.sh testnet
   deploy/demo-asset-trigger.sh testnet
   # wait for the triggering signal's own dispute window to pass
   deploy/demo-asset-propose.sh testnet
   ```
   `demo-asset-trigger.sh` is explicitly not meant to be re-run
   against an existing holder (see its own header) - this produces a
   fresh holder, a fresh mint, a fresh real revocation/clawback.
   `demo-asset-trigger.sh` itself prints the real time its own
   triggering signal becomes effectively Final; wait until then
   before the `propose` step, same as the original run this session
   already did once.

   **Check it worked:** read `EventRegistry.event(0)` after `propose`
   and after `finalize` (the same `demo-asset-propose.sh` output
   already reports this); confirm `RiskOracle.band(<demo_id>)` reads
   `"Event"`.

4. **TTL entries, once, by hand.**
   ```
   deploy/extend-ttl.sh testnet
   ```
   Signs with `sylox-testnet-keeper`. Run once, right after steps 2
   and 3, since every tracked entry on a brand-new deploy starts with
   a short TTL (the original issue #28 measurement found this).

   **Check it worked:** the script's own `ttl: checked N, extended M
   [...]` log line; confirm `M > 0` the first time it runs on fresh
   state (nothing should read as already long-lived yet).

5. **The live poster's baked-in deployment record.**
   Push the fresh `deployments/testnet.json` to the branch that
   `deploy/Dockerfile.live-poster`'s own `COPY` reads from, open a
   PR, get it merged. The Railway cron service bakes this file in at
   build time, so a new CI run has to actually ship before
   `sylox-live-poster`'s next scheduled tick posts against the new
   addresses.

   **Check it worked:** `railway logs --deployment` after the next
   scheduled run; confirm the log's own contract IDs match the fresh
   `deployments/testnet.json`, not the old addresses.

6. **Web app bindings.**
   ```
   node web/app/scripts/generate-bindings.mjs
   ```
   against the new contract IDs; commit; redeploy `sylox-app`.

**Before any of the above runs:** record the current (soon to be
orphaned) event 0's details somewhere durable - event id, the
`propose_tier1`/`finalize` transaction links, the revocation and
clawback transaction links. `docs/demousd-issuer-freeze-2026-10-11.md`
already has every one of these from the real run this session
produced; confirm that file is complete and merged before Part A
runs, since this is the last point at which the current `EventRegistry`
address is still the live one.

**What is lost, with no way to carry it forward (quoting
`deploy/README.md` directly, since this is the real, already-written
answer, not something new):**

- `EventRegistry` event 0 and its finalize history - the real DEMOUSD
  IssuerFreeze event. `NextEventId` starts back at 0 on the fresh
  contract; the old event's id, ruling/cure history, and the real
  transaction trail are no longer reachable through `event(id)` on
  the new address (still findable on stellar.expert against the OLD
  address, for as long as that address and its own history stay
  queryable).
- DEMOUSD's current state - the holder's remaining balance, the
  issuer's clawback/revocation history, all tied to the OLD
  `EventRegistry`/`RiskOracle` addresses DEMOUSD was registered
  against. Step 3 above is a full reset, not a migration.
- USDC's scoring progress - `FirstEpoch`, the ring buffer's
  accumulated history, `NewestFinal`, all reset to nothing on the new
  `RiskOracle` address. The 7 day score baseline starts counting from
  zero again from whenever the fresh backfill (step 2) finishes.

**Read-only finding from this session's own Oct 16 check, relevant
here:** USDC's score has not appeared on the CURRENT live deployment
either, for a separate, already-diagnosed reason - see "The live
poster has a real gap" below. That gap would also affect USDC's
scoring on the fresh deployment unless fixed first, so fixing it (or
at minimum calling `build_hour` by hand on a schedule) belongs in the
same conversation as this redeploy, not treated as unrelated.

## Part B: the real `upgrade()`/`migrate()` procedure (once Part A has happened)

This is the procedure this plan was actually asked to produce,
usable for every upgrade after Part A, including the TTL-policy fix
(#89), the sub-epoch fix (#93/#95), and the buy_cover fix (#91) all
landing on the FRESH contracts for the first time (since the fresh
deploy in Part A would be built from current `main`, these three are
already baked into the WASM Part A deploys - this Part B procedure
would only be exercised for the NEXT fix after that, or if Part A and
these fixes are deliberately kept separate so this procedure gets a
real, low-stakes first run).

### Steps, per contract (RiskOracle, EventRegistry, Staking, Treasury)

1. **Build and upload the new WASM.**
   ```
   stellar contract upload --wasm target/wasm32v1-none/release/<contract>.wasm \
     --source-account sylox-testnet-deployer --network testnet
   ```
   Signs with whichever identity is paying the upload fee (no auth
   requirement on upload itself - any funded identity works;
   `sylox-testnet-deployer` for consistency with the original
   deploy). Prints the new WASM hash. Record it.

2. **Call `upgrade`, authorized by the contract's own governor.**
   ```
   stellar contract invoke --id <contract id> --source-account sylox-testnet-admin \
     --network testnet -- upgrade --new_wasm_hash <hash from step 1>
   ```
   Signs with `sylox-testnet-admin` (stands in for `Governor` per
   lead decision D1 in `deploy/deploy.sh` - `Governor` itself is
   implemented and tested but not deployed, so there's no 14-day
   timelock on testnet today; this is a direct, immediately-effective
   call, same as every other governor-gated call in this codebase).

   **Check it worked:**
   ```
   stellar contract invoke --id <contract id> --source-account sylox-testnet-admin \
     --network testnet --send=no -- version
   ```
   reads the new code's `CONTRACT_VERSION` (bumped by hand in the
   new code alongside the `upgrade()` that ships it - confirm the
   PR that shipped this fix actually bumped it, since the shared
   `do_upgrade` has no way to enforce that itself).

3. **Call `migrate`, same signer.**
   ```
   stellar contract invoke --id <contract id> --source-account sylox-testnet-admin \
     --network testnet -- migrate
   ```
   For the three fixes in question (#89, #91, #93/#95), `migrate()`'s
   body is empty on all four contracts - no stored type's shape
   changed. This call still has to run (it's what advances the
   `MIGRATE` marker so a later, real migration doesn't think this
   version was skipped), it just does no storage work today. Safe to
   call in the same invocation as `upgrade()` immediately before it:
   confirmed by `contracts/governor/src/d13_test.rs`'s own
   `upgrade_then_migrate_in_one_invocation_runs_the_new_code` test -
   the wasm swap from `upgrade()` takes effect for `migrate()` within
   the same transaction, not just the next one, so this doesn't need
   two separate transactions with a wait between them.

   **Check it worked:** the call returns `Ok(())` (not
   `Err(AlreadyMigrated)`); re-running `migrate()` a second time
   afterward must then return `AlreadyMigrated` - confirms the
   version marker actually advanced, not just that the call didn't
   error for some other reason.

4. **Update `deployments/testnet.json`.**
   Add the new `wasm_hash` for that contract, keeping the old one in
   a `history` list (the on-chain `Upgraded` event only carries
   `old_version`, a small integer, never a wasm hash - there's no SDK
   call that reads a contract's current wasm hash from its own
   execution, so the deployment record is the only durable trail of
   which wasm hash was live when).

Repeat for all four contracts. No ordering dependency between them
for this specific set of fixes (none of #89/#91/#93/#95 changes a
cross-contract call signature between these four - `buy_cover`'s new
signature is on `Series`, not one of these four, and `Series` is not
in this upgrade's scope).

### Then: deploy MarketFactory and call `set_factory`

`MarketFactory` has never been deployed to testnet. Its constructor
needs the FRESH `oracle`/`registry`/`treasury` addresses (and `usdc`,
unchanged across Part A) as arguments, so it can only be deployed
after Part A (or after this contract's own fresh addresses exist,
whichever redeploy they come from):

```
stellar contract deploy --wasm target/wasm32v1-none/release/market_factory.wasm \
  --source-account sylox-testnet-deployer --network testnet -- \
  --governor <admin addr> --oracle <risk_oracle id> --registry <event_registry id> \
  --treasury <treasury id> --usdc <usdc contract id> --series_wasm <series wasm hash>
```
Signs with `sylox-testnet-deployer`. `series_wasm` needs `series.wasm`
uploaded first (`stellar contract upload`, same pattern as step 1
above) so its hash can be passed to the constructor.

**Check it worked:**
```
stellar contract invoke --id <market_factory id> --source-account sylox-testnet-admin \
  --network testnet --send=no -- version
```
reads `1`.

Then, on `EventRegistry` (one time only - the setter locks once
`config.factory` no longer holds the placeholder):
```
stellar contract invoke --id <event_registry id> --source-account sylox-testnet-admin \
  --network testnet -- set_factory --factory <market_factory id>
```
Signs with `sylox-testnet-admin` (governor-gated). This setter does
not exist on the EventRegistry code deployed by Part A alone - it
ships with the SAME EventRegistry upgrade that wires the real
`version_has_live_cover` cross-contract calls (per
`deploy/README.md`'s own note: "No governor-only `set_factory` setter
was added in the #12/#21 redeploy... landing together with the code
that actually reads it"). So this step depends on that specific
EventRegistry code existing, not just any EventRegistry upgrade -
confirm the WASM being uploaded in step 1 of the EventRegistry
upgrade above is the one that actually adds `set_factory` and reads
`config.factory`, not an earlier one.

**Check it worked:** calling `set_factory` a second time afterward
must fail (the setter is a one-time lock); no public getter for
`config.factory` exists to read it back directly today, so the
practical check is behavioral - trigger whatever code path reads
`version_has_live_cover` and confirm it resolves against the real
factory instead of the stubbed `false`.

## Before any of this runs: how we confirm it's safe

### 1. The new code reads the existing stored data - a real snapshot test, not reasoning

Demonstrated and verified while writing this plan, not just proposed:
`stellar snapshot create --address <contract id> --network testnet
--out <file>.json` pulls real ledger entries for a live contract off
testnet (confirmed against the real, live RiskOracle address - 1,565
entries, about 6.6 MB, 3m20s). `soroban-sdk`'s own test `Env`
(version 29.0.0, already the workspace's pinned version) loads that
exact file directly: `Env::from_snapshot_file(path)` reads a
`soroban_ledger_snapshot::Snapshot` and loads its ledger state into a
real test `Env` - confirmed from the SDK's own source
(`src/env.rs`), not assumed.

New test, one per contract, added BEFORE Part B runs for real:

```rust
#[test]
fn upgrade_reads_real_testnet_snapshot() {
    // Snapshot pulled ahead of time via:
    //   stellar snapshot create --address <live contract id> \
    //     --network testnet --out tests/fixtures/risk-oracle-live.json
    // Committed to the repo as a fixture, not regenerated per test run
    // (a live network's own state keeps moving; the point is to prove
    // THIS specific, captured shape still decodes, not to re-fetch
    // live state on every CI run).
    let env = Env::from_snapshot_file("tests/fixtures/risk-oracle-live.json");
    let client = RiskOracleClient::new(&env, &live_contract_address);

    // Read whatever real data the snapshot captured, through the
    // SAME public interface the live contract exposes today, BEFORE
    // upgrading:
    let score_before = client.score(&usdc_address);
    let asset_config_before = client.asset_config(&usdc_address);
    let newest_epoch_before = client.newest_epoch(&usdc_address);

    // Now upgrade, inside this snapshot-loaded Env, to the NEW code:
    let new_wasm_hash = env.upload(RiskOracle); // the code under test, not the live one
    client.upgrade(&new_wasm_hash);
    client.migrate();

    // Confirm the SAME real data still reads the SAME, through the
    // same calls, after the swap:
    assert_eq!(client.score(&usdc_address), score_before);
    assert_eq!(client.asset_config(&usdc_address), asset_config_before);
    assert_eq!(client.newest_epoch(&usdc_address), newest_epoch_before);
}
```

This is a real step up from the existing
`upgrade_keeps_existing_storage` tests already in each contract's
`test.rs`: those write synthetic data INSIDE the test with the
already-new code, then upgrade to the same code again - they never
touch a byte of real, currently-live storage, and would not catch a
mismatch between what the live contract ACTUALLY has stored (field
ordering, an enum variant added since the live contract was last
deployed, anything else that only shows up in real accumulated state)
and what the new code's types expect to read. The snapshot-loaded
test above does.

Run this for all four contracts before Part B executes for real, with
a snapshot of EACH live contract (not just RiskOracle). If any of the
four fails to decode, STOP - that's a real storage-compatibility
problem Part B must not run into live.

### 2. Hours posted before the upgrade still resolve to the right length

Real gap in test coverage, confirmed while writing this plan: no
existing test exercises `current_sub_epoch_secs`'s fallback path by
name (grepped every test file under
`contracts/risk-oracle/src/test*.rs` and `test/*.rs` for
`current_sub_epoch_secs`/`config_sub_epoch_secs`/
`HourSubEpochSecs` - only `sub_epoch_config_and_sub_epoch_secs_at_agree`
exists, which checks the two READS agree with each other, not that a
genuinely pre-existing hour with no `HourSubEpochSecs` record resolves
correctly through the config fallback).

New test to add before Part B:

```rust
#[test]
fn pre_upgrade_hour_with_no_record_resolves_via_config() {
    // Simulates an hour that was posted to BEFORE #95's
    // HourSubEpochSecs write existed at all (any hour from before
    // that PR's own deploy) - no HourSubEpochSecs(asset, hour) entry,
    // by construction, since this test never calls anything that
    // would write one for this specific hour.
    let env = Env::default();
    let fixture = setup(&env);
    let asset = Address::generate(&env);
    fixture.client.add_asset(&asset_config(&env, &asset, &issuer));

    // Set the sub-epoch length via config (the pre-#95 mechanism),
    // then advance past the 240-hour spacing lock so a second config
    // change is even possible, confirming this isn't accidentally
    // reading the FIRST config value by coincidence:
    fixture.client.set_sub_epoch_secs(&asset, &900);
    env.ledger().set_timestamp(env.ledger().timestamp() + 240 * 3600 + 1);
    fixture.client.set_sub_epoch_secs(&asset, &300);

    // The hour in question never had ANY sub-epoch posted to it -
    // confirm directly that no HourSubEpochSecs record exists for it
    // (this is the test's own precondition, not an assumption):
    assert!(storage::get_hour_sub_epoch_secs(&env, &asset, some_old_hour).is_none());

    // sub_epoch_secs_at must resolve through config_sub_epoch_secs's
    // own pending/current resolution for THAT hour's own real
    // timestamp, not whatever the CURRENT config says:
    let resolved = fixture.client.sub_epoch_secs_at(&asset, &some_old_hour);
    assert_eq!(resolved, /* whatever length was actually in force at
                            some_old_hour's own timestamp, computed
                            independently in the test, not copied from
                            the production code under test */);
}
```

The real mechanism this test proves (already read directly from
`contracts/risk-oracle/src/lib.rs`'s own `current_sub_epoch_secs`,
not assumed): `HourSubEpochSecs(asset, hour).unwrap_or_else(||
config_sub_epoch_secs(...))` - any hour with no record falls back to
the same config-based resolver #93 already built and tested, which
stays exact for any hour inside the 240-hour spacing window
`set_sub_epoch_secs` enforces between changes. Every hour on testnet
today predates #95's first-post write entirely (that code is not yet
live), so EVERY currently-posted hour depends on this fallback path
working correctly the first time Part B's upgrade goes live.

### 3. The live poster keeps working before, during and after the upgrade

**Real finding, surfaced by writing this plan, not something assumed
safe:** `post_signals` and `post_sub_signals` on the CURRENT, live
RiskOracle do not have `upgrade()`-era code at all (see "The live
contracts cannot be upgraded yet," above) - so "before" is just "the
current state," already running and already fine. The real risk is
"during" and "after":

- **During Part A** (the fresh redeploy): the live poster's own
  baked-in `deployments/testnet.json` still points at the OLD
  addresses until step 5's CI run ships. Every scheduled tick in that
  window keeps posting to the OLD, abandoned contracts - harmless
  (nobody reads that history going forward) but NOT free: it still
  spends the keeper's real testnet balance and real transaction fees
  posting to addresses about to be orphaned. Minimize this window:
  steps 1 through 4 should run back-to-back, with step 5's PR opened
  immediately after step 4 finishes, not left pending.
- **After Part A / during Part B** (an `upgrade()` on the fresh
  contracts): `post_sub_signals`'s own interface (arguments, return
  type, error codes) is unchanged by #89/#93/#95 - confirmed by
  reading each PR's diff: #89 only adds TTL-extension calls inside
  existing functions, #93 adds a new READ (`sub_epoch_secs_at`)
  without touching `post_sub_signals`'s own signature, #95 adds an
  internal write (`HourSubEpochSecs`) inside the existing function
  body. The live poster's own script,
  `deploy/post-demo-signals.sh`, calls `post_sub_signals` with the
  same arguments before and after. No code change is needed in the
  poster for these three fixes to keep working.

  **The check:** watch the live poster's own log
  (`railway logs --deployment`) across the `upgrade()` + `migrate()`
  call for each contract. Confirm the next scheduled tick AFTER each
  contract's own upgrade still posts successfully (`live: posted N
  sub-epoch(s)...`, no new error). Do this per contract, not just
  once at the end - if RiskOracle's own upgrade breaks something, we
  want to know before EventRegistry's upgrade runs too.

- **A real, separate gap found while writing this plan, not
  introduced by this upgrade:** USDC's hourly `Signals` slot has not
  advanced past epoch 497700 since the current deployment went live
  (confirmed via `is_final` reading `false` for every hour after
  497700, and `build_hour` simulating successfully but with
  `sub_count_final: 0` for hours old enough that the 5-hour sub-epoch
  ring has rotated past their raw data). Root cause: the live
  poster's own script never calls `build_hour`; it relies entirely on
  `post_sub_signals`'s own one-shot inline attempt, which almost
  always runs too early (most of an hour's own sub-epochs are still
  inside their 2-hour `SIGNAL_DISPUTE_SECS` pending window at the
  moment the 12th sub posts). This means USDC's score has never
  advanced past `stale: true, score: 0` on the current deployment,
  independent of anything in this upgrade. **Recommendation, not yet
  acted on:** fix this (either have the poster call `build_hour`
  explicitly on a short delay after an hour completes, or add a
  scheduled call to it) BEFORE or ALONGSIDE this upgrade, since Part
  A's fresh redeploy would otherwise carry this exact gap forward
  into the new deployment too, and USDC would again never produce a
  real score.

### 4. `extend-ttl.sh`'s cron only runs after the new code is live and verified

`extend-ttl.sh` (the Railway cron service, issue #28's own stopgap)
reads real, current contract addresses from whatever
`deployments/testnet.json` its own deployed image was built against -
same baked-in-at-build-time mechanism as the live poster (see Part A
step 5). Concretely:

- During Part A, `extend-ttl.sh`'s cron keeps extending TTLs on the
  OLD contracts until its own image is redeployed against the new
  `deployments/testnet.json` - same "harmless but wasted spend" risk
  as the live poster's own gap above, same fix (minimize the window
  between steps 1-4 and shipping step 5/6).
- For Part B (`upgrade()` on the fresh contracts): #89's own TTL
  policy (the subject of this upgrade) changes WHAT `extend-ttl.sh`
  needs to do, not just what the contracts do internally. Before
  #89's code is live via `upgrade()`, the external cron is still the
  ONLY thing keeping these four contracts' storage alive (the gap
  issue #28 opened against). After `upgrade()` + `migrate()` land,
  the contracts extend their own storage on every write - the
  external cron becomes a redundant safety net, not the sole
  mechanism, but it should NOT be turned off immediately: confirm
  the new code's own extension behavior for real first.

  **The check, explicit and sequenced, matching the literal ask -
  "only after the new code is live and verified":**
  1. Run Part B's `upgrade()` + `migrate()` on all four contracts.
  2. Let at least one real write happen on each contract through
     normal operation (the live poster's own next tick covers
     RiskOracle; `demo-asset-propose.sh`/a manual EventRegistry call
     covers EventRegistry; Staking/Treasury need a real
     reward/deposit cycle, or a manual state-changing call made
     specifically to exercise this).
  3. Read back that entry's own TTL (`stellar contract invoke ...
     --send=no` doesn't expose a raw TTL read today - the practical
     proxy is `extend-ttl.sh`'s OWN `ttl: checked N, extended M
     [...]` log line: if the new code is extending correctly, M
     should read 0 for entries the new code JUST wrote, since they
     already have a fresh TTL and the cron's own sweep has nothing
     left to do for them).
  4. Only once step 3 confirms the new code is actually extending
     (not just deployed), treat `extend-ttl.sh` as the safety net it
     was always meant to become, not the sole mechanism - this plan
     does NOT recommend disabling the cron; #89's own PR body never
     asked for that either, it's a belt-and-suspenders design, not a
     handoff.

## Rehearsal: a full run on a throwaway deployment first

Everything in Part A and Part B, run once against a completely
separate set of identities and contract addresses, before touching
the shared testnet setup, so a real mistake costs nothing shared.

**Setup**, copying `deploy/deploy.sh`'s own real identity-naming
convention but under different names so nothing collides with the
live identities already in this machine's own `stellar keys` store:

```
stellar keys generate sylox-rehearsal-deployer --network testnet --fund
stellar keys generate sylox-rehearsal-admin --network testnet --fund
stellar keys generate sylox-rehearsal-issuer --network testnet --fund
stellar keys generate sylox-rehearsal-keeper --network testnet --fund
```

Copy `deploy/deploy.sh` to a scratch copy (not committed), replace
every `sylox-testnet-*` identity name with the `sylox-rehearsal-*`
equivalent above, and give it its own `CONSTRUCTOR_NONCE` (e.g.
`"sylox-rehearsal-1"`) so its precomputed addresses never collide
with the real deploy's own. Run it, and the rest of Part A's steps
1-4, against this separate identity set, writing to a SEPARATE
`deployments/testnet-rehearsal.json` (never the real
`deployments/testnet.json`) so nothing in the real deploy record, the
live poster's baked-in file, or any committed file is touched.

Run Part B's full upgrade procedure against these rehearsal
addresses. Run the snapshot test (requirement 1, above) against a
REAL snapshot of this rehearsal deployment's own storage after it's
accumulated some real history - proving the snapshot/test mechanism
itself works end to end, not just that it's theoretically possible.

**What the rehearsal does NOT need:** its own `sylox-live-poster` or
`extend-ttl.sh` Railway services - running `post-demo-signals.sh`
and `extend-ttl.sh` by hand, locally, against the rehearsal addresses
covers requirements 3 and 4 above without standing up parallel cloud
infrastructure for a one-time rehearsal.

**Afterward:** leave the rehearsal contracts and identities in place
(cheap, isolated, no reason to tear down) or note them here as
retired if a later cleanup removes them. Either way, record the
rehearsal's own contract addresses and the real transaction hashes
from its own `upgrade()`/`migrate()` calls somewhere (this file, once
the rehearsal actually runs, or a dated follow-up doc) as the real
evidence the procedure was exercised before the shared deployment saw
it.

## After the upgrade

1. **Regenerate the SDK bindings.**
   ```
   npm run generate:networks -w packages/sdk
   ```
   (the same command this session already ran once, for the DEMOUSD
   holder change - same mechanism, different trigger: new wasm
   hashes, not a changed address, this time, but the generator reads
   `deployments/testnet.json` either way and the drift check in CI
   catches a missed regeneration the same way it did before).

   Confirm `web/docs`'s own contract-reference drift check (which
   reads `deployments/testnet.json` directly, not the SDK's generated
   file) doesn't ALSO need regenerating - per this session's own
   prior finding, it only needs attention when the reference reads
   something that actually changed (contract addresses did not change
   in Part B, since Part B upgrades in place; Part A's addresses DO
   change, so if Part A and B are run together, this needs re-running
   too: `npm run generate:contract-reference -w web/docs`).

2. **Update docs.sylox.xyz - the integration guide must mention
   `max_premium`.**
   Confirmed gap: `web/docs/content/docs/integration-guides.mdx`
   currently documents the CHECKS to run before calling `buy_cover`
   (staleness, band, cover gate) but never shows the actual call
   itself or its arguments - no mention of `max_premium` exists
   anywhere in `web/docs/content/docs/` today (grepped directly).
   Add a short example showing the real, current signature:
   ```ts
   const { filled, premium } = await series.buy_cover({
     buyer,
     amount,
     max_rate_bps,
     max_premium, // the buyer's own signed ceiling; the contract
                   // refunds buyer - premium automatically if the
                   // real premium lands below it
   });
   ```
   with a line explaining WHY `max_premium` exists (price can drift
   between signing and landing; this is what makes that safe to sign
   for, instead of failing on any drift at all - the real bug #91
   fixed, testnet tx
   c4df6eed096b19dba04d1f3798ce51de4cfa69ef0948128f1ffc8c1155194e0e,
   is good evidence to link if a "why" is wanted).

3. **Update `deployments/testnet.json`.**
   Already covered per-contract in Part B step 4 above; restated here
   as the explicit "after" checklist item since it's easy to do
   per-contract and forget as a final whole-file commit.

## Rollback: what we do if a step fails partway through

**Part A (fresh redeploy):**
- If `deploy/deploy.sh` itself fails partway (e.g. contract 3 of 4
  deploys, contract 4 fails): the script's own constructor-flow
  design (every address precomputed before any contract deploys)
  means a partial run leaves some addresses deployed and others not,
  under the SAME `constructor_nonce`. Do not try to resume with the
  same nonce - fix whatever failed, bump `CONSTRUCTOR_NONCE` again,
  and re-run the whole script. The old live contracts are completely
  untouched by a failed fresh-deploy attempt (different addresses
  entirely), so there is no live-service impact from a failed Part A
  attempt - the real poster and TTL cron keep running against the
  OLD, still-live addresses until Part A step 5 explicitly points
  them elsewhere.
- If the 71-hour backfill (step 2) fails partway: `post-demo-signals.sh`
  is written to skip already-posted epochs on a re-run (confirmed:
  it checks for `Error(Contract, #103)` EpochAlreadyPosted and treats
  it as "already done," not a failure) - simply re-run the same
  command; it resumes.
- If DEMOUSD setup (step 3) fails partway: `demo-asset-trigger.sh`
  already has the "one gate per step" resumability this session built
  into it (PR #76) - re-running it is safe and will read "already
  done" for whatever already landed. If the failure happened in
  `demo-asset-propose.sh` specifically (after a real `propose_tier1`
  already landed), do NOT re-run `propose_tier1` - read
  `EventRegistry.event(0)`'s own state first; if it's already
  `Proposed`, move directly to the `finalize` step once the challenge
  window has passed, exactly as this session already did once for
  real.
- If step 5 (shipping the new `deployments/testnet.json` to the live
  poster's image) is delayed or fails CI: the live poster keeps
  posting to the OLD addresses harmlessly (see "during Part A,"
  above) until it's fixed and merged - no data corruption risk, just
  wasted spend on an abandoned deployment in the meantime.

**Part B (`upgrade()`/`migrate()` on a contract that already has
these functions):**
- If `upgrade()` itself fails (wrong hash, governor auth fails, wasm
  upload didn't actually finish): nothing changed on-chain - Soroban
  transactions are atomic; a failed `upgrade()` call leaves the OLD
  code running, exactly as before the attempt. Re-check the uploaded
  hash and the signing identity, then retry the same `upgrade()`
  call - safe to retry as many times as needed, since nothing partial
  can be left behind by this specific call.
- If `upgrade()` succeeds but `migrate()` then fails (should not
  happen for THIS set of fixes, since `migrate()`'s body is empty and
  can only fail with `AlreadyMigrated`, which would mean the upgrade
  somehow ran twice): the contract is now running the NEW code
  without having run `migrate()`. For #89/#91/#93/#95 specifically,
  this is safe to leave as-is temporarily (no storage transformation
  was pending), but `migrate()` should still be called before the
  NEXT upgrade ships, since that next upgrade's own migration (if it
  has one) would otherwise run against a `MIGRATED_TO_KEY` that's one
  version behind where the code actually is.
- If the "new code reads real storage" snapshot test (requirement 1)
  fails for any contract BEFORE Part B runs for real on that
  contract: STOP. Do not upgrade that contract. This is exactly the
  failure mode the test exists to catch before it happens live - fix
  whatever storage-shape mismatch the test found, re-run the test
  against the same snapshot, and only proceed once it passes.
- If the live-poster or extend-ttl check (requirements 3/4) shows a
  real break AFTER an `upgrade()` has already landed on a contract:
  this contract's old wasm is gone (there is no `downgrade()` -
  `upgrade()` only ever takes a `new_wasm_hash` forward). The real
  recovery is a FORWARD fix: build a corrected wasm, upload it, call
  `upgrade()` again to the corrected hash. This is why requirement 1's
  snapshot test and the rehearsal both exist - to catch this class of
  problem before it ever reaches the live, shared contracts in the
  first place, since there is no clean rollback once `upgrade()` has
  actually landed.

## Storage cost (#89's own estimate, read and explained, not re-derived)

**The question: is the 0.040-0.048 XLM figure charged on every post,
or only when an entry is actually extended?**

Both, in a specific sense that's worth stating precisely rather than
picking one answer: `sylox_types::ttl::set_persistent` and
`set_history` call Soroban's own `extend_ttl(threshold, extend_to)`
primitive, which is unconditional to CALL on every write but only
actually CHARGES rent when the entry's current remaining TTL has
already dropped below that threshold (10 days for history entries,
300 days for other persistent entries) - above the threshold, the
call is a genuine no-op, no rent paid. So the 0.040-0.048 XLM figures
are NOT "every single post costs this much" - most individual calls,
most of the time, pay nothing extra for this specific mechanism.

What the figures actually are: #89's own PR body measured the
STEADY-STATE average - the real, recurring cost once you account for
how often that threshold-crossing actually happens across many posts
over time. Quoting the PR body directly:

> `post_signals` (steady state): ... **480,000 stroops (0.048 XLM)
> extra per post**.
> `post_sub_signals` (steady state): ... **396,000 stroops (0.040 XLM)
> extra per post**, or about 114,000,000 stroops (11.4 XLM) a day per
> asset at 288 posts.

**Per-asset daily cost on mainnet, taking the PR's own figure
directly: ≈11.4 XLM/day per asset**, from `post_sub_signals` alone
(288 calls/day = 24 hours x 12 five-minute sub-epochs/hour, the real
cadence the live poster already runs at on testnet today).
`post_signals`'s own hourly-fallback path, at 24 calls/day and 0.048
XLM/post, would add roughly 1.15 XLM/day on top of that IF an asset
were also using the hourly fallback path regularly - but the real,
live pattern (confirmed from this session's own testnet observation)
is sub-epoch posting for the actively-tracked asset, with the hourly
path reserved for backfill/gap-fill, so the sub-epoch figure is the
one that actually recurs daily in steady state.

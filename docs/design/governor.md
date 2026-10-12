# Governor design note

Status: Draft, for review before any contract code · Date: October 12, 2026

Source: technical-doc.md v1.5 Section 1.6, 12.6, 13, 14, 15, 16, 17, 21, 22.5, 23, 24.2; ADR-002, 004, 007, 010, 011, 012; issues #5, #12, #21, #22, #28; `docs/design/markets.md` (format, TTL constants, deviation 13 and 14); `deploy/README.md` ("Upgrading a contract"); `contracts/types/src/governance.rs`, `upgrade.rs`, `ttl.rs`.

Scope: the `Governor` contract (`contracts/governor`): constructor, the signer set and threshold, `queue` / `approve` / `execute` / `cancel`, per-action timelocks, dispatch of every `Action` variant to its target contract, `Upgrade` for the other core contracts and for the Governor itself, the committee address and its `committee()` read, guardian `pause` and governed `unpause`, the parameter store and `param()` read, `action()`, `version()`, TTL policy. Also described, but not done here: how the testnet admin key hands its role over to the Governor (Section 10).

Out of scope until the open questions below are answered: wiring pause checks into `RiskOracle`, `MarketFactory` and `Series` (Section 8, Q9 and Q10); a separate `Guardian` contract (Q3); `Staking`'s committee slash path for false probe evidence (Q19); anything on testnet.

Every point the spec leaves unclear or states two ways is listed in Section 14 and referenced inline as `Qn`. Where this note proposes a choice, it says so; nothing in Section 14 is decided by this note.

## 1. How the Governor reaches the other contracts

Every governor-gated function in the built contracts reads `governor` from its own `Config` and calls `config.governor.require_auth()` (or does so inside `sylox_types::upgrade::do_upgrade` / `do_migrate`). In Soroban a contract address authorizes a call it makes directly, so a target accepts a governor-gated call only when the `Governor` contract is the direct caller. That gives the whole design its shape:

- **The Governor is the only thing that can call a governor-gated function**, and it only does so from inside `execute`, after the action's approvals and timelock have been checked. The timelocks in Section 17.2 are therefore enforced by the Governor alone. The targets do not, and do not need to, know anything about timelocks.
- **Nothing in a target changes for this.** Every governor-gated function the dispatch table in Section 4.3 calls already exists with the auth check this relies on.
- **This holds only once each target's `governor` address is the Governor contract.** Until the handover in Section 10, the testnet admin key is that address and can call every one of those functions immediately, with no queue, approvals or timelock. Everything this note says about timelocks starts applying at handover, not at deploy.

The committee is different: committee-gated functions authorize the committee address directly, not the Governor (Section 7).

## 2. Constructor and roles

**Proposed** (Q1, Q2, Q3): a `__constructor`, not the `initialize` Section 12.6 shows. Every other contract moved to a constructor in #21 (43c43f6) and `docs/design/markets.md` deviation 13 for the reason that applies here unchanged: a separate `initialize` call leaves a window in which anyone can initialize a freshly deployed contract with their own signer set.

```rust
fn __constructor(
    env: Env,
    signers: Vec<Address>,   // distinct, non-empty
    threshold: u32,          // 1..=signers.len()
    committee: Address,
    guardian: Address,       // Q3: not in Section 12.6's signature
    targets: Targets,        // Q2: not in Section 12.6's signature
);

#[contracttype]
pub struct Targets {
    pub oracle: Address,
    pub registry: Address,
    pub staking: Address,
    pub treasury: Address,
    pub factory: Address,
}
```

`timelock_secs` from Section 12.6 is left out of this signature because Section 17.2 fixes a timelock per action type and nothing says what a single constructor-wide value would add (Q1).

The constructor validates its arguments (Section 3) and stores them, and calls no other contract, the same rule every other constructor in the repo follows. Its mutual references with the five targets are resolved the way `deploy/deploy.sh` already resolves them: every address is precomputed from a deterministic salt before anything is deployed.

### 2.1 Signers and threshold

| Rule | Detail |
| --- | --- |
| Set | `signers: Vec<Address>`, every entry distinct, at least one |
| Threshold | `1 <= threshold <= signers.len()`. Section 16's default is 4 of 7; the testnet values are Q26 |
| Rejections | Empty set, a duplicate signer, or a threshold outside that range: `InvalidSigners` (new, Section 11) |
| Change | Only through `Action::SetSigners(Vec<Address>, u32)`, 14 day timelock, same validation |
| Auth | Each signer authorizes its own call (`signer.require_auth()`); a signer can be an account or a multisig account, the Governor does not care |

What a signer change does to actions already queued, and to approvals given by a signer who is then removed, is not specified (Q15). **Proposed:** `execute` counts only approvals from addresses that are signers at execution time, and compares that count with the threshold at execution time, so a removed signer's earlier approval stops counting.

### 2.2 Committee and guardian

- **Committee:** one address (Section 16: a separate 4 of 7 multisig). Stored in `Config`, returned by `committee()`, changed only through `Action::SetCommittee(Address)`, 14 day timelock. Section 7 covers how it is used.
- **Guardian:** one address (Section 16: a 2 of 3 multisig of the core team) that can call `pause` and nothing else. Section 12.6 gives `pause` guardian auth but nothing in Sections 12.6, 15.1 or 17.1 says where the guardian address is stored or how it changes, and issue #5 talks about a separate `Guardian` contract (Q3). **Proposed:** a `guardian` field in `Config`, set by the constructor. No action exists to change it (Q3).

## 3. Storage layout and TTL policy

### 3.1 Keys

Section 15.1 names two Governor keys, `Params` (instance) and `Action(id)` (persistent). The rest are proposed.

| Key | Storage | Contents | Written by |
| --- | --- | --- | --- |
| `Config` | instance | `signers`, `threshold`, `committee`, `guardian`, `targets` | constructor; `SetSigners`, `SetCommittee` |
| `NextActionId` | instance | `u64` counter, starts at 0 | `queue` |
| `Params` | instance | `Map<Symbol, i128>`, the last value set per key (Section 9) | `SetParam` |
| `Paused(scope)` | instance | `u64`: the timestamp the pause lapses (`paused_at + max_pause_secs`); absent when not paused | `pause`, `Unpause` |
| `Action(id)` | persistent | `QueuedAction` (Section 17.1, `sylox_types::governance`) | `queue`, `approve`, `execute`, `cancel` |
| `MigrationVersion` | instance | `u32`, the `do_migrate` key for the Governor's own storage version | Governor's own migration (Section 6.3) |

`Paused(scope)` is in instance storage because there are only four scopes and the entry is tiny. Every target that checks a pause reads it on its own hot path, so it must never be archived (Section 3.2).

### 3.2 TTL: every entry extends its own TTL (issue #28)

The Governor is called rarely (Section 17.2 timelocks are days long), but other contracts read it on their own payout paths: `EventRegistry.rule` and `resolve_timeout`, and `RiskOracle.resolve_signal_dispute*` and `resolve_*_timeout`, all call `committee()`. Once pause checks are wired, every `buy_cover`, `open_series`, `deposit`, `quote` and `post_signals` reads `paused()` too. If the Governor's instance entry is archived, every one of those calls fails for an unsimulated transaction (issue #28). So the Governor extends its own entries on every touch, including those reads, and reuses the shared constants in `sylox_types::ttl` that `MarketFactory` and `Series` already use, rather than introducing a third set of numbers (Q20):

| Entry class | Extended by | Extend to | Re-extend when remaining TTL drops below |
| --- | --- | --- | --- |
| Instance (`Config`, `NextActionId`, `Params`, `Paused(*)`, `MigrationVersion`, plus the contract instance and its Wasm code, which `instance().extend_ttl` also covers) | Every state-changing call (`queue`, `approve`, `execute`, `cancel`, `pause`), and the reads other contracts call on their own state-changing paths: `committee()`, `paused()` | `INSTANCE_TTL_EXTEND_TO`, 518,400 ledgers (30 days) | `INSTANCE_TTL_THRESHOLD`, 345,600 ledgers (20 days) |
| Persistent `Action(id)` | Every write (`queue`, `approve`, `execute`, `cancel`) and every `action(id)` read made inside a state-changing call | `PERSISTENT_TTL_EXTEND_TO`, 6,307,200 ledgers (365 days) | `PERSISTENT_TTL_THRESHOLD`, 5,184,000 ledgers (300 days) |

Why 365 days for `Action(id)`: an action is only live for up to 28 days (a 14 day timelock plus the 14 day `grace_secs`), but it is the onchain record of who approved what. Section 15.2 keeps event records and bonds for 1 year after resolution; the same target is proposed here (Q20).

`committee()` and `paused()` extend the instance TTL even though they are reads, unlike `markets.md`'s rule for SEP-41 `balance`. The difference: these two are called by other contracts from inside real, state-changing transactions, and an archived Governor breaks those transactions. Called through simulation, the extension costs nothing and is never saved. `param()` and `action()` called from outside are plain reads and do not extend.

Extension runs after `require_auth` and validation, so a rejected call never pays for it, matching `sylox_types::ttl::extend_instance`'s own contract.

## 4. Actions: queue, approve, execute, cancel

### 4.1 Functions

```rust
fn queue(env, proposer: Address, action: Action) -> Result<u64, Error>;   // auth: proposer, must be a signer
fn approve(env, signer: Address, action_id: u64) -> Result<(), Error>;    // auth: signer, must be a signer
fn execute(env, action_id: u64) -> Result<(), Error>;                     // anyone
fn cancel(env, /* Q6 */ action_id: u64) -> Result<(), Error>;            // auth: "threshold of signers", shape is Q6

// reads
fn action(env, id: u64) -> Option<QueuedAction>;   // state reads Expired once now > expires_at and stored state is Queued or Approved
fn param(env, key: Symbol) -> i128;                // Q11
fn committee(env) -> Address;
fn paused(env, scope: PauseScope) -> bool;         // Q9: not in Section 12.6
fn version(env) -> u32;
```

### 4.2 Lifecycle

States and transitions are exactly Section 17.1's `ActionState` and Section 17.2's state diagram:

| From | To | Call | Condition | Error otherwise |
| --- | --- | --- | --- | --- |
| (none) | Queued | `queue(proposer, action)` | `proposer` is a signer; the action passes queue-time checks (4.4) | `NotSigner`, `InvalidAction` |
| Queued | Queued | `approve(signer, id)` | `signer` is a signer, has not approved yet, `now <= expires_at`; approvals still below threshold after adding it | `NotSigner`, `AlreadyApproved`, `ActionExpired`, `WrongState` |
| Queued | Approved | `approve(signer, id)` | as above, and the approval count reaches the threshold | as above |
| Approved | Executed | `execute(id)` | approvals from current signers `>= threshold` (Q15), `now >= eta`, `now <= expires_at`; the target call succeeds | `ThresholdNotMet`, `TimelockActive`, `ActionExpired`, `WrongState`, or the target's own error |
| Queued, Approved | Cancelled | `cancel(..., id)` | Q6 | `WrongState` |
| Queued, Approved | Expired | none (lazy) | `now > expires_at`; reported by `action(id)`, rejected by `execute` and `approve` | |

- `queue` does not count as an approval. Section 17.1 says `approvals` holds "distinct signers that approved, proposer included once it approves", so the proposer calls `approve` like everyone else.
- `eta = queue time + timelock(action)` and `expires_at = eta + grace_secs` (Section 17.1), with `grace_secs` = 1,209,600 (14 days, Section 23). Approvals collected during the timelock count. Section 17's own introduction instead describes "propose, collect approvals, wait out the timelock, execute", which reads as the timelock starting once approvals are in (Q4).
- `execute` runs the target call inside the same invocation and marks the action Executed only if that call returns successfully. A failing target call reverts the whole `execute`, so the action stays Approved and can be executed again before `expires_at` (for example once a `TreasurySpend`'s bucket has been topped up).
- An action executes at most once: `execute` requires state Approved and writes Executed.

### 4.3 Timelocks and dispatch

| Action | Timelock (Section 17.2) | Executed as |
| --- | --- | --- |
| `OpenSeries(terms)` | 2 days | `MarketFactory.open_series(terms)` |
| `AddAsset(cfg)` | 2 days | `RiskOracle.add_asset(cfg)` |
| `AddKeeper(addr)` | 2 days | `Staking.add_keeper(addr)` |
| `AddReporter(addr, region)` | 2 days | `Staking.add_reporter(addr, region)` |
| `UpdateAsset(asset, cfg)` | **not listed** (Q5) | `RiskOracle.update_asset(asset, cfg)` |
| `DisableAsset(asset)` | **not listed** (Q5) | `RiskOracle.disable_asset(asset)` |
| `RemoveKeeper(addr)` | **not listed** (Q5) | `Staking.remove_keeper(addr)` |
| `RemoveReporter(addr)` | **not listed** (Q5) | `Staking.remove_reporter(addr)` |
| `SetParam(key, value)` | 7 days | Section 9; Q11 |
| `SetFormula(version, weights, params)` | 7 days | `RiskOracle.set_formula(version, weights, params)` |
| `RegisterDefinition(def)` | 7 days | `EventRegistry.register_definition(def)` |
| `TreasuryAllocate(from, to, amount)` | 7 days | `Treasury.allocate(from, to, amount)` |
| `Upgrade(contract, hash)` | 14 days | Section 6 |
| `SetSeriesWasm(hash)` | 14 days | `MarketFactory.set_series_wasm(hash)` |
| `SetSigners(signers, threshold)` | 14 days | Governor's own `Config` |
| `SetCommittee(addr)` | 14 days | Governor's own `Config` |
| `TreasurySpend(bucket, to, amount)` | 14 days | `Treasury.spend(bucket, to, amount)` |
| `Unpause(scope)` | 0 days | Governor's own `Paused(scope)` (Section 8) |

The targets' own checks still apply when the action executes (Section 17.1's list: `RegisterDefinition`'s Section 8.8 rejections, `UpdateAsset`'s immutable `reference`, `TreasurySpend`'s `InsufficientBucket`, and so on).

Governor-gated target functions that **no `Action` variant reaches** (Q12): `RiskOracle.set_sub_epoch_secs(asset, value)`, `MarketFactory.set_hard_cap(asset, amount)`, `set_related_sellers(asset, list)`, `set_price_guard(asset, guard)`, `set_liquidity_cover_ratio(ratio)` (reachable only if `SetParam` maps to it, Section 9), `EventRegistry.set_factory(factory)`, and every core contract's `migrate()` (Section 6.2). Once a target's `governor` is the Governor contract, these functions cannot be called by anyone until an action exists for them.

### 4.4 Queue-time checks

`queue` rejects only what can be decided without calling a target, so an action that cannot possibly execute never occupies a 14 day slot: `SetSigners` with an invalid set (2.1), `SetParam` with a key the Governor cannot apply (Section 9), and `Upgrade` naming an address that is neither a target nor the Governor itself (Section 6.1). Everything else is checked by the target at execution.

## 5. Approvals and cancellation (Q6)

Section 12.6 gives `cancel(env, action_id)` with "auth: threshold of signers", but the signature has no signer argument, and the Section 17.2 diagram shows `Approved --> Cancelled: cancel()` with no threshold condition at all. Two readings, both plausible, neither proposed here:

- `cancel(signers: Vec<Address>, action_id)`, every listed signer authorizes, and the count of distinct current signers must reach the threshold.
- Cancellation collects approvals the same way execution does (a separate cancel-approval set per action), so signers can cancel asynchronously.

Whether a single signer (for example the proposer) can withdraw its own Queued action is also unstated.

## 6. Upgrades

### 6.1 Upgrading the other core contracts

`RiskOracle`, `EventRegistry`, `Staking`, `Treasury` and `MarketFactory` each expose `upgrade(new_wasm_hash)`, which swaps the code immediately when the governor address calls it (`sylox_types::upgrade::do_upgrade`, issue #12). The Governor never calls it except from `execute(Action::Upgrade(contract, hash))`, so once the handover is done (Section 10) every core upgrade waits out the 14 day timelock and needs the threshold.

- **Staking and Treasury.** Section 17.3 calls these two out because they hold funds and every upgrade must preserve I14 and I15. Section 17.2 already gives every `Upgrade` 14 days regardless of target, so the Governor applies one timelock to all of them: there is no shorter path for the non-custodial contracts that the fund-holding ones could be routed through by mistake.
- **Which addresses can be upgraded.** `queue` accepts `Upgrade(contract, _)` only when `contract` is one of the five `targets` or the Governor itself. `Series` contracts are never upgradeable (Section 17.3); `SetSeriesWasm` changes only the code future series are deployed from.
- **Until handover**, `deploy/README.md`'s "Known gap: no 14 day timelock" stays true: the admin key upgrades immediately.

### 6.2 Migration after an upgrade (Q13)

Every core contract also has `migrate()`, governor-gated, which records that the new `CONTRACT_VERSION`'s storage migration has run. No `Action` variant calls it. Two ways to close this, both open:

- `execute(Upgrade(contract, hash))` calls `contract.upgrade(hash)` and then `contract.migrate()` in the same invocation. This depends on the new code being the one that runs for the second call in the same transaction, which has to be confirmed against the pinned soroban-sdk before it is relied on.
- A new `Action::Migrate(Address)`, queued after the upgrade. It needs its own timelock row, and leaves a window between the swap and the migration.

### 6.3 The Governor's own upgrade

Section 17.3 lists `Governor` among the contracts that expose `upgrade(wasm_hash)`. A public `upgrade` on the Governor gated on its own address cannot work: the Governor's address can only authorize calls the Governor makes, and a Soroban contract cannot call back into itself. **Proposed:** the Governor's own upgrade is `Action::Upgrade(governor_address, hash)`, queued, approved and timelocked like any other (14 days), and `execute` performs the swap in-process (`update_current_contract`) and emits the same `Upgraded` event. `sylox_types::upgrade::do_upgrade` checks `governor.require_auth()` itself, so this path needs a variant of that helper without the auth check, used only from `execute` after the threshold and timelock have been checked. The Governor exposes `version()` like every other core contract. Whether it should also export a symbol named `upgrade` for interface uniformity, and how its own `migrate()` runs, is Q14.

A broken Governor upgrade cannot be undone through the Governor, so the implementation test plan (Section 13) includes queuing and executing a second action on the upgraded code before any self-upgrade is considered safe to ship.

### 6.4 Tying a queued upgrade to its migration note and decode test

Section 17.3 requires every upgrade to ship with a storage migration note and a test proving existing keys decode under the new types. `Action::Upgrade` carries only `(Address, BytesN<32>)`, so nothing onchain links the two (Q13). **Proposed**, without a type change, building on `deploy/README.md`'s existing procedure:

1. The pull request that bumps a contract's `CONTRACT_VERSION` carries, in the same commit range, the migration note (in `deploy/README.md`'s "Migration notes" section, or a file it links) and the decode test (the `upgrade_keeps_existing_storage` pattern each contract's `test.rs` already has: write under the old code, swap via `env.upload`, read back).
2. The upgrade is queued only from a merged commit. The `deployments/<network>.json` entry records the contract, the new Wasm hash, the new `version()`, the commit, and the path of the migration note.
3. During the 14 day timelock, each signer rebuilds the Wasm from that commit and approves only if the hash matches the one in the queued action. The timelock exists to make this check possible.
4. After execution, `version()` on the target is read back and compared with the recorded version (`deploy/README.md` step 3).

The alternative, adding a field such as a migration note hash to `Action::Upgrade`, changes a type in `sylox_types` and is left to Q13.

## 7. The committee

The committee does not act through the Governor queue. Committee-gated functions authorize the committee address directly, reading it fresh from `Governor.committee()` on every call. This is already built:

| Function | Contract | Auth as built |
| --- | --- | --- |
| `rule(event_id, declare, reason)` | EventRegistry | `Governor.committee().require_auth()` |
| `resolve_signal_dispute(asset, epoch, keeper_wins, reason)` | RiskOracle | `Governor.committee().require_auth()` |
| `resolve_sub_signal_dispute(asset, hour, sub, keeper_wins, reason)` | RiskOracle | `Governor.committee().require_auth()` |
| `resolve_timeout(event_id)` | EventRegistry | Anyone; reads `committee()` to record the miss (ADR-002) |
| `resolve_signal_dispute_timeout(asset, epoch)`, `resolve_sub_dispute_timeout(asset, hour, sub)` | RiskOracle | Anyone; reads `committee()` to record the miss (ADR-010) |

So the Governor's whole committee job is: store one address, return it from `committee()`, keep that read alive (Section 3.2), and change it only through `SetCommittee` (14 days). Issue #22 is exactly this read failing today, because the testnet `governor` address is an account with no `committee()` function. All six functions above start working once targets point at a real Governor (Section 10).

- **The committee is not a Governor signer by default** and gains nothing in the queue from being the committee. Section 16 lists what it cannot do: change parameters, touch collateral, extend a ruling deadline.
- **Rotation and missed deadlines** (Q16): misses are recorded against the committee read at resolution time (ADR-010). An event escalated under one committee whose deadline passes after a `SetCommittee` executes is recorded as a miss by the new committee.
- **Tier 3 and false-evidence slashing** (Q19): Section 16 also lets the committee propose Tier 3 events and slash reporters for false evidence. `propose_tier3` is not built (later build phase), and `Staking.slash` as built accepts only the oracle's auth (Section 16.1, 24.2). Neither needs anything from the Governor beyond `committee()`.

## 8. Pausing

### 8.1 What the Governor does

```rust
fn pause(env, scope: PauseScope) -> Result<(), Error>;   // auth: guardian, no timelock
fn paused(env, scope: PauseScope) -> bool;               // Q9
// unpause: only Action::Unpause(scope), 0 day timelock, still needs the threshold (Q7)
```

- `pause(scope)` writes `Paused(scope) = now + max_pause_secs` (`max_pause_secs` = 1,209,600, 14 days, Section 23) and emits `paused { scope, by: guardian }`.
- `paused(scope)` is `true` while `now < Paused(scope)`. A pause lapses by itself after `max_pause_secs` with no write needed, so a lost guardian key cannot freeze the protocol (Section 16.2).
- `Action::Unpause(scope)` removes `Paused(scope)` and emits `unpaused { scope, by: governor }`. Section 12.6 says unpause is "via queue + timelock" and Section 17.2 gives it a 0 day timelock, so it still needs the signer threshold, just no waiting.
- Section 16.2 says a pause lapses "unless renewed by the governor", but no `Action` renews a pause, and nothing stops the guardian calling `pause` again on an already paused scope to push its lapse time out indefinitely (Q8).

### 8.2 What each scope blocks, and what it never blocks

The Governor only stores the switch. Each target checks it at the top of the functions below and rejects with `Paused` (error 4, already reserved in every contract's error enum and currently unreachable).

| Scope | Blocks (Section 16.2) | Checked in | Never blocks |
| --- | --- | --- | --- |
| `NewCover` | `buy_cover` on all series | `Series.buy_cover` | `claim`, `claim_for`, `withdraw`, `trigger`, `sync` |
| `NewSeries` | `open_series` | `MarketFactory.open_series` | Existing series, all of their functions |
| `Deposits` | `deposit`, `quote` | `Series.deposit`, `Series.quote` | `withdraw` of unencumbered collateral, `cancel_quote` |
| `Signals` (issue #5) | `post_signals` | `RiskOracle.post_signals`, and Q10 for the rest | Reads; `finalize`, `propose_tier1` and every other check on already Final data |

**A pause never blocks a claim or a withdrawal.** This is structural, not a check: `PauseScope` has exactly four variants, none of them names a claim or withdrawal path, and the pause check is added only to the functions in the "Checked in" column. The test plan (Section 13) asserts the other direction too: with all four scopes paused, `claim`, `claim_for`, `withdraw`, `trigger`, `sync`, `Staking.claim`, `Treasury.claim_reward`, `finalize`, `rule` and `resolve_timeout` all still succeed.

Open points on the target side (Q9, Q10):

- **How a target finds the switch.** `RiskOracle` and `MarketFactory` store `governor` and can call `Governor.paused(scope)`. `Series` stores `factory`, `oracle`, `registry` and `treasury` but not `governor`, and its constructor is fixed by Section 12.5, so it needs either a forwarding read on `MarketFactory` or a constructor change.
- **The rest of the `Signals` scope.** Section 16.2 names only `post_signals`. Since v1.5 there is also `post_sub_signals`, plus `dispute_signals`, `dispute_sub_signals`, `build_hour` and `finalize_endpoint`. Which of these `Signals` blocks is not stated.
- **Guardian scope list.** Section 16's role table lets the guardian pause "new deposits, new cover and new series", while Section 16.2 and `PauseScope` also have `Signals`.
- **Per-asset pauses.** Runbook 22.5 says "guardian may pause `NewCover` on the asset", but `PauseScope` has no asset and `pause` takes no asset.
- **Who builds the target checks.** They change `RiskOracle`, `MarketFactory` and `Series`, not the Governor.

## 9. Parameters: `SetParam` and `param()` (Q11)

Section 17.1 has `Action::SetParam(Symbol, i128)`, Section 15.1 a Governor `Params` map, and Section 12.6 a `param(key) -> i128` read. As built, no contract reads `Governor.param`: each keeps its own settings and exposes its own governor-gated setter, and most Section 23 values are compile-time constants (for example `SIGNAL_DISPUTE_RULING_SECS`, `KEEPER_EXIT_DELAY_SECS`). So a `SetParam` that only writes the Governor's map changes nothing anywhere.

**Proposed**, until Q11 is answered: `SetParam(key, value)` is accepted at queue time only for a key the Governor knows how to apply, writes `Params[key] = value` for `param(key)` to report, and calls the target's setter. The only key with a matching protocol-wide setter today is `liquidity_cover_ratio` (`MarketFactory.set_liquidity_cover_ratio`). Any other key is rejected with `InvalidAction` at queue time rather than accepted and silently ignored.

Per-asset settings cannot be expressed as `SetParam(Symbol, i128)` at all, because the action carries no asset: `sub_epoch_secs` (which Section 16 says is set "through the same `SetParam` action"), `hard_cap`, the related seller list and the price guard.

`param(key)` for a key never set returns what? Section 12.6 returns a bare `i128` with no `Option` (Q11).

## 10. Handing the testnet admin key's role to the Governor (steps only, not done)

Today a funded testnet account, `sylox-testnet-admin`, is passed wherever a contract's constructor expects `governor`. **No contract has a function to change its `governor` address**: it is fixed in each `Config` at construction (checked: there is no `set_governor` anywhere in `contracts/`). So the handover needs either fresh contracts or one more upgrade. Which one is Q21. Nothing below is to be run without an explicit go-ahead.

1. **Decide the testnet roles** (Q26): signer set and threshold, committee address, guardian address. The admin key's own future (a signer, or retired) is part of this.
2. **Build and test the Governor** against the five targets in integration tests, including every row of Section 4.3 and the issue #22 paths (`rule`, `resolve_timeout`, `resolve_signal_dispute`).
3. **Point the targets at the Governor**, one of:
   - **A. Fresh redeploy.** Extend `deploy/deploy.sh`'s constructor flow so the Governor's address is precomputed with the others and passed as `governor` to every target, and the targets' addresses to the Governor. This also brings `MarketFactory` onto testnet with a real `governor` and a real `factory` for `EventRegistry` (issue #23). It resets all testnet state, so the full order in `deploy/README.md` applies again (backfill before smoke test, because `first_epoch` is write-once).
   - **B. One-time setter by upgrade.** Upgrade each live target, authorized by the admin key (immediate today), to code with a `set_governor(new)` that only the current governor can call and that locks after one use (the pattern `EventRegistry.set_factory` already follows); then call it once per target. This keeps testnet state but adds new governor-gated surface to every contract.
4. **Verify**, for each target: a governor-gated call signed by the admin key is now rejected; the same change queued through the Governor executes only after its timelock; `committee()` resolves, and `rule` / `resolve_timeout` / `resolve_signal_dispute` work (closes issue #22).
5. **Update the paper trail:** `deployments/testnet.json` (the Governor's id, Wasm hash and roles), `deploy/smoke-testnet.sh` (its "non-admin call to a governor-gated function is rejected" check becomes "a direct call that skips the Governor queue is rejected"), the SDK's generated network file, README.md's testnet stand-ins and known gaps, and `deploy/README.md`'s "no 14 day timelock" note.
6. **From then on, the admin key has no role in any contract.** The keeper, the TUSD issuer and the deployer are separate identities and are not affected.

## 11. Errors

Section 14 gives the Governor 600 to 603. Proposed additions, appended to the 600 range per Section 14's own rule:

| Code | Name | Meaning |
| --- | --- | --- |
| 600 | `NotSigner` | Not a multisig signer (spec) |
| 601 | `TimelockActive` | Execute before ETA (spec) |
| 602 | `ThresholdNotMet` | Not enough approvals (spec) |
| 603 | `ActionExpired` | `expires_at` passed (spec) |
| 604 | `UnknownAction` | No action with that id (new) |
| 605 | `WrongState` | The action is not in a state that allows this call, for example executing a Cancelled action (new) |
| 606 | `AlreadyApproved` | This signer already approved this action (new) |
| 607 | `InvalidSigners` | Empty set, duplicate signer, or threshold outside `1..=len` (new) |
| 608 | `InvalidAction` | Rejected at queue time: an unknown `SetParam` key, or an `Upgrade` of an unknown address (new) |

The shared codes 1 to 5 keep their meaning. Guardian and signer auth go through `require_auth()`, which traps rather than returning `Unauthorized`, the same as every other contract (Section 14, code 3).

## 12. Events and invariants

Events, as Section 13 lists them, with ADR-007's topic convention:

| Event | Topic | Data |
| --- | --- | --- |
| `action_queued`, `action_approved`, `action_executed`, `action_cancelled` | `action_id` | `action`, `eta`, `expires_at`, `state` |
| `paused`, `unpaused` | `scope` | `by` |
| `upgraded` (self-upgrade only) | `contract` | `old_version`, `new_wasm_hash` (the shared `sylox_types::upgrade::Upgraded`) |

Invariants the implementation must hold, each with a test (Section 13):

| Id | Invariant |
| --- | --- |
| G1 | Every governor-gated call the Governor makes on another contract happens inside `execute`, for an action that reached Approved |
| G2 | An action executes at most once, never before `eta`, never after `expires_at` |
| G3 | At execution, approvals from distinct current signers `>= threshold` (subject to Q15) |
| G4 | Each action's `eta - queue time` equals its Section 17.2 timelock |
| G5 | The guardian can call `pause` and nothing else; `pause` never moves funds or touches another contract |
| G6 | A pause lapses by itself after `max_pause_secs` |
| G7 | No pause scope blocks a claim, a withdrawal, a trigger or a ruling |
| G8 | The Governor holds no funds; it never calls a token contract |
| G9 | `Config.threshold` is always within `1..=signers.len()` and `signers` has no duplicates |

## 13. Test plan

- **Unit, Governor alone:** constructor validation (G9); queue, approve, execute, cancel through every transition in 4.2 and every error in Section 11; `action(id)` reporting Expired with no write; a removed signer's approval not counting (if Q15 lands that way); `pause` by a non-guardian trapping; pause lapse at `max_pause_secs` (G6); `Unpause` at 0 days but needing the threshold.
- **Timelock table:** one test per row of Section 4.3, executing at `eta - 1` (rejected) and `eta` (accepted), and at `expires_at + 1` (rejected) (G2, G4).
- **Integration, with the five real targets registered in one `Env`:** every dispatch row executes and the target's state changes; a direct call to any governor-gated target function from a signer, the guardian or the committee is rejected (G1); `Upgrade` of `Staking` and `Treasury` swaps code only after 14 days and keeps I14 and I15; the issue #22 paths (`rule`, `resolve_timeout`, `resolve_signal_dispute`, `resolve_signal_dispute_timeout`) succeed with the committee read from the Governor; `SetCommittee` changes who can rule.
- **Self-upgrade:** upgrade the Governor to a fresh hash via `env.upload`, confirm `Config` and every `Action(id)` still decode, then queue and execute a second action on the new code.
- **Pause, once targets are wired (Q9, Q10):** with all four scopes paused, every "Never blocks" function in 8.2 still succeeds (G7).
- **TTL:** after each state-changing call, and after `committee()` / `paused()` reads inside a call, the instance TTL is at least the extend-to value; `Action(id)` likewise after each write (issue #28's regression test shape).
- **Property:** random sequences of queue, approve, execute, cancel, `SetSigners` and time jumps never break G2, G3 or G9.
- **Budget:** `execute` of the most expensive action (`OpenSeries`, which deploys a `Series`) and of `Upgrade` measured against the network limits, the way `budget_test.rs` does for the other contracts.

## 14. Open questions

Nothing below is decided by this note. Each needs an answer from the lead before `feat/governor` starts.

1. **Q1. Constructor and `timelock_secs`.** Section 12.6 specifies `initialize(signers, threshold, timelock_secs, committee)`. Every other contract moved to `__constructor` in #21; is the Governor meant to follow? And what is the single `timelock_secs` for, when Section 17.2 fixes a timelock per action type: a minimum, a scale for tests, or a leftover?
2. **Q2. Target addresses.** Section 12.6's constructor takes no target addresses, but executing almost every `Action` needs one (Section 4.3). Should the constructor take them (the proposed `Targets` struct), and should they ever be changeable?
3. **Q3. The guardian.** Section 12.6 gives `pause` guardian auth; Section 16 describes the guardian as a 2 of 3 multisig; nothing says where its address is stored or how it changes, and issue #5 refers to a separate `Guardian` contract. A `Config` field set at construction, with which action to change it, or a separate contract?
4. **Q4. When the timelock starts.** Section 17.1 sets `eta` to queue time plus the timelock, so approvals can arrive during the wait and an action approved on day 13 of a 14 day timelock can run on day 14. Section 17's introduction reads "propose, collect approvals, wait out the timelock, execute", which suggests the timelock starts after approvals. Which one?
5. **Q5. Missing timelocks.** Section 17.2 has no row for `UpdateAsset`, `DisableAsset`, `RemoveKeeper` or `RemoveReporter`. What are they?
6. **Q6. `cancel` authorization.** Section 12.6 says "threshold of signers" but the signature has no signer argument; the Section 17.2 diagram shows `Approved --> Cancelled` with no condition. Which signature, synchronous or collected approvals, and can a proposer withdraw its own Queued action alone?
7. **Q7. `Unpause` approvals.** Section 12.6 says "via queue + timelock" and Section 17.2 says 0 days. Does `Unpause` need the full signer threshold, or something lighter?
8. **Q8. Renewing a pause.** Section 16.2 says pauses lapse "unless renewed by the governor", but there is no renew action, and the guardian can call `pause` again on a paused scope. Should a re-pause by the guardian extend the lapse time, be rejected, or only be allowed by the governor?
9. **Q9. How targets read the switch.** Section 12.6 has no `paused(scope)` read. Is the proposed read right, and how does `Series`, which stores no `governor` address and whose constructor is fixed by Section 12.5, find it?
10. **Q10. Pause scope edges.** Which of `post_sub_signals`, `dispute_signals`, `dispute_sub_signals`, `build_hour` and `finalize_endpoint` does `Signals` block (Section 16.2 names only `post_signals`)? Can the guardian pause `Signals` at all (Section 16's role table lists only deposits, cover and series)? Is a per-asset pause intended (runbook 22.5) when `PauseScope` has no asset? And is wiring the target-side checks part of `feat/governor` or a separate PR per contract?
11. **Q11. What `SetParam` does.** No contract reads `Governor.param`; parameters live in each contract, mostly as constants, and `SetParam(Symbol, i128)` cannot carry an asset. Section 16 nonetheless says `sub_epoch_secs` is set through `SetParam`. Is the Governor's `Params` map meant to become the source the targets read (a change to every target), or a mirror with the Governor calling each target's setter? Which keys are settable in v1? What does `param(key)` return for a key never set?
12. **Q12. Setters no action reaches.** `set_sub_epoch_secs`, `set_hard_cap`, `set_related_sellers`, `set_price_guard`, `set_liquidity_cover_ratio`, `set_factory` and every `migrate()` are governor-gated with no `Action` variant. After handover nobody can call them. New `Action` variants (a change to `sylox_types`), a generic call action, or something else?
13. **Q13. Migration after upgrade, and the note binding.** Should `execute(Upgrade)` also call `migrate()` in the same invocation (if the SDK runs the new code for that second call), or should there be an `Action::Migrate`? And is the off-chain binding in Section 6.4 enough, or should `Action::Upgrade` carry a hash of the migration note?
14. **Q14. The Governor's own `upgrade()` and `migrate()`.** Section 17.3 lists the Governor among contracts exposing `upgrade(wasm_hash)`, but it cannot be gated on the Governor's own address. Is the in-process `Action::Upgrade(self, hash)` path acceptable, should a symbol named `upgrade` also exist for uniformity, and how does the Governor run its own migration?
15. **Q15. Signer changes and pending actions.** When `SetSigners` executes, do approvals already given by removed signers still count, is the threshold the one at queue time or at execution, and are pending actions cancelled?
16. **Q16. Committee rotation and misses.** A ruling deadline that passes after `SetCommittee` executes is recorded against the new committee (ADR-010 reads the committee at resolution time). Is that intended?
17. **Q17. Approving after `eta`.** Can a signer still approve between `eta` and `expires_at` (this note assumes yes), and can an action go from Queued straight to execution in the same transaction as its last approval?
18. **Q18. Duplicate actions.** Can the same `Action` be queued twice while the first is pending? Nothing forbids it.
19. **Q19. Committee slash for false evidence.** Section 16 gives the committee a slash for false probe evidence; `Staking.slash` as built accepts only the oracle (Section 16.1, 24.2). Is closing that part of this work?
20. **Q20. TTL numbers.** Issue #28 proposes extending to 30 days at a 7 day threshold; `sylox_types::ttl` (used by `MarketFactory` and `Series`) uses 30 days at 20 days for instance entries and 365 days at 300 days for persistent ones. This note reuses `sylox_types::ttl`. Is that right, is 1 year the right retention for `Action(id)`, and should `committee()` and `paused()` extend the instance TTL as proposed in 3.2?
21. **Q21. Handover route.** Fresh redeploy (Section 10, A) or one-time `set_governor` by upgrade (B)?
22. **Q22. Error codes.** Are 604 to 608 (Section 11) acceptable additions to the Governor's range?
23. **Q23. Governor storage of `Params` in instance.** Section 15.1 puts `Params` in instance storage. If the map grows with per-asset keys (Q11) it competes with the 64 KB instance entry limit. Keep it there?
24. **Q24. `OpenSeries` cost.** `execute(OpenSeries)` deploys a `Series` inside the Governor's call. Section 9.7 says `open_series` is governor only in v1; is there a budget concern with running it nested one level deeper than today, to be measured before the implementation is accepted?
25. **Q25. Who may call `execute`.** Section 12.6 says anyone. Is that intended for `SetSigners`, `SetCommittee` and `Upgrade` as well, given that whoever calls it chooses the exact moment between `eta` and `expires_at`?
26. **Q26. Testnet roles.** Section 16's defaults (4 of 7 signers, 4 of 7 committee, 2 of 3 guardian) are for mainnet. What signer set, threshold, committee and guardian should testnet use, and does the admin key stay as a signer?

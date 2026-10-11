# MarketFactory and Series design note

Status: Draft, for review before any contract code · Date: October 11, 2026

Source: technical-doc.md v1.5 Changelog, Section 4.4, 5.9, 8.6, 9, 10, 11.1, 11.5, 12.4, 12.5, 12.7, 15, 16, 17.3, 21; ADR-001, 003, 004, 012; `docs/design/event-registry.md` (format and deviation 15).

Scope: `MarketFactory` (`__constructor`, `open_series`, `reserve_cover`, `release_cover`, `set_series_wasm`, `upgrade`, `migrate`, every Section 12.4 read) and `Series` (`__constructor`, `deposit`, `quote`, `cancel_quote`, `withdraw`, `transfer_position`, `buy_cover`, `claim`, `claim_for`, `trigger`, `sync`, the SEP-41 cover token, every Section 12.5 read). Also in scope, as the last commit of the implementation PR: replacing `EventRegistry.version_has_live_cover`'s stand-in with a real query to `MarketFactory`, closing `docs/design/event-registry.md`'s own deviation 15, and `EventRegistry.set_factory`, the one-time governor-only call that gives it the real `MarketFactory` address to query (Section 16's own deviation 14). Out of scope, each its own later PR: the demo build (Step 3, after this merges), and the real `PriceGuard`/price adapters (shipped here as a mock; the real adapter is `contracts/adapters`' own future work, and its existing stub signatures are not reused — see Section 2).

## 1. State machine

```mermaid
stateDiagram-v2
  [*] --> Open
  Open --> Closed: sale end
  Closed --> Pending: expiry, acceptance period starts
  Pending --> Expired: acceptance period over, no covering event open
  Open --> Triggered: event declared
  Closed --> Triggered: event declared
  Pending --> Triggered: event declared
  Triggered --> Finalized: balance identity reaches zero
  Expired --> Finalized: balance identity reaches zero
```

| From | To | Trigger | Who | Exact time condition |
| --- | --- | --- | --- | --- |
| None | Open | `MarketFactory.open_series` deploys the series | Governor (v1) | At deploy, `terms.start` |
| Open | Closed | `sync()`, or lazily inside any state-changing call | Anyone | `now >= sale_end = terms.expiry - sale_cutoff_secs` (default 3 days) |
| Closed | Pending | `sync()` | Anyone | `now >= terms.expiry` |
| Pending | Expired | `sync()` | Anyone | `now >= terms.expiry + longest window_len(kind)` among covered kinds (Section 8.6) AND no event covering this series is Proposed, Challenged or Escalated for any covered kind |
| Open / Closed / Pending | Triggered | `sync()`; `trigger()` is `sync()` plus an assertion the result is Triggered (Section 7) | Anyone | `EventRegistry.covers(event_id, def_version, terms.start, terms.expiry)` is true for some Declared event under a kind+version this series pins |
| Triggered / Expired | Finalized | `sync()` (Section 7) | Anyone | The series' own tracked balance identity (Section 10.3) is zero: `total_collateral + total_premium - total_paid - total_withdrawn == 0` |

Every state-changing call (`deposit`, `quote`, `cancel_quote`, `withdraw`, `transfer_position`, `buy_cover`, `claim`, `claim_for`, `trigger`, `sync`) runs the same `sync_state()` first, so no transition above is reachable only through a dedicated function; `sync()` is the public entry point for anyone who wants to force it without doing anything else, matching this codebase's existing permissionless-forcing-function pattern (`EventRegistry.finalize`/`resolve_timeout`/`checkpoint_cure`). On reaching Expired or Triggered, `sync_state()` calls `MarketFactory.release_cover`, which also drops the series from the factory's live list (Section 9.2).

## 2. Sales gating: feed staleness and the price guard (M1, M2, M3)

Fully specified by the v1.5 changelog and Section 9.4; restated here only because `buy_cover`'s step order depends on it.

- **M1, `FeedBehind`:** `buy_cover` rejects unless the asset's newest posted sub-epoch (`RiskOracle.live(asset)`) is the last one that closed, OR it is the one before that AND fewer than `feed_grace_secs` (default 120s) have passed since the **last** sub-epoch closed — stated exactly as Section 9.4 step 3 does, since the grace window is measured from the latest close, not from the posted sub-epoch's own close. Checked after `cover_gate`, before the price guard. **Ops note (PR #64 review):** `sylox-live-poster`'s own cron schedule (`1-56/5 * * * *` UTC) runs 60s after every 5-minute sub-epoch boundary, then takes several more seconds to submit and confirm the post — leaving well under half of the 120s grace window as margin by the time the post lands. The implementation PR must measure the real post-to-confirmation time on testnet and state plainly whether 120s holds, rather than assume it from this estimate.
- **M2, `PriceGuard`:** an optional per-asset client, `PriceGuard.check(asset) -> GuardStatus { Ok, Paused, Unavailable }`. `buy_cover` calls it only if one is configured for the asset; `Paused` or `Unavailable` rejects with `FastSignalPause` (already reserved as error 516). It never gates `claim`, `trigger`, `withdraw`, or any read. Shipped here with a mock implementing the trait below; the real adapter is out of scope. **Deliberately not built on `contracts/adapters/{amm-soroswap,fx-reference}`'s existing stub signatures** (`spot_price(_,_) -> (i128,i128)`, `rate(_,_) -> i128`) — those already don't match what `RiskOracle::clients.rs` expects (a 3-tuple with timestamp, and `(code, FxRateSource) -> (i128,u64)` respectively), and `PriceGuard` is a distinct concern (a fast, sale-only pause signal, not a price or FX read). The trait:

  ```rust
  pub trait PriceGuard {
      fn check(env: Env, asset: Address) -> GuardStatus;
  }
  ```

- **M3, no per-purchase waiting period:** cover units are fungible within a series, so a purchase cannot carry its own start time distinct from every other unit's. M1, M2 and `cover_gate` (Section 8's existing informed-buying block) do that job collectively: a buyer who purchases moments before a real failure starts is blocked by one of them, not by a per-purchase timer. No separate mechanism is added.

## 3. Storage lifetime (M4): the TTL policy, with real numbers

Section 15.2's table states the target lifetimes in time, not ledger counts, and leaves the exact numbers to this note. At 5 seconds per ledger (the same assumption `deploy/extend-ttl.sh` already uses):

| Entry class | Contracts | Extended by | Extend to | Re-extend when remaining TTL drops below |
| --- | --- | --- | --- | --- |
| Instance (`Terms`/`State`/`Totals`/`Quotes` bundle; `Config`/`SeriesCounter` bundle) | Series, MarketFactory | Every state-changing call | 518,400 ledgers (30 days) | 345,600 ledgers (20 days) |
| Persistent (`Position(seller)`, the cover token's `Balance(holder)`; `OpenCover(asset)`, `Deployed(series)`, `SeriesList(asset)`, `Pins(series)`, `LiveCoverCount(asset, kind, version)`) | Series, MarketFactory | Every write, and every hot-path read (below) | 6,307,200 ledgers (365 days) | 5,184,000 ledgers (300 days) |

The instance target (30 days) deliberately matches `deploy/extend-ttl.sh`'s own `EXTEND_TARGET_LEDGERS` exactly: once this ships, that script's periodic sweep becomes a redundant safety net for these two contracts' instance entries rather than the only thing keeping them alive, the same way it already is for the four core contracts once issue #28's real fix lands through `upgrade()`. The persistent target (365 days) matches Section 15.2's own explicit "minimum 1 year" floor for Series positions and cover balances; the 65-day re-extension margin is deliberately wide, since a seller or holder who never touches their own position should not need anyone else to rescue it before a year is up.

**Persistent entries extend on write, plus on every `Position(seller)` touch inside `withdraw`, `transfer_position` and `buy_cover` (PR #64 review).** Stated as an explicit rule for those three functions' own internal reads of `Position`, not left to fall out incidentally of "well it happens to write anyway today" — a future change to any of the three should not silently lose the extension just because it added a path that reads `Position` without writing it. This deliberately excludes two paths that must stay true, zero-storage-cost reads: the public `position(seller)` read function (Section 12.5), and the cover token's own SEP-41 `balance(holder)`. Wallets call `balance` almost entirely through simulation, where nothing is ever saved regardless; even inside a real transaction, forcing a write-path touch on every call of what SEP-41 callers expect to be a pure read would be wrong on its own terms. The cover token's `Balance(holder)` entries instead extend only when they change — mint, transfer, claim, burn — whose combined worst case (a 90-day series plus a `claim_window_secs` claim period, 30 days in the Section 10.5 example) sits comfortably inside the 365-day target with no read-triggered help needed.

`Allowance(from, spender)` (SEP-41) stays temporary per Section 15.1, unaffected by this policy — a temporary entry is deleted, not archived, on expiry, which is the correct behavior for an allowance (re-approving is cheap and expected).

## 4. Collateral token and settlement (M5)

Settlement is the protocol USDC address — TUSD on testnet, real USDC-equivalent on mainnet once Governor sets it. The two settlement rules from Section 9.7 are kept exactly as written: `settlement != asset`, and the settlement asset must not share the covered asset's issuer (checked via the settlement SAC's `name()`, `CODE:ISSUER` for a classic asset). No change.

## 5. Upgrades (lead decision)

`MarketFactory` is a core contract (Section 17.3's list) and needs `upgrade(wasm_hash)`, governor-only. The shared helper for this (issue #12, adding `upgrade()`/`migrate()`/`version()` to the four existing core contracts) has not merged as of this pull (`main` at `ac93428`). **Its shape changed in review of #63 (PR #64 review, point 5)** from this note's first draft; the agreed shape is now:

```rust
// sylox_types::upgrade (shape per review of #63)
pub fn do_upgrade(env: &Env, governor: &Address, current_version: u32, new_wasm_hash: BytesN<32>);
// governor auth is checked inside the helper; emits Upgraded { contract, old_version: current_version, new_wasm_hash }

pub fn do_migrate(env: &Env, governor: &Address, key: MigrationKey, target_version: u32) -> bool;
// governor auth is checked inside the helper; false if target_version was already applied
```

Each contract's own 2-3 line wrappers:

```rust
fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
    let config = Self::require_config(&env)?;
    sylox_types::upgrade::do_upgrade(&env, &config.governor, Self::CONTRACT_VERSION, new_wasm_hash);
}
fn migrate(env: Env) {
    let config = Self::require_config(&env)?;
    if !sylox_types::upgrade::do_migrate(&env, &config.governor, MIGRATION_KEY, Self::CONTRACT_VERSION) {
        panic_with_error!(&env, Error::AlreadyMigrated);
    }
}
fn version(env: Env) -> u32 { Self::CONTRACT_VERSION }
```

**`migrate()` takes no caller-supplied argument and always targets the contract's own `CONTRACT_VERSION` constant, never a caller-chosen version** (PR #64 review, point 5): a caller-chosen value could mark a future migration as already applied, silently skipping its real migration code once that version ships. Auth lives entirely inside the shared helper, not in the per-contract wrapper.

**Decision:** `MarketFactory` builds against these exact signatures now, reading `governor` from its own `Config`, the same shape the four existing contracts will carry. If issue #12 has merged by the time the implementation PR lands, it uses the real helper; if not, it codes against these signatures and rebases once #12 lands — don't wait on #12 either way (confirmed, PR #64 review, answering open question 3 from the first draft). `Series` has no `upgrade()` at all (Section 17.3: not upgradeable; `set_series_wasm` only affects series opened afterward).

## 6. Related seller block list (lead decision)

Section 11.5: "Related seller block list: Issuer and declared affiliates, enforced in `Series.deposit`, list in `Governor`." `Governor` is currently a 25-line stub with no such list.

**Decision:** the list is stored on `MarketFactory`, per asset, not globally — Section 11.5's own wording ("the issuer and declared affiliates") is already asset-specific, since every asset has a different issuer. `MarketFactory` gains:

- `RelatedSellers(asset)`, persistent, a `Vec<Address>`, governor-only setter (`set_related_sellers(asset, list)`).
- `open_series` refuses an asset whose list has never been set at all (new error, `RelatedSellerListNotSet`, 407), so the issuer can never be missing from the list by omission. An explicitly empty list is allowed, but has to be set on purpose, not left at a default.
- `Series.deposit` and `Series.transfer_position` both query `MarketFactory.related_sellers(asset)` and reject a listed address with the existing `RelatedSeller` error (510, already reserved in Section 14's table) — Section 16's own role table already scopes "Seller" as "anyone not on the related seller list," covering transfer as well as deposit, not deposit alone.
- **Issuer check, not auto-add (PR #64 review, answering open question 1 from the first draft):** `open_series` reads the covered asset's own SAC `admin()` when it is callable (a classic asset's admin key) and rejects with a new error, `IssuerNotListed` (408), if that address is not already in the list the governor set for that asset. This catches the issuer being left off the list by a setup mistake without ever silently rewriting a list the governor deliberately set. If `admin()` cannot be read — the asset is not a SAC with a readable admin, or has none (an immutable issuer) — the check is skipped, and `open_series` relies on the must-be-set rule above alone.

This is not a stand-in the way the testnet admin key stands in for Governor's signature scheme: it uses the same trust model every other governor-gated call in the four merged contracts already uses (an address the contract is told is "the governor," never Governor's own internals), so there is no rework needed once a real `Governor` exists. **The setter stays on `MarketFactory`, with `Governor` simply being the address that calls it, the same way every other governor-gated function in this build already works** (PR #64 review, answering open question 2 from the first draft: no move, even once a real `Governor` exists).

## 7. Lazy sync, trigger, and Finalized (lead decision)

Three points the spec's prose leaves to infer, stated explicitly so the implementation and the property test in Section 15 agree on the same behavior:

- **`sync()` is the one place every transition in Section 1 is decided**, from stored timestamps and `EventRegistry` state, never from the time of the call itself. `trigger()` calls the same `sync_state()` and then asserts the result is `Triggered`, returning `event_id`; it has no transition logic of its own. This also means lazy syncing cannot change the final outcome of a given sequence of external events, regardless of when (or how many times) anyone happens to call something — stated as invariant I24 below, because the alternative (an outcome that depends on timing of an unrelated, permissionless call) would be a real bug, not a cosmetic one.
- **Nothing proactively calls `sync()` on a dormant series.** Exactly like `EventRegistry.checkpoint_cure` (issue #20's own precedent), this is an operational responsibility: the keeper service (today, the `sylox-live-poster` Railway cron) calls `sync()` on every live series it knows about, as routine upkeep, the same way it will eventually call `checkpoint_cure` on every live Depeg event. This needs no code change here, only a line in that service's own scope once it exists.
- **Every read computes the logical state live, never trusting possibly-stale storage.** `state()` runs the same `sync_state()` logic (without committing a write if nothing changed) before returning, so a UI or indexer reading a series nobody has touched in weeks still sees the correct state, even though the contract's own stored `SeriesState` might lag until the next write.
- **`Finalized` is reached automatically, via `sync()`,** the moment the series' own tracked balance identity (Section 10.3) reaches exactly zero while in Triggered or Expired: `total_collateral + total_premium - total_paid - total_withdrawn == 0`. This is an O(1) check against aggregates `Series` already tracks, never an iteration over every seller's position, and is exact under invariant I3 — a direct donation can only ever push the real token balance above this computed zero, never below it, so a donation can never block reaching Finalized, only make the "balance ≥ expected" slack larger. Once Finalized, every write function returns `WrongSeriesState`; reads keep working until the entries' own TTL eventually lapses (Section 3).
- **A direct token donation to a series already Finalized is stranded (PR #64 review).** No function can move funds out once Finalized, so a donation arriving after that point has no path back out — no sweep exists. Acceptable for v1; stated here as a known limit so nobody later assumes one does.

## 8. Quote tie-breaking (lead decision)

Section 9.3/9.4 specifies "walk quotes from cheapest" but not which of two quotes at the same `rate_bps` fills first.

**Decision:** FIFO by `(rate_bps, sequence)`, where `sequence` is a new `u64` field on `Quote`, assigned from a per-series monotonic counter the moment a quote is created. Changing an existing quote's rate or size is **not** an update in place — it is treated as cancelling the old quote and creating a new one, which gets a fresh `sequence` and goes to the back of its new rate tier. A partially filled quote keeps its original `sequence` and its place in line for its remaining `available` amount. This is simple, matches how a real order book usually breaks a price tie, and gives re-quoting no way to jump ahead of an existing quote at the same rate.

## 9. The Series → Treasury fee deposit (lead decision)

Section 12.7 already specifies the pattern `buy_cover`'s fee deposit needs: "When a contract is the `from`, it authorizes the nested USDC transfer with `env.authorize_as_current_contract` before the call" — the same two-hop problem `Staking.deposit_treasury_share` already solves (`staking/src/lib.rs:1143`), because `Treasury.deposit`'s own `from.require_auth()` is a second hop past `Series`' direct call into it, which Soroban does not auto-authorize.

**Decision:** extract `deposit_treasury_share`'s authorization logic into `sylox_types` now, as its own tiny PR before `feat/markets`, used by both `staking` and `series` — a pure refactor, no behavior change, with `Staking`'s existing tests passing unchanged. The contracts agent is editing `Staking` for `upgrade()` (issue #12) concurrently; whichever of the two PRs merges second rebases onto the other. The diff inside `staking` itself stays as small as possible: replace the body of `deposit_treasury_share` with a call into the new shared helper, nothing else.

## 10. Closing `version_has_live_cover`

`EventRegistry::version_has_live_cover` (`event-registry/src/lib.rs:644`) is a single stand-in function returning `false` unconditionally, exactly as `docs/design/event-registry.md`'s own deviation 15 promised: "there is exactly one place to change when `MarketFactory` ships."

**Revised (PR #64 review, point 1): `MarketFactory` tracks the pinned (asset, kind, version) set itself, rather than `EventRegistry` loading every live `Series` instance to ask.** The first draft of this note had `version_has_live_cover` call `MarketFactory.series_for(asset)` and then `Series.terms()` on each returned address. The review correctly found this wrong on two counts: it makes `EventRegistry` depend on `Series`' own interface for a question that is really about `MarketFactory`'s own bookkeeping, and it costs one cross-call per live series on the asset (up to `max_series_per_asset`, 4) every time `propose_tier1` or `register_definition` needs an answer, instead of one.

`MarketFactory` gains:

- `Pins(series)`, persistent, a `Map<EventKind, u32>` — a copy of `terms.def_versions`, written once at `open_series` time (the factory already has `terms` as that call's own argument, so this costs no extra read).
- `LiveCoverCount(asset, kind, version)`, persistent, `u32` — incremented by one for each `(kind, version)` entry in `Pins(series)` when `open_series` deploys that series; decremented by one for each entry in that series' own `Pins(series)` when `release_cover` drops it from the live list (Section 1), which also then removes `Pins(series)` itself. Both updates happen together, inside the same two functions that already touch the live-series bookkeeping — no new call site elsewhere.
- `has_live_cover(asset: Address, kind: EventKind, version: u32) -> bool`, a new read: `LiveCoverCount(asset, kind, version) > 0`.

`version_has_live_cover`'s replacement becomes one call, with no dependency on `Series`' interface at all:

```rust
fn version_has_live_cover(
    env: &Env, config: &Config, asset: &Address, kind: EventKind, version: u32,
) -> bool {
    MarketFactoryClient::new(env, &config.factory).has_live_cover(asset, &kind, &version)
}
```

No signature or call-site change anywhere else in `EventRegistry`: both callers (`register_definition`'s `DefinitionInUse` guard, `propose_tier1`'s non-canonical-version acceptance check) already call this function and nothing else. `Config.factory: Address` is already wired through `initialize` and every test fixture as a placeholder, per that note's own design. This lands as the last, separate commit of the implementation PR, since it changes an already-deployed contract and reaches testnet through `upgrade()` rather than a redeploy.

**Conservative edge case, stated plainly (PR #64 review, point 1):** `LiveCoverCount` only decrements when `release_cover` actually runs, which — like every other transition in Section 1 — is lazy. A series that reached Expired or Triggered wall-clock-wise, but that nobody has synced since, still counts as pinning its version until its next `sync()`. This means `has_live_cover` can occasionally say "yes" for a series that, strictly, should already be done — never the other way around. That is the conservative direction to err in (a version that should still count as live is never prematurely reported as free), so it is accepted as-is, not treated as a bug to work around.

## 11. Cost estimate: `buy_cover`

**This is a worst-case estimate, not a measurement** — no code exists yet to run a real budget test against. The implementation PR's own budget test (Section 15) must confirm or correct every number here; nothing below should be treated as load-bearing until it does.

Worst case: 64 quotes from 64 **distinct** sellers, each offering exactly enough that a single `buy_cover` call fills all 64 (the structural maximum `Quotes`' own 64-entry cap allows), with a `PriceGuard` configured for the asset.

| Dimension | Estimate | Basis | Limit | Margin |
| --- | --- | --- | --- | --- |
| Footprint entries | ≈ 82 | `cover_gate` (9, measured, `event-registry/src/budget_test.rs`) + `Series` instance (1) + `Position(seller)` × 64 (the dominant term) + `Series`' own USDC balance (1) + `MarketFactory.reserve_cover` (`Deployed`, `OpenCover`: 2, plus `Ring(asset)` read via `cover_cap`→`median_liquidity`: 1) + `Treasury.deposit` (instance, USDC balance: 2) + cover token `Balance(buyer)` mint (1) + `PriceGuard.check` (1, worst case) | 400 | ≈ 4.9x |
| Write entries | ≈ 70 | Same as above, minus the pure reads (`cover_gate`'s 9, `Deployed` membership check, `median_liquidity`'s own `Ring(asset)` read) | 200 | ≈ 2.9x |
| Write bytes | ≈ 20,400 | `Series`' own instance entry rewrite, full (`Terms` + `State` + `Totals` + the entire 64-quote book — ≈10,400 bytes, conservatively ~150 bytes per `Quote` entry including its new `sequence` field and XDR/`ScMap` field-name overhead) + 64 × `Position(seller)` persistent writes (≈9,600 bytes, ~150 bytes each) + `Series`' and `Treasury`'s own USDC balance writes plus `Treasury`'s instance write (≈350 bytes) + the cover token's `Balance(buyer)` mint (≈100 bytes) | 132,096 | ≈ 6.5x |
| Instructions | **gap, see below** | `cover_gate`'s own measured 9,602,712 at its structural cap, plus a reasoned allowance for the 64-fill walk and three cross-contract calls (`MarketFactory`, `Treasury`, the token transfers), by analogy with `EventRegistry`'s own measured cross-contract overhead (≈8.2–8.6M instructions for 2-3 hops, Section 15.3), **excluding `median_liquidity`'s own cost** | 400,000,000 | unknown until measured |
| Memory | **gap, see below** | `cover_gate`'s own measured 1,762,761 bytes at its structural cap, plus 64 small `Position` reads/writes, **excluding `median_liquidity`'s own cost** | 41,943,040 | unknown until measured |

The dominant, least-certain term is the count of **distinct** sellers filled in one call — a realistic buy against a thin book (one or two large quotes) costs a small fraction of this; the number above is the structural ceiling the 64-quote cap allows, not a typical case. The real implementation PR's budget test should measure exactly the worst-case scenario stated above, not an average one, mirroring how `event-registry/src/budget_test.rs` measures its own gate at 73 unbuilt hours rather than a typical few.

**Write bytes (PR #64 review, point 3), not tight at this estimate's own margin.** The dominant term is `Series`' own instance entry, which rewrites in full on every `buy_cover` call regardless of how many quotes that particular call fills — exactly the way `RiskOracle.Ring(asset)` already pays its own full entry size (not a diff) on every `post_signals` call, Section 15.3's own measured example. That cost scales with how FULL the 64-quote book is, not with how much of it a given call touches. If a real measurement later shows this tighter than estimated here, the mitigation is moving `Quotes` out of the shared instance entry into its own persistent key (keyed by the series), so a call that fills only a handful of sellers does not also pay to rewrite the whole book. Not done here, since the margin above does not call for it — and it would not even help if `buy_cover` must decrement a filled quote's own `available` field to keep the book accurate after a fill (an implementation detail for the build PR, not decided here), since that still touches `Quotes` on every fill regardless of which entry it lives in.

**Gap found in review (PR #67 review): the first draft of this estimate omitted `RiskOracle.median_liquidity`'s own cost entirely.** `reserve_cover` calls `cover_cap`, which calls `median_liquidity` — a real cross-contract read of the asset's full `Ring(asset)` entry (one footprint entry, already added to the table above) that then builds a 168-value window and takes its median (real instructions, not yet measured; `risk-oracle` has no existing budget test for this specific function to cite). This happens inside every `buy_cover` call, not only at series-opening time. The instructions and memory rows above are marked as gaps rather than given placeholder numbers, because `median_liquidity`'s own cost is unmeasured, not merely estimated by analogy like the rest of this table. The implementation PR's `buy_cover` budget test must populate `RiskOracle` with a full 168-slot ring before measuring the worst case, so this path is genuinely exercised, and this table's instructions/memory rows get filled in with the real measured totals once that test exists, not left as the open question this draft leaves them.

## 12. New error codes

Appended at the end of each contract's own range, per Section 14's convention:

| Code | Name | Contract | Meaning |
| --- | --- | --- | --- |
| 406 | `AlreadyMigrated` | MarketFactory | `migrate()` called again after the contract's own current `CONTRACT_VERSION` was already applied; `migrate()` takes no argument and always targets that constant, never a caller-chosen version (Section 5) |
| 407 | `RelatedSellerListNotSet` | MarketFactory | `open_series` for an asset whose related-seller list has never been set (Section 6) |
| 408 | `IssuerNotListed` | MarketFactory | `open_series` for an asset whose SAC `admin()` is readable but not present in that asset's related-seller list (Section 6) |
| 517 | `FeedBehind` | Series | `buy_cover` rejected: the newest posted sub-epoch is older than the last closed one, outside `feed_grace_secs` (Section 2, M1) |

`FastSignalPause` (516) and `RelatedSeller` (510) already exist in Section 14's table and are reused as written, not duplicated.

## 13. Invariants

| Id | Invariant | Primary test |
| --- | --- | --- |
| I1 | Total cover units ≤ sum of sellers' collateral | Property test, after every op |
| I2 | Per seller, `cover_written <= collateral` | Unit test on every fill path; property test |
| I3 | USDC balance of a series ≥ expected balance (Section 10.3) | Assert `token.balance(series) >= expected` after every operation in every test |
| I4 | Cover units minted only in Open, only against a real fill | Unit test: `buy_cover` outside Open rejects before any mint; property test |
| I5 | Payouts only in Triggered, only for an event that covers the series | Unit test: `claim`/`claim_for` outside Triggered rejects; day-88 integration scenario |
| I6 | Premiums not withdrawable before Triggered or Expired | Unit test: `withdraw` in Open/Closed caps at `collateral - cover_written`, never includes `premium_earned`; property test |
| I9 | Sum of open cover per asset ≤ asset cap at purchase time, checked and reserved in one call | Unit test: concurrent-style `reserve_cover` calls against a tight cap; no separate read-then-reserve path exists to race |
| I10 | No role moves USDC out of a series except seller withdraw, holder claim, or the `Treasury` fee at purchase | Property test's own balance accounting; code review that no other `token.transfer` call site exists in `Series` |
| I11 | Series terms, including pinned definition versions, never change after `open_series` | Unit test: no `Series` function ever writes `Terms` after the constructor |
| I13 | Every live series pins the current canonical definition version of each kind it covers | Unit test on `open_series`'s `DefinitionNotCurrent` check; integration test with a definition superseded mid-series-life |
| I24 (new) | `sync()` is idempotent and order independent: the same sequence of external events (deposits, quotes, buys, a Declared event, time passing) produces the same final `SeriesState` and the same final balances regardless of when, or how many times, anything calls a state-changing function or `sync()` relative to those events | New property test variant: run the same event sequence twice, once syncing after every step and once syncing only once at the end; assert identical final state and balances |
| I25 (new) | No deposit or position transfer ever succeeds for an address on the asset's related-seller list, and `open_series` never succeeds for an asset whose list was never set, or whose readable issuer is not on it | Unit tests: a blocked deposit, a blocked transfer, `open_series` refusing an unset list and refusing an unlisted readable issuer; only the governor can change the list |
| I26 (new) | `LiveCoverCount(asset, kind, version) == ` the number of series currently in `MarketFactory`'s own live list whose `Pins(series)` maps `kind` to `version` (Section 10) | Property test: after every `open_series`/`release_cover`, recompute the count from a shadow map over every live series' own `Pins` and assert equality |

I1, I2, I3, I4, I5, I6, I9, I10, I11 and I13 are this build's share of Section 21.1's existing invariants; I24, I25 and I26 are new, introduced by this design note the same way the v1.5 sub-epoch revision introduced I21–I23.

## 14. Attacks

| Attack | What stops it |
| --- | --- |
| Re-quoting to jump a price tier's own queue | FIFO by `(rate_bps, sequence)`; changing a quote's rate or size is a new quote with a fresh `sequence`, sent to the back (Section 8) |
| The issuer, or a declared affiliate, selling cheap cover on its own asset | The related-seller block list, checked on both `deposit` and `transfer_position` (Section 6), not deposit alone |
| The issuer left off its own asset's related-seller list by a setup mistake | `open_series`'s `IssuerNotListed` check against the SAC's own readable `admin()` (Section 6) |
| A keeper's ordinary posting lag spuriously blocking every sale | `feed_grace_secs` (M1, Section 2) tolerates one sub-epoch's worth of normal lag |
| A compromised or misbehaving `PriceGuard` freezing the whole market | `PriceGuard` only ever gates a new sale; it is never consulted by `claim`, `trigger`, or `withdraw` (M2, Section 2) |
| Buying cover the instant before a failure that is already underway | `cover_gate`'s existing informed-buying block (`EventInProgress`, `RecentDepeg`, `RecentEndpointOutage`, `RecentIssuerAction`, `UnbuiltBacklog`) plus coverage keyed to the failure's own window start (Section 8.6), inherited unchanged from `EventRegistry` |
| A dormant series' stale on-chain `SeriesState` misleading a reader | Every read runs the same live `sync_state()` logic before returning (Section 7); storage lag never changes what a read reports |
| Position transfer used to dodge the related-seller block list | `transfer_position` checks the list on the recipient, exactly as `deposit` does (Section 6) |
| A contract bug draining more than one series' own pool | Each `Series` is its own isolated instance, not upgradeable, holding only its own collateral and premiums (Section 17.3, I1-I3, I10) |

## 15. Test plan

Unit: every function and error path on both contracts, including the new ones (`AlreadyMigrated`, `RelatedSellerListNotSet`, `IssuerNotListed`, `FeedBehind`); every `buy_cover` rejection path in the order Section 2/9.4 lists them (stale, Distress/Event band, every `cover_gate` variant, `FeedBehind`, `FastSignalPause`, the series cap, the buyer cap, `require_holding`); the quote tie-break rule including a re-quote and a partial fill keeping its place; `transfer_position`'s `RecipientHasPosition` and related-seller rejections; every `open_series` rejection in Section 9.7's order plus `RelatedSellerListNotSet` and `IssuerNotListed` (both for a readable-admin asset and for one whose admin cannot be read, confirming the check is skipped rather than failing closed); `sync()`/`trigger()`/`state()` agreeing on the same result regardless of which one is called; `Finalized` reached exactly when the balance identity hits zero, not before, and not via any other path; a donation to an already-Finalized series confirmed unmovable by any function; `migrate()` called twice returns `AlreadyMigrated` the second time, with no argument to vary; `has_live_cover` true immediately after `open_series`, false immediately after `release_cover`, for the exact `(kind, version)` pairs in that series' own `def_versions`.

Scenario: the day-88-of-90 depeg (Section 8.6, 21.3), as a full integration test with the real `RiskOracle`, `EventRegistry`, `MarketFactory` and `Series` at a realistic epoch base (≈497,000) — depeg starts day 88 of a 90-day series, the series goes Pending at expiry, the event is proposed and finalized, the series triggers, the buyer claims in full, the seller withdraws collateral minus cover written plus premiums; the Section 10.5 worked example reproduced to the base unit (premium 369.87/295.90 USDC per fill, fee ≈49.94, both no-event and event-declared payout paths); a definition version superseded while a live series still pins the old one (closing `version_has_live_cover` via `has_live_cover`, Section 10); the conservative edge case from Section 10 itself: a series past expiry that nobody has synced still reports `has_live_cover` true until its next `sync()`; a dormant series synced only once, long after expiry, landing in the correct state in one call; `claim_for` after the claim window; premiums rejected from withdrawal before Triggered or Expired.

Property (`proptest`, matching `staking`/`treasury`'s own convention): random sequences of `deposit`, `quote`, `cancel_quote`, `buy_cover`, `withdraw`, `transfer_position`, `trigger`, `claim`, `claim_for`, `sync`, checking every `try_` result (an ignored result proves nothing) against I1–I6, I9, I10, I11, I13, I24 after every step; a second run comparing a fully-synced-every-step trace against a synced-once-at-the-end trace of the identical event sequence for I24; a shadow-map run across `open_series`/`release_cover` for I26.

Budget: `buy_cover` at the Section 11 worst case (64 distinct sellers, one quote each, `PriceGuard` configured), against `sylox_types::network_limits`, including write bytes alongside footprint, write-entry count, instructions and memory; WASM size for both contracts under CI's 128KB gate.

## 16. Deviations, with reasons

1. **The related seller block list lives on `MarketFactory`, not `Governor`** (Section 11.5, Section 6): `Governor` does not exist yet. Uses the same governor-address trust model every other governor-gated call in the four merged contracts already relies on, so no rework is needed once a real `Governor` lands — the setter stays on `MarketFactory` even then (Section 6, PR #64 review, answering open question 2 from the first draft).
2. **`Quote` gains a new `sequence: u64` field**, not present in `sylox_types::series::Quote` today (Section 8): needed for a deterministic, fair tie-break rule the spec leaves unspecified for quotes at the same `rate_bps`.
3. **`SeriesState::Finalized` is reached by a balance-identity zero-check, never by an explicit scan of positions** (Section 7): the spec states Finalized's meaning ("all seller balances withdrawn") but not a cheap way to detect it; iterating every position is unbounded and unsafe, while the already-tracked aggregate balance identity (Section 10.3) gives an exact, O(1) equivalent.
4. **`trigger()` has no transition logic independent of `sync()`** (Section 7): the spec describes `sync_state()` as already performing the event-driven move to Triggered as a side effect of every state-changing call; `trigger()`'s role is to let anyone force and confirm that check, consistent with this codebase's existing permissionless-forcing-function pattern, not a second, separately-implemented path to the same state.
5. **`Series` → `Treasury`'s authorization helper moves into `sylox_types`, shared with `Staking`** (Section 9): the pattern itself is already specified (Section 12.7); only its location changes, from private to `staking` to shared, to avoid a third, divergent copy once another caller needs it.
6. **`version_has_live_cover` queries `MarketFactory`'s own pin-counting (`Pins`/`LiveCoverCount`/`has_live_cover`), not `Series.terms()` directly** (Section 10, PR #64 review, point 1): the first draft of this note had `EventRegistry` call `MarketFactory.series_for` and then `Series.terms()` on each returned address. The review correctly found this makes `EventRegistry` depend on `Series`' own interface for a question that belongs entirely to `MarketFactory`'s bookkeeping, and costs one cross-call per live series instead of one call total.
7. **TTL extension on read is narrowed to `Position(seller)` inside `withdraw`/`transfer_position`/`buy_cover` only, never the cover token's `balance(holder)`** (Section 3, PR #64 review, point 2): the first draft of this note extended on any "hot-path read," which wrongly included the SEP-41 `balance` read — a path wallets call almost entirely through simulation, where nothing is saved anyway, and which must stay a true, zero-storage-cost read even inside a real transaction.
8. **The `upgrade()`/`migrate()` helper signatures changed to match review of #63** (Section 5, PR #64 review, point 5): `do_upgrade`/`do_migrate` now take `governor` (not `admin`) and `current_version`/a migration key explicitly, and the per-contract `migrate()` wrapper takes no caller-supplied argument, always targeting the contract's own `CONTRACT_VERSION` — a caller-chosen version could otherwise mark a future migration as already done.
9. **A new `IssuerNotListed` check in `open_series`, against the covered asset's own readable SAC `admin()`** (Section 6, PR #64 review, answering open question 1 from the first draft): not an automatic add to the list (which could silently override a deliberately different governor-set list), but a check that the list, once set, actually contains the issuer when that address is discoverable.
10. **A direct donation to an already-Finalized series is stated as permanently stranded, not a gap to fix** (Section 7, PR #64 review, point 6): no function can move funds out of a Finalized series, so a late donation has no path back out; acceptable for v1.
11. **Write bytes added to the Section 11 cost estimate, alongside footprint entries, write entries, instructions and memory** (Section 11, PR #64 review, point 3): the first draft of this note omitted `TX_MAX_WRITE_BYTES`, the limit flagged as most likely to bind, given the `Series` instance's own full-entry rewrite cost scaling with how full the 64-quote book is.
12. **`hard_cap`/`liquidity_cover_ratio` confirmed as the right home and the right defaults** (Section 6, PR #67 review): `liquidity_cover_ratio` is a protocol-wide parameter (Section 17 shows it set via `SetParam`), so `MarketFactory` is the correct place for it, not a per-asset one. A per-asset `hard_cap` defaulting to `i128::MAX` is safe specifically because the liquidity term in `cover_cap`'s `min(...)` always applies regardless, and `RiskOracle.median_liquidity` itself returns `0` before an asset has 168 hours of history — so a brand new asset with no history cannot sell any cover at all yet, with or without a governor-set `hard_cap`, closing the gap a naive reading of "defaults to unlimited" might otherwise suggest.
13. **`MarketFactory` uses `__constructor`, not `initialize`** (Section 5, issue #21, PR #66, required in PR #67 review): the first draft of this note (and `open_series`'s own stub signature) carried `initialize`, matching the spec's own Section 12.4. #66 moved all four core contracts off `initialize` onto a constructor instead, since a separate `initialize` call leaves a real front-runnable window between deployment and first use. `MarketFactory` has the identical problem and is not a special case, so it follows the same fix: config stored directly in `__constructor`, with no calls to any other contract from inside it, exactly as the four core contracts' own constructors already do. `Series` already used a constructor per Section 12.5, so this makes the pattern consistent across every contract this build touches, not just the four existing ones.
14. **`EventRegistry` gains a one-time, governor-only `set_factory(address)`, locked after its first successful call** (Section 10, required in PR #67 review): closing the last wiring piece — `EventRegistry`'s existing `config.factory` is a placeholder (Section 10's own `version_has_live_cover` replacement needs the REAL `MarketFactory` address, which does not exist until this build's own last commit deploys it). The lock is a dedicated one-time-use flag in its own storage key, never a comparison against a hardcoded placeholder address: `set_factory` succeeds only if that flag has never been set, then sets `config.factory` and the flag together, permanently. A new error, `FactoryAlreadySet`, rejects every call after the first. Tested both ways: the first call succeeds and is read back; a second call, including one naming a different address, is rejected.
15. **`PriceGuard`'s per-asset address is configured on `MarketFactory`, not `Series`** (Section 2, M2): the spec names the mechanism (`buy_cover` checks it, skipping entirely when none is configured) but never says where that address lives. `Series`' own constructor signature is already fixed by Section 12.5 and carries no governor address, so a guard cannot be set directly on `Series` without deviating from that signature; storing it on `MarketFactory` instead reuses the exact governor-settable, per-asset pattern `RelatedSellers` and `HardCap` already establish, with `None` (no guard configured) as the safe, spec-matching default.

## 17. Resolved in review

The three open questions from the first draft are answered above, folded into the sections they concern rather than left standing here: the issuer-listing question in Section 6 (an `IssuerNotListed` check against the asset's readable SAC `admin()`, not an automatic add to the list), the related-seller setter's home in Section 6 (stays on `MarketFactory`; no move once a real `Governor` exists), and the upgrade-helper coordination in Section 5 (code against the agreed signatures now, rebase onto #12/#63 when either lands, don't wait). No open questions remain.

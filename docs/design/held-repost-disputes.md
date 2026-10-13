# Held repost disputes design note

Status: Draft, for review before any contract code · Date: October 13, 2026

Source: issue #92; technical-doc.md v1.5 Section 5.9 S2, S3, S4, S5, 15.2, 15.3; #89 (history TTLs, sibling re-extension on overturn); #93 (`sub_epoch_secs_at`, change spacing); `contracts/risk-oracle/src/lib.rs` (`post_sub_signals`, `dispute_sub_signals`, `resolve_sub_signal_dispute`, `resolve_sub_dispute_timeout`, `sub_disposition`, `ensure_hour_held`, `refresh_waiting_hour`); `contracts/risk-oracle/src/storage.rs` (`HeldSubSlot`, `insert_held_sub_slot`, `sub_slot_still_belongs_to`, `overturn_sub_signals`); `contracts/staking/src/lib.rs` (`lock_bond`, `release_bond`, `forfeit_bond`).

Scope: letting a sub-epoch repost that was written to `HeldHour(asset, hour)` be disputed, and what that does to resolution, the timeout, the hour build, the gate's footprint, the worst-case timeline and the TTLs #89 set.

Out of scope: any code (this note only); editing technical-doc.md (the spec changes the chosen option needs are listed in Section 6, for the implementation PR); the hourly path, which has no ring span problem (Section 1.3); anything on testnet.

Section 7 lists the questions this note needs answered. technical-doc.md itself is not edited by this note.

## 1. The problem

### 1.1 What happens today

`dispute_sub_signals` finds the sub-epoch only through `Sub(asset)`:

```rust
let slot = storage::get_sub_slot(&env, &asset, sub_start).ok_or(Error::WrongEpoch)?;
```

An overturn clears the sub-epoch's ring position (`clear_sub_slot`). A repost then writes into the ring only while that position still belongs to `sub_start` (`sub_slot_still_belongs_to`): either the position already holds `sub_start`, or it is `Empty` and `now < sub_start + SUB_RING_SLOTS * SUB_EPOCH_GRID_SECS` (60 x 300 s = 18,000 s, 5 hours). Any later repost is written to `HeldHour(asset, hour)` only. From then on `get_sub_slot` misses, and `dispute_sub_signals` returns `WrongEpoch`.

The repost is otherwise complete. `post_sub_signals` writes its `SubSignals`, marks the overturn reposted, and inserts a `HeldSubSlot` with `state: Pending` and its own `pending_until` (repost time plus `SIGNAL_DISPUTE_SECS`, 2 hours). It stays Pending for 2 hours, becomes effectively Final, and the hour builds from it. Nothing can challenge it.

### 1.2 Evidence

A probe against `RiskOracle` with a full 12 sub-epoch hour (issue #92):

1. Post sub-epochs 0 to 11 at their closes, with sub 0 wrong.
2. Dispute sub 0 at the hour's close.
3. Overturn it just before the 6-day ruling deadline (`resolve_sub_signal_dispute(.., false, ..)`).
4. Repost sub 0 within its repost window (`max(sub_close, overturned_at) + sub_backfill_secs`). The repost is accepted and lands in `HeldHour`.
5. Dispute the repost 60 seconds later.

```
ring slot for the repost: None
dispute repost: Err(Ok(WrongEpoch))
```

The same flow on `main` today, measured for this note, gives the same `Err(Ok(WrongEpoch))`.

### 1.3 Which reposts are affected

Whether a repost lands in the ring depends only on when it is posted relative to `sub_start`:

| Repost time | Where it is written | Disputable today |
| --- | --- | --- |
| `now < sub_start + 5 h` (ring position still `sub_start`'s, or `Empty` within its span) | `Sub(asset)`, plus `HeldHour` if the hour is held | Yes |
| `now >= sub_start + 5 h` | `HeldHour` only | **No** |

A repost follows an overturn, and an overturn follows a dispute that opens after the sub-epoch closes. So a repost stays disputable only when the committee rules within roughly 4 to 5 hours of the sub-epoch's start. `SIGNAL_DISPUTE_RULING_SECS` is 6 days, so a slow ruling, and therefore a held repost, is the expected case rather than an edge case.

The hourly path has no equivalent gap. An hourly repost must pass `check_epoch_window` (3 days), and `Ring(asset)` holds 240 hours, so a repost's slot is always in the ring when its dispute opens.

## 2. What the existing code already gives us

Four facts shape every option below.

- **A held repost already carries what a dispute needs.** Its `HeldSubSlot` has `state: Pending` and its own `pending_until`, and its `SubSignals(asset, hour, sub)` entry exists. Only the lookup in `dispute_sub_signals` is missing.
- **Once an hour is held, `HeldHour` is already the only source of truth for it.** `sub_disposition` reads `HeldHour` first whenever it exists for the hour and never falls back to the ring for that hour. A missing entry in a held hour means overturned (or never posted), not "look in the ring". Every post into a held hour, a ring repost included, also writes its `HeldHour` entry. `dispute_sub_signals` is the one reader that does not follow this rule.
- **Every ring write on the dispute paths is guarded by identity.** `set_sub_slot_state` and `clear_sub_slot` return without writing when the position holds a different `sub_start`. `resolve_sub_signal_dispute` and `resolve_sub_dispute_timeout` already write the held entry too (`set_held_sub_slot_state`, `remove_held_sub_slot`), so both work unchanged for a held repost (Section 4 confirms this by measurement).
- **The bond key is free again.** The repost's dispute locks `BondKey::SignalDispute(asset, sub_start)`, the same key as the first dispute. `Staking.release_bond` and `forfeit_bond` both `clear_bond`, so `lock_bond` does not hit `BondExists` the second time.

## 3. Options

### 3.1 Option A: `dispute_sub_signals` reads `HeldHour` first (recommended)

Give `dispute_sub_signals` the same precedence `sub_disposition` uses: if `HeldHour(asset, hour)` exists, the sub-epoch's state and `pending_until` come from its entry there, and a missing entry is `WrongEpoch`. Only an hour that has never been held reads the ring, as today.

| Area | Change |
| --- | --- |
| Storage | None. No new key, no new field. |
| `dispute_sub_signals` | Read `get_held_hour` before the ring (it already reads it later, in `ensure_hour_held`). Take `state`, `pending_until` and the roll-up fields from the held entry when the hour is held. Every check after that is unchanged: Pending only, before `pending_until`, no open `SubDispute`. Then the same writes as today: `SubDispute`, bond, ring state (a guarded no-op for a held repost), held entry set to `Disputed`. |
| `resolve_sub_signal_dispute` | None. Keeper wins: held entry to Final, ring write is a no-op. Overturn: `remove_held_sub_slot`, `overturn_sub_signals` (with #89's sibling re-extension), ring clear is a no-op. The second overturn's record starts `reposted: true` through `SubRepostUsed`, so no third posting. |
| `resolve_sub_dispute_timeout` | None. Same writes as keeper wins. |
| `build_hour` / `refresh_waiting_hour` | None. A disputed held entry reads `Disputed`, so the hour waits; once resolved it reads Final or missing, and the hour builds in the same call. |
| Gate footprint (Section 15.3) | Unchanged. `cover_gate` never reads `HeldHour` (Section 5.9 S5), and this option adds no read to the gate path. Its 9 keys stay fixed at any hour count. |
| `dispute_sub_signals` footprint | No new key: `HeldHour(asset, hour)` is already in the footprint through `ensure_hour_held`. Measured reads are 27 before and after (Section 4). |

### 3.2 Option B: every repost writes only to `HeldHour`

Stop writing reposts to the ring at all, so a repost always lives in `HeldHour` with its own `pending_until`, and dispute it there.

- Storage and the dispute path need everything in Option A, because the dispute still has to find the held entry. B is A plus one more change.
- **It costs gate sensitivity.** Inside the 5-hour span the gate reads `Sub(asset)` through its one batched call, at sub-epoch granularity. A fast repost written only to `HeldHour` would be invisible there, so a depeg in a corrected sub-epoch would be missed until the hour's provisional roll-up in `Ring(asset)` reflects it, rather than within one `sub_epoch_secs`.
- Footprint and the timeline are as in A. It gains nothing over A.

### 3.3 Option C: a separate `dispute_held_sub_signals` entry point

The same logic as A behind a new function, so the existing function keeps its exact behavior.

- It needs a new SDK binding and keeper and app changes to pick the right function, and a disputer must know which one applies. The two must stay consistent forever.
- It gains nothing in safety: A already keeps the ring path for every hour that has never been held, byte for byte.

### 3.4 Options considered and dropped

- **Rewriting the repost into its old ring position after the span.** That position belongs to a newer sub-epoch by then (`sub_slot_still_belongs_to`), and overwriting it breaks the ring's newer-wins rule and the gate's reads.
- **Making reposts wait for a committee approval.** That is a new flow for the committee and slows every honest correction, to cover a gap a lookup fixes.
- **Shortening the ruling window below the ring span.** 5 hours is not a realistic ruling time, and it would change the dispute economics for every sub-epoch.

## 4. Measurement (Option A prototype)

I prototyped Option A in a scratch worktree (about 20 lines in `dispute_sub_signals`, not committed) and ran the full flow against the real `RiskOracle` with `MockStaking` and `MockGovernor`, time and ledger sequence moving together at 5 seconds per ledger. All three flows complete, and every sibling `SubSignals` entry is still live at the build.

| Call | `main` instructions | Option A instructions | Reads | Writes | Write bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| First dispute against a full hour (copy-out of 12) | 4,991,372 | 5,000,437 (+0.18%) | 27 / 27 | 7 | 38,728 |
| Overturn 1, near the 6-day deadline (#89 sibling re-extension) | not changed by A | 3,849,967 | 32 | 11 | 39,044 |
| Held repost | not changed by A | 3,631,788 | 29 | 8 | 33,880 |
| **Dispute of the held repost** | `WrongEpoch` | **3,292,725** | 27 | 5 | 31,740 |
| Keeper wins on the held repost (hour builds, 12.12 days) | n/a | 6,106,395 | 44 | 22 | 36,984 |
| Overturn 2 of the held repost (12.12 days) | n/a | 6,471,106 | 46 | 25 | 37,832 |
| Late timeout of the held repost (hour builds, 13.11 days) | n/a | 6,076,042 | 43 | 22 | 37,052 |

- The largest call is 1.6% of `tx_max_instructions` (400,000,000). Write bytes stay under 30% of `tx_max_write_bytes` (132,096).
- The first dispute's `fee.total` moves by 7 stroops (16,075,735 to 16,075,742).
- The held repost's dispute costs 2,608,225 stroops in `fee.total`.
- The three closing calls show 289,090,904 to 318,096,932 stroops in `fee.total`, which is not a cost of this change. In the test the ledger has aged 12 to 13 days, so those calls are the first to re-extend the instance and long-lived entries after their thresholds. A live network pays that rent on its regular cadence whatever the dispute path does.

## 5. Worst-case timeline and TTLs

### 5.1 Timeline once held reposts are disputable

With `t0` the original sub-epoch's post:

| Step | Latest time |
| --- | --- |
| Dispute 1 (before `pending_until`) | `t0 + 2 h` |
| Overturn 1 | 6-day ruling: `t0 + 6 d 2 h`. `resolve_sub_signal_dispute` has no deadline check of its own, only `SubDispute`'s 7-day TTL, so a late committee can overturn up to `t0 + 7 d 2 h` |
| Repost (repost window) | overturn 1 + 2 h |
| Dispute 2 (before the repost's `pending_until`) | repost + 2 h |
| Ruling or timeout on dispute 2 | dispute 2 + 6 d for a ruling on time, up to dispute 2 + 7 d for a late timeout or late ruling |

| Path | Hour builds after `t0` |
| --- | --- |
| Both rulings on time (the spec's figure) | about 12.33 days (1,065,600 s) |
| Ruling 1 on time, late timeout on 2 (the brief's 13.2) | about 13.3 days |
| Both late (overturn 1 at 7 days, late timeout on 2) | about 14.25 days |

The 14.25-day path is beyond the two figures in the brief. It exists today on paper and becomes reachable with this fix. Question 2 asks whether to close it.

### 5.2 Coverage by #89's sibling re-extension

The build reads every other sub-epoch's `SubSignals` through `hash_sub_epoch_inputs` and `reward_sub_epoch_keepers`. Those siblings were written around `t0`, with 10 days.

- At overturn 1, `overturn_sub_signals` re-extends each sibling with `HISTORY_TTL_THRESHOLD` (8 days) and `HISTORY_TTL_EXTEND_TO` (10 days). After that write every sibling has at least 8 days left, whenever overturn 1 happened.
- After overturn 1, the longest the hour can still wait is repost (2 h) plus dispute window (2 h) plus a late ruling or timeout (7 d): 7 days 4 hours, inside 8 days with about 20 hours to spare. This holds for all three paths in 5.1, the 14.25-day one included, because the bound is measured from overturn 1, not from `t0`.
- The repost's own `SubSignals` is written at the repost with 10 days and is needed for at most 7 days 2 hours after it.
- `HourPostedVia` is rewritten by the repost. A second overturn writes a fresh `SubOverturned`. `SubRepostUsed` is read at most about 7 days 2 hours after its write.
- The prototype confirms the 12.12 and 13.11-day builds with every sibling still live (Section 4).

### 5.3 The entries #89 left on their own lifetimes

`HeldHour` and `SubDispute` keep their Section 5.9 S3 lifetime, `SUB_DISPUTE_TTL_LEDGERS` (6-day ruling plus 1 day). Dispute 2 extends both in the same call, so they expire at the same ledger, 7 days after dispute 2. A ruling or timeout on dispute 2 must land before `SubDispute` expires anyway, and it builds the hour in that same call, so `HeldHour` is live when it is needed. The margin between the two is zero ledgers; Question 3 asks whether to give `HeldHour` a day more.

## 6. Recommendation

**Option A.** It is the smallest change that closes the gap, it brings `dispute_sub_signals` in line with the rule every other reader of a held hour already follows, and it leaves the gate, storage, resolution, the timeout and the build untouched.

Implementation, in one PR:

1. `dispute_sub_signals`: when `HeldHour(asset, hour)` exists, read the sub-epoch from its entry and return `WrongEpoch` if the entry is missing, with no ring fallback for a held hour. Otherwise read the ring as today.
2. Spec, in the same PR:
   - Section 5.9 S2: a held repost is disputable within its own `pending_until`.
   - Section 5.9 S3: the dispute path's read precedence.
   - The worst case: 12.33 days with both rulings on time, about 14.25 days at the outer bound if Question 2 keeps the current behavior.
3. Close #92.

Tests it needs:

- **The day-6 probe succeeds.** A held repost is disputed, its held entry reads `Disputed`, `SubDispute` exists, and the bond is locked.
- **Keeper wins on the held repost.** The hour builds about 12.3 days after the first post with the repost's value, the full inputs hash and every keeper paid once. The overturned first post is not paid.
- **Overturned again.** No further repost is accepted. The hour builds without sub 0 once the window closes. The reposter is slashed and not paid.
- **Late timeout at about 13.2 days.** The hour builds, and every sibling `SubSignals` TTL is still above zero.
- **The outer bound at about 14.25 days.** Overturn 1 at 7 days less a minute, then a late timeout on dispute 2. Every sibling is still live and the hour builds.
- **The dispute window applies.** Disputing a held repost after its `pending_until` returns `DisputeWindowClosed`.
- **Held-hour precedence.** In a held hour, a sub-epoch with no held entry returns `WrongEpoch`.
- **Fast reposts are unchanged.** The existing ring-path repost dispute tests pass as they are.
- **Gate footprint.** The `cover_gate` footprint budget tests still read 9 keys at 1, 12, 72 and 73 unbuilt hours.
- **Budget rows.** Rows for the held repost's dispute and its resolutions. The first dispute's instructions within 0.5% of `main`.
- **Mutation check.** Removing the `HeldHour` lookup fails the first test.
- **Existing tests.** Every one passes unchanged, `golden_vectors.rs` included.

## 7. Open questions

1. Do you approve Option A, with `HeldHour` taking precedence over the ring for any held hour and no ring fallback once an hour is held (the same rule `sub_disposition` uses)?
2. `resolve_sub_signal_dispute` (and the hourly `resolve_signal_dispute`) accept a ruling at any time while the dispute record exists, which for a sub-epoch is up to 7 days, not 6. That is what makes the 14.25-day path possible. Should a ruling after `opened_at + SIGNAL_DISPUTE_RULING_SECS` be rejected, so only the timeout applies past the deadline? It would cap the worst case at about 13.3 days. It changes committee behavior, so I would do it as its own PR.
3. `HeldHour` and the second `SubDispute` expire at the same ledger (Section 5.3). Should the dispute path extend `HeldHour` by a day more than `SubDispute`, so a held hour always outlives its last open dispute?
4. If neither a ruling nor a timeout lands before a `SubDispute` expires, I have not traced what the hour does next. This affects every sub-epoch dispute, not only held reposts. Should I trace it and file it separately?
5. Should the spec changes in Section 6 go in the implementation PR (my suggestion), or in a docs PR first?

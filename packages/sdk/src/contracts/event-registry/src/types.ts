import {Address} from '@stellar/stellar-sdk';

    /**
 * Error Enum: Error
 */
export const Error = {
  1 : { message: "AlreadyInitialized" },
  2 : { message: "NotInitialized" },
  /**
   * Never actually returned: every authorization check goes through
   * Soroban's native `Address::require_auth()`, which traps the
   * host call directly rather than returning a `Result` this
   * contract could wrap. Kept for cross-contract error code
   * compatibility, the same reasoning `RiskOracle`/`Staking`/
   * `Treasury` document for their own copies of this code.
   */
  3 : { message: "Unauthorized" },
  /**
   * Not currently reachable: this contract has no pause
   * integration in this build (Section 16.2 lists no
   * EventRegistry-specific pause scope). Kept for code number
   * compatibility.
   */
  4 : { message: "Paused" },
  /**
   * Checked arithmetic failed: the IssuerFreeze check's own running
   * clawback-amount and revocation-count sums over its 7 day
   * window, and the clawback ratio's own scale-up before dividing
   * by supply. Bounded by realistic USDC amounts in practice
   * (each term already passed `RiskOracle.post_signals`'s own
   * sanity bounds), but checked rather than assumed, matching
   * `Staking`'s/`Treasury`'s own convention.
   */
  5 : { message: "MathOverflow" },
  /**
   * No `EventDefinition` stored under the requested (asset, kind,
   * version).
   */
  200 : { message: "UnknownDefinition" },
  /**
   * `propose_tier1` while a non-terminal event already exists for
   * this (asset, kind, version) (invariant E3).
   */
  201 : { message: "EventInProgress" },
  /**
   * A Tier 1 proposal's ring-buffer check did not meet the
   * definition: too many missing epochs, a present epoch past
   * threshold, or a liquidity baseline below `min_liquidity`
   * (design note Section 3).
   */
  202 : { message: "Tier1CheckFailed" },
  /**
   * `challenge`'s bond lock in `Staking` failed. Not reachable as
   * built: `challenge` calls `Staking.lock_bond` directly (not a
   * `try_*` variant), so a real failure on `Staking`'s own side
   * (for example, the challenger's USDC balance too low for the
   * transfer) traps the call rather than returning a `Result` this
   * contract could translate into its own error code, the same
   * reasoning every other cross-contract call in this workspace
   * follows. Kept for code number compatibility.
   */
  203 : { message: "InsufficientBond" },
  /**
   * `finalize` called before `challenge_secs` has elapsed since
   * `proposed_at`.
   */
  204 : { message: "ChallengeWindowOpen" },
  /**
   * `challenge` called after `challenge_secs` has elapsed, or
   * against an event no longer `Proposed`.
   */
  205 : { message: "ChallengeWindowClosed" },
  /**
   * A function's own required state (`Proposed`, `Escalated`, ...)
   * does not match the event's current one.
   */
  206 : { message: "WrongState" },
  /**
   * Unreachable as built (design note review item D4): a fixed
   * post-resolution cooldown was in the original spec design but is
   * replaced here by a new-data test (`window_start > left_at`),
   * which `propose_tier1` enforces itself rather than returning a
   * distinct "still cooling down" code. Kept for code number
   * compatibility.
   */
  207 : { message: "CooldownActive" },
  /**
   * `register_definition`'s own validation failed: asset unknown,
   * `reference` mismatch, a parameter unused by `kind` is non
   * zero, or the window plus baseline does not fit the ring buffer.
   */
  208 : { message: "InvalidDefinition" },
  /**
   * An IssuerFreeze definition for an asset whose `issuer_flags`
   * allow neither revocation nor clawback.
   */
  209 : { message: "FreezeImpossible" },
  /**
   * A live series still pins the version `register_definition`
   * would supersede. Unreachable in this build (no `MarketFactory`
   * to report a live series at all, so this check never finds one
   * to object to); kept for code number compatibility and for the
   * day `MarketFactory` exists.
   */
  210 : { message: "DefinitionInUse" },
  /**
   * `rule` called after the ruling deadline; use `resolve_timeout`.
   */
  211 : { message: "RulingDeadlinePassed" },
  /**
   * `resolve_timeout` called before the ruling deadline.
   */
  212 : { message: "RulingDeadlineNotReached" },
  /**
   * New (feat/event-registry, design note review item D2/R2/R3):
   * `finalize` on a Depeg proposal whose cure window still has an
   * epoch that is neither effectively Final nor permanently
   * missing (still `Pending` before its own `pending_until`, or
   * `Disputed` and unresolved, or `Empty` but still inside its own
   * backfill window). Not a failure: callable again once the data
   * settles one way or the other.
   */
  213 : { message: "DataNotFinal" },
  /**
   * New (feat/event-registry, design note review item D3): `version`
   * is registered but not acceptable: neither the current canonical
   * version for (asset, kind) nor pinned by any live series (the
   * latter check is a stand-in returning `false` until
   * `MarketFactory` exists, Section 2 of the design note).
   */
  214 : { message: "VersionNotCovered" },
  /**
   * New (feat/event-registry): `challenge`, `finalize`, `rule` or
   * `resolve_timeout` against an `event_id` with no stored
   * `EventRecord`. Kept distinct from `UnknownDefinition` (no
   * canonical definition, or no such version), since these are
   * different questions: one is about a DEFINITION, the other
   * about a specific PROPOSAL.
   */
  215 : { message: "UnknownEvent" },
  /**
   * Issue #12: `migrate` called with a `target_version` already
   * applied (or an older one). Each storage-shape migration runs at
   * most once; a second call for the same (or an earlier) version is
   * a no-op request, not a retry of something that failed.
   */
  216 : { message: "AlreadyMigrated" }
}

/**
 * Event: EventCured
 */
export interface EventCuredEvent {
  name: "EventCured";
  data: {
    asset: string;
    event_id?: bigint;
  };
}

/**
 * Event: EventDeclared
 */
export interface EventDeclaredEvent {
  name: "EventDeclared";
  data: {
    asset: string;
    event_id?: bigint;
    kind?: EventKind;
    def_version?: number;
    window_start?: bigint;
    declared_at?: bigint;
  };
}

/**
 * Event: EventProposed
 */
export interface EventProposedEvent {
  name: "EventProposed";
  data: {
    asset: string;
    event_id?: bigint;
    kind?: EventKind;
    def_version?: number;
    tier?: number;
    window_start?: bigint;
    proposer?: string;
    evidence?: Uint8Array;
  };
}

/**
 * Event: EventRejected
 */
export interface EventRejectedEvent {
  name: "EventRejected";
  data: {
    asset: string;
    event_id?: bigint;
    reason?: Uint8Array;
  };
}

/**
 * Event: EventEscalated
 */
export interface EventEscalatedEvent {
  name: "EventEscalated";
  data: {
    asset: string;
    event_id?: bigint;
    escalated_at?: bigint;
    ruling_deadline?: bigint;
  };
}

/**
 * Event: RulingTimedOut
 */
export interface RulingTimedOutEvent {
  name: "RulingTimedOut";
  data: {
    asset: string;
    event_id?: bigint;
    /**
     * `true` if the default outcome was Declared, `false` if Rejected.
     */
    outcome_declared?: boolean;
    committee?: string;
    misses_after?: number;
  };
}

/**
 * Event: EventChallenged
 */
export interface EventChallengedEvent {
  name: "EventChallenged";
  data: {
    asset: string;
    event_id?: bigint;
    challenger?: string;
    evidence?: Uint8Array;
  };
}

/**
 * Event: DefinitionRegistered
 */
export interface DefinitionRegisteredEvent {
  name: "DefinitionRegistered";
  data: {
    asset: string;
    kind?: EventKind;
    version?: number;
    previous_version?: number;
  };
}

/**
 * PR #15 review, finding F2. Bit `i` of `recorded` is set once the
 * cure-window epoch `first_cure_epoch + i` has been observed Final or
 * PermanentlyMissing at least once; `any_below_threshold`/
 * `any_missing` are the OR of every such observation so far. A `u128`
 * bitmap comfortably covers the up-to-72 cure epochs `challenge_secs`
 * can specify (finding F3's own bound), with headroom to spare.
 * Deliberately never clears a bit once set: a disposition, once
 * observed Final or PermanentlyMissing, cannot change (an epoch that
 * is genuinely Final never reverts to Pending or Disputed, and
 * PermanentlyMissing is a statement about elapsed time, which never
 * un-elapses), so recording is monotonic and `checkpoint_cure` is
 * naturally idempotent.
 */
export interface CureProgress {
  any_below_threshold: boolean;
  any_missing: boolean;
  recorded: bigint;
}

/**
 * Union: Reference
 */
 export type Reference =
  /**
   * 1 unit = 1 USD.
   */
  { tag: "Usd"; values: void } |
  /**
   * ISO 4217 code and the FX rate basis it is priced against, via the
   * FX adapter (ADR-006).
   */
  { tag: "Fiat"; values: readonly [string, FxRateSource] } |
  /**
   * Pegged to another onchain asset.
   */
  { tag: "Asset"; values: readonly [string] };

/**
 * Which FX rate a `Reference::Fiat` is priced against. Matters wherever an
 * official rate and a market (parallel) rate diverge, for example ARS.
 * technical-doc.md Section 4.1, ADR-006.
 */
 export type FxRateSource =
  /**
   * The rate published by the central bank or official fixing.
   */
  { tag: "Official"; values: void } |
  /**
   * The rate at which the currency actually trades.
   */
  { tag: "Market"; values: void };

/**
 * Result of `EventRegistry::cover_gate(asset)`: whether new cover may be
 * bought on an asset right now (ADR-003). technical-doc.md Section 9.4.
 */
 export type CoverGate =
  /**
   * No trailing failure signal and no event in progress.
   */
  { tag: "Clear"; values: void } |
  /**
   * An event for the asset, of any kind, is Proposed, Challenged or
   * Escalated.
   */
  { tag: "EventInProgress"; values: void } |
  /**
   * An epoch in the trailing depeg window has `peg_ratio` below the
   * depeg threshold.
   */
  { tag: "RecentDepeg"; values: void } |
  /**
   * Endpoint status was Down or Degraded in the trailing halt window.
   */
  { tag: "RecentEndpointOutage"; values: void } |
  /**
   * A clawback or authorization revocation occurred in the last 7 days.
   */
  { tag: "RecentIssuerAction"; values: void } |
  /**
   * Since v1.5 (Section 5.9 S5): more unbuilt hours sit in the
   * trailing depeg window than `cover_gate` can safely scan in one
   * call (`MAX_UNBUILT_HOURS_SCANNED_BY_COVER_GATE`). Blocks new
   * cover the same way any other gate state does, rather than
   * skipping the depeg check outright or risking the call itself
   * exceeding the network's own transaction memory limit: a long
   * enough build backlog, or enough simultaneous disputes each
   * holding their own hour open, reads the same as a depeg would,
   * since the feed cannot currently prove it is clear.
   */
  { tag: "UnbuiltBacklog"; values: void };

/**
 * Union: EventKind
 */
 export type EventKind =
  { tag: "Depeg"; values: void } |
  { tag: "IssuerFreeze"; values: void } |
  { tag: "MintWithoutBacking"; values: void } |
  { tag: "WithdrawalHalt"; values: void } |
  { tag: "Insolvency"; values: void };

/**
 * Union: EventState
 */
 export type EventState =
  { tag: "None"; values: void } |
  { tag: "Proposed"; values: void } |
  { tag: "Challenged"; values: void } |
  { tag: "Escalated"; values: void } |
  { tag: "Declared"; values: void } |
  { tag: "Rejected"; values: void } |
  { tag: "Cured"; values: void };

/**
 * One proposed credit event, keyed by `(asset, kind, def_version)`
 * (ADR-001). technical-doc.md Section 4.3.
 */
export interface EventRecord {
  asset: string;
  /**
   * Proposer bond, held by Staking (ADR-004). Zero for Tier 1 and Tier 3.
   */
  bond: bigint;
  declared_at: bigint | null;
  /**
   * The canonical definition version the proposal was checked against.
   */
  def_version: number;
  /**
   * Set when a challenge escalates the event to the committee. The ruling
   * deadline is `escalated_at + ruling_deadline_secs` (ADR-002).
   */
  escalated_at: bigint | null;
  evidence_hash: Uint8Array;
  id: bigint;
  kind: EventKind;
  proposed_at: bigint;
  proposer: string;
  state: EventState;
  /**
   * 1, 2 or 3.
   */
  tier: number;
  /**
   * Start of the failure window. Decides which series the event covers
   * (ADR-003, Section 8.6).
   */
  window_start: bigint;
}

/**
 * The canonical, versioned rules for one event kind on one asset.
 * Stored by `(asset, kind, version)`; exactly one version per
 * `(asset, kind)` is canonical at a time (ADR-001).
 * technical-doc.md Section 4.3.
 *
 * Parameters that do not apply to `kind` must be zero; `register_definition`
 * rejects a definition that sets them.
 */
export interface EventDefinition {
  asset: string;
  /**
   * IssuerFreeze: new (feat/event-registry). Section 8.2's own text
   * ("`auth_revocations` above the threshold") names this check but
   * the spec, before this field, defined no threshold for it;
   * `freeze_pct_bps` is a basis-points ratio against `supply`,
   * which has no sensible meaning against a raw revocation count.
   * The count of authorization revocations in the 7 day window must
   * exceed this value for the revocation branch of the IssuerFreeze
   * check to pass.
   */
  auth_revocation_threshold: number;
  /**
   * All kinds: e.g. 86_400.
   */
  challenge_secs: bigint;
  /**
   * Depeg: e.g. 9_800_000, only during challenge.
   */
  cure_threshold: bigint;
  /**
   * Depeg: e.g. 9_500_000 = 0.95.
   */
  depeg_threshold: bigint;
  /**
   * Depeg: e.g. 259_200 = 72h.
   */
  depeg_window_secs: bigint;
  /**
   * IssuerFreeze: X in the PRD. Compared against `clawback_amount /
   * supply` over the 7 day window (Section 8.2).
   */
  freeze_pct_bps: number;
  /**
   * WithdrawalHalt: e.g. 259_200 = 72h.
   */
  halt_window_secs: bigint;
  kind: EventKind;
  /**
   * Depeg: epochs in the window with no Final posting that are ignored,
   * e.g. 6 of 72. More than this and the check fails (ADR-005).
   */
  max_missing_epochs: number;
  /**
   * MintWithoutBacking: Y in the PRD.
   */
  mint_spike_bps: number;
  /**
   * Copy of `AssetConfig.reference` at registration, including the FX
   * rate source, so the definition fixes what "the peg" means (ADR-006).
   */
  reference: Reference;
  /**
   * All kinds: committee ruling deadline counted from escalation,
   * e.g. 1_209_600 = 14 days (ADR-002).
   */
  ruling_deadline_secs: bigint;
  /**
   * def_version. Assigned by `register_definition` as the previous
   * canonical version plus one, starting at 1.
   */
  version: number;
}

/**
 * Returned by `EventRegistry::event_status(asset, kind)`, which is per
 * `(asset, kind)` for the canonical version (ADR-001).
 * technical-doc.md Section 12.2.
 */
 export type AssetEventStatus =
  { tag: "None"; values: void } |
  /**
   * (event_id).
   */
  { tag: "InProgress"; values: readonly [bigint] } |
  /**
   * (event_id, def_version, window_start, declared_at).
   */
  { tag: "Declared"; values: readonly [bigint, number, bigint, bigint] };

/**
 * technical-doc.md Section 17.3. `contract` is `env.current_contract_
 * address()`, so an indexer watching this topic across every Sylox
 * contract can tell which one just upgraded without decoding the event's
 * own emitting address separately.
 */
export interface UpgradedEvent {
  name: "Upgraded";
  data: {
    contract: string;
    old_version?: number;
    new_wasm_hash?: Uint8Array;
  };
}
    export type ContractEvent = EventCuredEvent | EventDeclaredEvent | EventProposedEvent | EventRejectedEvent | EventEscalatedEvent | RulingTimedOutEvent | EventChallengedEvent | DefinitionRegisteredEvent | UpgradedEvent;
    
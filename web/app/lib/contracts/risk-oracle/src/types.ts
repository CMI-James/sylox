import {Address} from '@stellar/stellar-sdk';

    /**
 * Error Enum: Error
 */
export const Error = {
  1 : { message: "AlreadyInitialized" },
  2 : { message: "NotInitialized" },
  /**
   * Never actually returned by any call in this contract: every
   * authorization check (`add_asset`, `update_asset`, `set_formula`,
   * `post_signals`, `dispute_signals`, `resolve_signal_dispute`,
   * `set_event_band`, `clear_event_band`, `set_event_in_progress`)
   * goes through Soroban's native `Address::require_auth()`, which
   * traps the host call directly rather than returning a `Result`
   * this contract could wrap in `Error::Unauthorized`. Kept for
   * `technical-doc.md` Section 14 code-number compatibility; see
   * `missing_auth_traps_natively_rather_than_returning_unauthorized`
   * in test.rs and the PR's "Review fixes" section for why this is
   * documented as unreachable rather than tested as reachable.
   */
  3 : { message: "Unauthorized" },
  4 : { message: "Paused" },
  5 : { message: "MathOverflow" },
  100 : { message: "UnknownAsset" },
  101 : { message: "KeeperNotActive" },
  102 : { message: "WrongEpoch" },
  103 : { message: "EpochAlreadyPosted" },
  104 : { message: "SanityBoundFailed" },
  105 : { message: "AmmCrossCheckFailed" },
  106 : { message: "DisputeWindowClosed" },
  107 : { message: "WeightsInvalid" },
  108 : { message: "ReferenceImmutable" },
  109 : { message: "ReferenceRateUnavailable" },
  /**
   * Distinct from `SanityBoundFailed` (104), which is about one posted
   * `SignalSet`'s fields; this is about computing the score from the
   * ring (not enough history, or a required window read came back
   * empty), a different failure mode a caller may want to handle
   * differently (for example: retry later vs. a permanently bad
   * posting). Review item "Aggregation failures must not reuse
   * SanityBoundFailed."
   */
  110 : { message: "AggregationFailed" },
  /**
   * `add_asset` / `update_asset` reject `Reference::Asset` in v1
   * (review decision D3): no USD rate is defined anywhere in the spec
   * for an asset pegged reference (see the PR's "Spec deviations").
   */
  111 : { message: "ReferenceNotSupported" },
  /**
   * ADR-010 (feat/staking, issue #4 fix): `resolve_signal_dispute_timeout`
   * called before `SIGNAL_DISPUTE_RULING_SECS` has passed since the
   * dispute opened. Named to match ADR-002's `RulingDeadlineNotReached`
   * precedent for the analogous event-ruling timeout.
   */
  112 : { message: "RulingDeadlineNotReached" },
  /**
   * technical-doc.md Section 5.9 S1: `sub_epoch_secs` set to a value
   * outside the allowed set, or one that does not divide 3,600
   * evenly.
   */
  113 : { message: "InvalidSubEpochInterval" },
  /**
   * technical-doc.md Section 5.9 S4: `build_hour` called while at
   * least one of the hour's sub-epochs is still Pending or Disputed,
   * i.e. not yet Final, permanently missing, or rejected.
   */
  114 : { message: "SubEpochNotReady" },
  /**
   * technical-doc.md Section 5.9 S2: an hour is posted through
   * exactly one path, sub-epoch or hourly fallback, never both. A
   * sub-epoch post against an hour already posted through the
   * fallback path, or a fallback post against an hour that already
   * has a sub-epoch posted, both return this.
   */
  115 : { message: "HourAlreadyPosted" }
}

/**
 * technical-doc.md Section 5.9 S4, Section 13.
 */
export interface HourBuiltEvent {
  name: "HourBuilt";
  data: {
    asset: string;
    hour?: bigint;
    sub_count_final?: number;
    coverage_bps?: number;
  };
}

/**
 * Event: AssetStale
 */
export interface AssetStaleEvent {
  name: "AssetStale";
  data: {
    asset: string;
    last_epoch?: bigint;
  };
}

/**
 * Event: BandChanged
 */
export interface BandChangedEvent {
  name: "BandChanged";
  data: {
    asset: string;
    from?: Band;
    to?: Band;
    epoch?: bigint;
  };
}

/**
 * Event: ScoreUpdated
 */
export interface ScoreUpdatedEvent {
  name: "ScoreUpdated";
  data: {
    asset: string;
    epoch?: bigint;
    score?: number;
    formula_version?: number;
  };
}

/**
 * Event: SignalsFinal
 */
export interface SignalsFinalEvent {
  name: "SignalsFinal";
  data: {
    asset: string;
    epoch?: bigint;
  };
}

/**
 * Event: SignalsPosted
 */
export interface SignalsPostedEvent {
  name: "SignalsPosted";
  data: {
    asset: string;
    epoch?: bigint;
    keeper?: string;
    inputs_hash?: Uint8Array;
    pending_until?: bigint;
  };
}

/**
 * Event: SignalsDisputed
 */
export interface SignalsDisputedEvent {
  name: "SignalsDisputed";
  data: {
    asset: string;
    epoch?: bigint;
    disputer?: string;
    alt_hash?: Uint8Array;
  };
}

/**
 * Event: SignalsResolved
 */
export interface SignalsResolvedEvent {
  name: "SignalsResolved";
  data: {
    asset: string;
    epoch?: bigint;
    keeper_wins?: boolean;
    reason?: Uint8Array;
  };
}

/**
 * Event: SubSignalsFinal
 */
export interface SubSignalsFinalEvent {
  name: "SubSignalsFinal";
  data: {
    asset: string;
    hour?: bigint;
    sub?: number;
  };
}

/**
 * technical-doc.md Section 5.9 (v1.5), Section 13.
 */
export interface SubSignalsPostedEvent {
  name: "SubSignalsPosted";
  data: {
    asset: string;
    hour?: bigint;
    sub?: number;
    keeper?: string;
    inputs_hash?: Uint8Array;
    pending_until?: bigint;
  };
}

/**
 * Event: EndpointFinalized
 */
export interface EndpointFinalizedEvent {
  name: "EndpointFinalized";
  data: {
    asset: string;
    epoch?: bigint;
    status?: EndpointStatus;
  };
}

/**
 * Event: SubSignalsDisputed
 */
export interface SubSignalsDisputedEvent {
  name: "SubSignalsDisputed";
  data: {
    asset: string;
    hour?: bigint;
    sub?: number;
    disputer?: string;
    alt_hash?: Uint8Array;
  };
}

/**
 * Event: SubSignalsResolved
 */
export interface SubSignalsResolvedEvent {
  name: "SubSignalsResolved";
  data: {
    asset: string;
    hour?: bigint;
    sub?: number;
    keeper_wins?: boolean;
  };
}

/**
 * technical-doc.md Section 5.9 S1, Section 13.
 */
export interface SubEpochSecsChangedEvent {
  name: "SubEpochSecsChanged";
  data: {
    asset: string;
    sub_epoch_secs?: bigint;
    effective_from_hour?: bigint;
  };
}

/**
 * ADR-010 (feat/staking, issue #4 fix).
 */
export interface SignalDisputeTimedOutEvent {
  name: "SignalDisputeTimedOut";
  data: {
    asset: string;
    epoch?: bigint;
    disputer?: string;
    committee?: string;
  };
}

/**
 * Event: SubSignalDisputeTimedOut
 */
export interface SubSignalDisputeTimedOutEvent {
  name: "SubSignalDisputeTimedOut";
  data: {
    asset: string;
    hour?: bigint;
    sub?: number;
    disputer?: string;
    committee?: string;
  };
}

/**
 * Union: Band
 */
 export type Band =
  { tag: "Normal"; values: void } |
  { tag: "Watch"; values: void } |
  { tag: "Warning"; values: void } |
  { tag: "Distress"; values: void } |
  /**
   * Set when a credit event is Declared; sticky until governance
   * re-enables the asset.
   */
  { tag: "Event"; values: void };

/**
 * The latest computed risk score for an asset. technical-doc.md Section 4.2.
 */
export interface RiskScore {
  band: Band;
  epoch: bigint;
  formula_version: number;
  /**
   * 0..=100.
   */
  score: number;
  stale: boolean;
}

/**
 * One epoch slot of the per asset ring buffer that Tier 1 checks, the
 * cover gate and the 24 hour and 7 day aggregates read in a single entry,
 * instead of separate `Signals(asset, epoch)` entries.
 * technical-doc.md Section 5.8, ADR-005.
 */
export interface RingSlot {
  auth_revocations: number;
  clawback_amount: bigint;
  endpoint: EndpointStatus;
  epoch: bigint;
  liquidity_2pct: bigint;
  peg_ratio: bigint;
  /**
   * Ledger timestamp after which a `Pending` slot reads as Final.
   */
  pending_until: bigint;
  /**
   * Section 5.9 S4/S5 (v1.5): how many of this hour's own
   * sub-epochs (0 to 12, never more, `SUB_RING_SLOTS`'s own upper
   * bound on `sub_epochs_per_hour`) currently contribute to this
   * slot's own fields, when this hour is on the sub-epoch posting
   * path. `None` for an hour on the hourly fallback path (whose
   * `peg_ratio` etc. are the real, single posted reading, contested
   * or not, with no sub-epoch coverage concept) and for an hour
   * that has never had a sub-epoch posted at all.
   *
   * `Some(n)` tells two things apart that `state` alone cannot:
   * which posting path produced a `Disputed` slot (only the
   * sub-epoch path ever sets this to `Some`; an hour disputed
   * through the hourly fallback, whose `peg_ratio` IS the
   * contested value itself, stays `None`), and whether a `Disputed`
   * sub-epoch-path slot still holds usable data from its OTHER,
   * non-disputed sub-epochs (`Some(n > 0)`) or genuinely none at
   * all (`Some(0)`, every posted sub-epoch currently disputed) —
   * deliberately not read off `peg_ratio` or `pending_until`, since
   * both already c
   */
  provisional_sub_coverage: number | null;
  redemption_net: bigint;
  state: SlotState;
  supply: bigint;
  supply_change_bps: number;
}

/**
 * Identifies one sub-epoch at the posting/dispute API boundary:
 * `hour`, and `sub`, its position within that hour under whichever
 * `sub_epoch_secs` governed it. technical-doc.md Section 5.9 S2.
 * `Sub(asset)`'s own ring stores a different identity internally
 * (`sub_start`, the sub-epoch's absolute start time, Section 5.9 S3),
 * since what `sub` means depends on an interval that can later
 * change; `SubEpoch` is the human-meaningful pair a keeper posts
 * against, converted internally to `sub_start`.
 */
export interface SubEpoch {
  hour: bigint;
  sub: number;
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
 * One epoch's measured signals for one asset. technical-doc.md Section 4.1.
 */
export interface SignalSet {
  /**
   * Sourced only from `Staking::aggregate`. RiskOracle overwrites this
   * field on `post_signals` and `finalize_endpoint`; any keeper supplied
   * value is ignored, so keepers post `Unknown` (ADR-005).
   */
  endpoint: EndpointStatus;
  epoch: bigint;
  /**
   * Hash of raw inputs, for recomputation.
   */
  inputs_hash: Uint8Array;
  issuer_actions: IssuerActions;
  /**
   * Depth within 2% of peg, USDC units.
   */
  liquidity_2pct: bigint;
  /**
   * TWAP price / reference, SCALE 1e7.
   */
  peg_ratio: bigint;
  /**
   * 10th percentile of the volume weighted price series in the window,
   * divided by the reference, SCALE 1e7. A single wick cannot move it
   * (ADR-005).
   */
  peg_ratio_p10: bigint;
  /**
   * Ledger timestamp.
   */
  posted_at: bigint;
  poster: string;
  /**
   * Net burned minus issued this epoch, asset units.
   */
  redemption_net: bigint;
  /**
   * Total circulating supply, asset units. Keeper posted from ledger asset
   * stats; SEP-41 has no `total_supply`, so it cannot be cross checked
   * onchain (ADR-005).
   */
  supply: bigint;
  /**
   * vs previous epoch.
   */
  supply_change_bps: number;
}

/**
 * Finality of one ring buffer slot. technical-doc.md Section 5.8.
 */
 export type SlotState =
  /**
   * Never posted, or overturned and not yet reposted. Counts as missing.
   */
  { tag: "Empty"; values: void } |
  /**
   * Posted, inside its dispute window. Reads as Final once
   * `pending_until` has passed.
   */
  { tag: "Pending"; values: void } |
  /**
   * Posted and disputed. Not final until the dispute resolves; an
   * overturned slot returns to Empty for reposting (ADR-005).
   */
  { tag: "Disputed"; values: void } |
  { tag: "Final"; values: void };

/**
 * Configuration for one issued asset covered by the RiskOracle.
 * technical-doc.md Section 4.1.
 */
export interface AssetConfig {
  /**
   * Optional Soroban AMM price adapters (`PriceAdapter`, Section 3.3).
   */
  amm_adapters: Array<string>;
  /**
   * Stellar Asset Contract address of the issued asset.
   */
  asset: string;
  enabled: boolean;
  /**
   * FX adapter (`FxAdapter`, Section 3.3). Required when `reference` is
   * `Fiat`, `None` otherwise.
   */
  fx_adapter: string | null;
  /**
   * For SEP-1 / SEP-24 probing.
   */
  home_domain: string;
  /**
   * Classic issuer account (G...).
   */
  issuer: string;
  /**
   * Issuer account flags. IssuerFreeze definitions can only be registered
   * when these make a freeze possible (ADR-006).
   */
  issuer_flags: IssuerFlags;
  /**
   * In USDC units. A Depeg window counts only if the median
   * `liquidity_2pct` of the 7 days before the window started is at least
   * this value. Never compared against live liquidity (ADR-005).
   */
  min_liquidity: bigint;
  /**
   * What the asset should be worth. Fixed at `add_asset`: `update_asset`
   * rejects any change, so every event definition that pins it stays
   * valid (ADR-006).
   */
  reference: Reference;
}

/**
 * The classic issuer flags that make an issuer freeze possible. An
 * IssuerFreeze definition can be registered only if at least one is set.
 * technical-doc.md Section 4.1, ADR-006.
 */
export interface IssuerFlags {
  /**
   * AUTH_REVOCABLE: the issuer can revoke a holder's authorization.
   */
  auth_revocable: boolean;
  /**
   * CLAWBACK_ENABLED: the issuer can claw back balances.
   */
  clawback_enabled: boolean;
}

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
 * Struct: IssuerActions
 */
export interface IssuerActions {
  auth_revocations: number;
  clawback_amount: bigint;
  clawbacks: number;
  flag_changes: number;
}

/**
 * Union: EndpointStatus
 */
 export type EndpointStatus =
  { tag: "Unknown"; values: void } |
  { tag: "Up"; values: void } |
  { tag: "Degraded"; values: void } |
  { tag: "Down"; values: void };

/**
 * Per asset sub-epoch configuration. technical-doc.md Section 15.1
 * `SubEpochConfig(asset)`, Section 5.9 S1. `sub_epoch_secs` is the
 * value currently in effect; `pending_sub_epoch_secs` and
 * `effective_from_hour` describe a queued change that has not yet
 * taken effect (both `None` when no change is pending). A change
 * never applies before `effective_from_hour`, so no sub-epoch
 * already posted, or postable before that boundary, is ever
 * reinterpreted under a different length.
 */
export interface SubEpochConfig {
  effective_from_hour: bigint | null;
  pending_sub_epoch_secs: bigint | null;
  sub_epoch_secs: bigint;
}
    export type ContractEvent = HourBuiltEvent | AssetStaleEvent | BandChangedEvent | ScoreUpdatedEvent | SignalsFinalEvent | SignalsPostedEvent | SignalsDisputedEvent | SignalsResolvedEvent | SubSignalsFinalEvent | SubSignalsPostedEvent | EndpointFinalizedEvent | SubSignalsDisputedEvent | SubSignalsResolvedEvent | SubEpochSecsChangedEvent | SignalDisputeTimedOutEvent | SubSignalDisputeTimedOutEvent;
    
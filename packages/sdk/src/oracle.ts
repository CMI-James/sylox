import { riskOracleClient } from "./contracts/risk-oracle.js";
import type { RingSlot, RiskScore, Band, SignalSet, SlotState, SubEpoch } from "./contracts/risk-oracle.js";
import { scoreError, extractErrorCode, SyloxError } from "./errors.js";
import type { SyloxNetwork } from "./networks.js";

/**
 * `al.oracle` - thin, primitive reads over RiskOracle. Built as a
 * thinner module than web/app/lib/asset-data.ts (the REFERENCE this was
 * ported from, per this PR's brief, not copied wholesale): that file
 * returns pre-formatted UI display shapes (AssetHeader,
 * CoverSalesStatus, ...) with hardcoded label strings. Every function
 * here returns the contract's own typed/decoded value as-is - bigints
 * preserved, no UI formatting, no display reshaping. `al.fx` (fx.ts) is
 * the one place display conversion happens, and only on request.
 */

const RING_SLOTS = 240; // contracts/risk-oracle/src/storage.rs: RING_SLOTS, frozen for v1.

export interface EffectiveRingSlot extends RingSlot {
  /** `storage::effective_state`'s result for this slot, via RiskOracle.effective_window - the contract's own Pending-to-Final promotion rule, never reimplemented client-side. */
  effectiveState: SlotState["tag"];
}

export class Oracle {
  constructor(private readonly network: SyloxNetwork) {}

  /** Address[] - every asset RiskOracle currently tracks. */
  async assets(): Promise<string[]> {
    const tx = await riskOracleClient(this.network).assets();
    return tx.result;
  }

  /** `{ score, band, stale, epoch, formulaVersion }` for the asset - wraps RiskOracle.score, unwrapping its Result through SyloxError. Bigints preserved as-is. */
  async score(asset: string): Promise<RiskScore> {
    const tx = await riskOracleClient(this.network).score({ asset });
    const result = tx.result;
    if (result.isErr()) {
      throw scoreError(extractErrorCode(tx));
    }
    return result.unwrap();
  }

  /**
   * The asset's current Band. Derived from `score()` rather than a
   * separate contract call - RiskOracle.band(asset) exists as its own
   * read (confirmed in the generated bindings), but score() already
   * returns the band alongside the rest of RiskScore in one round
   * trip, and every caller that wants just the band can destructure
   * it; a second RPC call for the same underlying value would be
   * avoidable latency for the common case. DEVIATION/implementation
   * note (per this PR's brief, flagged rather than silently chosen):
   * a caller that wants band() to behave as a genuinely separate,
   * possibly-cheaper read (e.g. to avoid needing a scored epoch to
   * exist at all) should call RiskOracle's own `band` through the
   * generated bindings directly; this convenience wrapper always goes
   * through `score()` and so shares its error path and UnknownAsset
   * behavior.
   */
  async band(asset: string): Promise<Band> {
    const riskScore = await this.score(asset);
    return riskScore.band;
  }

  /** Wraps RiskOracle.check_stale. */
  async isStale(asset: string): Promise<boolean> {
    const tx = await riskOracleClient(this.network).check_stale({ asset });
    const result = tx.result;
    if (result.isErr()) {
      throw scoreError(extractErrorCode(tx));
    }
    return result.unwrap();
  }

  /**
   * The newest hourly-only Final/Pending signal (RiskOracle.latest) -
   * distinct from `live()`'s sub-epoch-aware read below. `null` when
   * nothing has ever been posted for this asset (the SDK's own `null`
   * convention for "no value," matching generated bindings' `T | null`
   * decoding of a contract `Option<T>`).
   */
  async latest(asset: string): Promise<SignalSet | null> {
    const tx = await riskOracleClient(this.network).latest({ asset });
    return tx.result ?? null;
  }

  /**
   * technical-doc.md Section 5.9/12.1 (v1.5): the newest POSTED
   * sub-epoch's Pending/challengeable data, distinct from `latest()`'s
   * hourly-only Final/Pending semantics. Ported from asset-data.ts's
   * `fetchLive` (lines 247-264), but returns the raw decoded tuple or
   * `null` - never fetchLive's own `LiveValue` discriminated union
   * ({status, subEpoch, pegRatio, ...} reshaping), since that's a
   * display shape this SDK's generic caller doesn't need. `null` is
   * kept (not re-wrapped) because it's a real, useful signal on its
   * own - "no live reading yet."
   */
  async live(asset: string): Promise<[SubEpoch, SignalSet, SlotState] | null> {
    const tx = await riskOracleClient(this.network).live({ asset });
    const result = tx.result;
    // Generated bindings decode a contract Option<T> as `T | null`, not
    // `T | undefined` - checked for both anyway (same defensive
    // convention asset-data.ts's own fetchLive uses), since nothing
    // about the contract's semantics changed, only the SDK's own JS
    // representation of "no value" could in principle differ by SDK
    // version.
    if (result === undefined || result === null) return null;
    return result;
  }

  /**
   * `first_epoch()`'s result. Ported from asset-data.ts's
   * `tryFetchFirstEpoch` (lines 390-400), but DEVIATES deliberately
   * (per this PR's brief) on failure handling: that function silently
   * returns `undefined` on ANY failure (a UX need specific to a page
   * that must never crash on this one optional field). A generic SDK
   * consumer has no such need and a silent fallback would hide a real
   * RPC/network failure from the caller - so this throws a SyloxError
   * instead. Still returns `null` (not throw) for the real, decoded
   * "never posted" case (`Option<u64>` resolving to None) - that's a
   * genuine value, not a failure.
   */
  async firstEpoch(asset: string): Promise<bigint | null> {
    try {
      const tx = await riskOracleClient(this.network).first_epoch({ asset });
      return tx.result ?? null;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new SyloxError(`Couldn't read this asset's first epoch: ${message}`, {
        code: null,
        contractErrorName: null,
      });
    }
  }

  /**
   * The effective-ring data (`ring()` paired with `effective_window()`
   * to promote each slot's EFFECTIVE Pending-to-Final state, never
   * `now >= pending_until` reimplemented client-side) - ported close to
   * verbatim from asset-data.ts's `fetchEffectiveRing` (lines 337-387),
   * since the epoch-reconstruction math (deriving each slot's real
   * epoch from the newest non-Empty slot's own index, since a
   * never-written slot's stored epoch is 0) is genuinely complex
   * contract-semantics logic worth not re-deriving. Strips only the
   * UI-specific `tracked`/`provisionalSubCoverage` display reshaping
   * that belongs to fetchPegHistory, not fetchEffectiveRing itself -
   * returns the effective-ring data as-is, oldest-first, for a UI layer
   * (out of this PR's scope) to shape however it needs.
   */
  async ring(asset: string): Promise<EffectiveRingSlot[]> {
    const oracle = riskOracleClient(this.network);
    const ringTx = await oracle.ring({ asset });
    const slots: RingSlot[] = ringTx.result;

    // The newest non-Empty slot isn't necessarily at the last array
    // index - if the newest hour was overturned and reopened (ADR-005:
    // an overturned slot returns to Empty for reposting), the array's
    // last slot can itself be Empty while an earlier one is real.
    // Anchoring on that slot's own index (not an assumed "last
    // position") is what keeps the derived axis correct in that case.
    let anchorIndex = -1;
    for (let i = slots.length - 1; i >= 0; i--) {
      if (slots[i].state.tag !== "Empty") {
        anchorIndex = i;
        break;
      }
    }
    if (anchorIndex === -1) {
      // Never posted: no real epoch to anchor the axis to. Every slot
      // stays Empty.
      return slots.map((slot) => ({ ...slot, effectiveState: "Empty" as const }));
    }

    const anchorSlot = slots[anchorIndex];
    const newestEpoch = anchorSlot.epoch + BigInt(RING_SLOTS - 1 - anchorIndex);
    const oldestEpoch =
      newestEpoch >= BigInt(RING_SLOTS - 1) ? newestEpoch - BigInt(RING_SLOTS - 1) : BigInt(0);

    const windowTx = await oracle.effective_window({
      asset,
      start_epoch: oldestEpoch,
      count: RING_SLOTS,
    });
    const effectiveStates = windowTx.result; // Array<SlotState | null>, indexed by (epoch - oldestEpoch).

    return slots.map((slot, i) => {
      const epoch = newestEpoch - BigInt(RING_SLOTS - 1) + BigInt(i);
      const windowIndex = Number(epoch - oldestEpoch);
      const effective = effectiveStates[windowIndex];
      return {
        ...slot,
        epoch, // Overrides the raw stored epoch (0 for an unwritten slot) with the derived, always-correct one.
        effectiveState: effective ? effective.tag : "Empty",
      };
    });
  }
}

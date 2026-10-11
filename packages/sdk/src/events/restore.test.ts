import { describe, expect, it, vi } from "vitest";
import { maybeRestore } from "./restore.js";
import { SyloxError } from "../errors.js";

/**
 * Section 19.7 / "Archived entries": new logic with no 1:1 source
 * file - `maybeRestore` is new in this PR. Exercises the three real
 * branches: no restore needed (no-op), restore needed and consented
 * to (builds+submits+re-simulates), and restore needed but declined
 * or uncallbacked (throws a clear SyloxError, never silently
 * proceeding).
 */

function fakeTx(opts: { simulation: unknown; restoreFootprint?: ReturnType<typeof vi.fn>; simulate?: ReturnType<typeof vi.fn> }) {
  return {
    simulation: opts.simulation,
    restoreFootprint: opts.restoreFootprint ?? vi.fn(),
    simulate: opts.simulate ?? vi.fn(),
  } as never;
}

describe("maybeRestore", () => {
  it("is a no-op when there is no simulation at all", async () => {
    const tx = fakeTx({ simulation: undefined });
    await expect(maybeRestore(tx)).resolves.toBeUndefined();
  });

  it("is a no-op when the simulation is a plain success, not a restore response", async () => {
    const tx = fakeTx({ simulation: { result: 42 } });
    await expect(maybeRestore(tx)).resolves.toBeUndefined();
  });

  it("is a no-op when the simulation is a plain error, not a restore response", async () => {
    const tx = fakeTx({ simulation: { error: "HostError: Error(Contract, #206)", events: [] } });
    await expect(maybeRestore(tx)).resolves.toBeUndefined();
  });

  it("throws a clear SyloxError when a restore is needed but no onRestoreNeeded callback was provided", async () => {
    // rpc.Api.isSimulationRestore's real runtime check (confirmed
    // directly against this package's pinned @stellar/stellar-sdk):
    // isSimulationSuccess(sim) ("transactionData" in sim) AND
    // "restorePreamble" in sim AND a truthy restorePreamble.transactionData -
    // all three must be present for the fake to be recognized as a
    // real restore response, not just `error`/`result` alone.
    const tx = fakeTx({
      simulation: {
        transactionData: {},
        result: {},
        restorePreamble: { minResourceFee: "1000", transactionData: {} },
      },
    });
    await expect(maybeRestore(tx)).rejects.toBeInstanceOf(SyloxError);
    await expect(maybeRestore(tx)).rejects.toThrow(/onRestoreNeeded/);
  });

  it("throws a clear SyloxError when onRestoreNeeded declines (returns false)", async () => {
    const tx = fakeTx({
      simulation: {
        transactionData: {},
        result: {},
        restorePreamble: { minResourceFee: "1000", transactionData: {} },
      },
    });
    await expect(maybeRestore(tx, () => false)).rejects.toThrow(/declined/i);
  });

  it("builds, submits, and re-simulates when onRestoreNeeded consents", async () => {
    const restoreFootprint = vi.fn(async () => ({}));
    const simulate = vi.fn(async () => {});
    const restorePreamble = { minResourceFee: "1000", transactionData: {} };
    const tx = fakeTx({
      simulation: { transactionData: {}, result: {}, restorePreamble },
      restoreFootprint,
      simulate,
    });

    const onRestoreNeeded = vi.fn(async (info: { minResourceFee: string }) => {
      expect(info.minResourceFee).toBe("1000");
      return true;
    });

    await maybeRestore(tx, onRestoreNeeded);

    expect(onRestoreNeeded).toHaveBeenCalledOnce();
    expect(restoreFootprint).toHaveBeenCalledWith(restorePreamble);
    expect(simulate).toHaveBeenCalledOnce();
  });

  it("supports a synchronous (non-Promise) onRestoreNeeded callback", async () => {
    const restoreFootprint = vi.fn(async () => ({}));
    const simulate = vi.fn(async () => {});
    const tx = fakeTx({
      simulation: {
        transactionData: {},
        result: {},
        restorePreamble: { minResourceFee: "500", transactionData: {} },
      },
      restoreFootprint,
      simulate,
    });

    await maybeRestore(tx, () => true);
    expect(restoreFootprint).toHaveBeenCalledOnce();
  });
});

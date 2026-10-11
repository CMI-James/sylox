import { describe, expect, it, vi } from "vitest";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { maybeRestore } from "./restore.js";
import { SyloxError } from "../errors.js";

/**
 * Section 19.7 / "Archived entries": new logic with no 1:1 source
 * file - `maybeRestore` is new in this PR. Exercises the real branches:
 * no restore needed (no-op), restore needed and consented to (goes
 * through `tx.simulate({ restore: true })`, never a bare
 * `restoreFootprint` + `simulate()` pair - see restore.ts's own doc
 * comment for why that pair is unsafe), a failed restore (surfaced as
 * a SyloxError, never the SDK's raw RestorationFailure), and restore
 * needed but declined or uncallbacked (throws a clear SyloxError,
 * never silently proceeding).
 */

function fakeTx(opts: { simulation: unknown; simulate?: ReturnType<typeof vi.fn> }) {
  return {
    simulation: opts.simulation,
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

  it("restores via tx.simulate({ restore: true }), never a bare restoreFootprint + simulate() pair", async () => {
    const restorePreamble = { minResourceFee: "1000", transactionData: {} };
    const simulate = vi.fn(async () => {});
    const tx = fakeTx({
      simulation: { transactionData: {}, result: {}, restorePreamble },
      simulate,
    });

    const onRestoreNeeded = vi.fn(async (info: { minResourceFee: string }) => {
      expect(info.minResourceFee).toBe("1000");
      return true;
    });

    await maybeRestore(tx, onRestoreNeeded);

    expect(onRestoreNeeded).toHaveBeenCalledOnce();
    // The one and only call into the real SDK's own restore-and-rebuild
    // logic - maybeRestore itself never touches restoreFootprint, a
    // sequence number, or a rebuild directly; all of that lives inside
    // AssembledTransaction.simulate's own implementation (see
    // restore.ts's doc comment), reached only through this one call.
    expect(simulate).toHaveBeenCalledExactlyOnceWith({ restore: true });
  });

  it("supports a synchronous (non-Promise) onRestoreNeeded callback", async () => {
    const simulate = vi.fn(async () => {});
    const tx = fakeTx({
      simulation: {
        transactionData: {},
        result: {},
        restorePreamble: { minResourceFee: "500", transactionData: {} },
      },
      simulate,
    });

    await maybeRestore(tx, () => true);
    expect(simulate).toHaveBeenCalledExactlyOnceWith({ restore: true });
  });

  it("ends up with a transaction rebuilt against a fresh sequence number after a successful restore", async () => {
    // Models AssembledTransaction.simulate's own real internal
    // behavior (confirmed by reading node_modules directly, see
    // restore.ts's doc comment): on `{ restore: true }`, a successful
    // restore fetches a FRESH account and rebuilds `this.built` from
    // it before re-simulating - never reusing the sequence number the
    // transaction was originally built with. This fake's `simulate`
    // mutates `tx.built` the same way, so the test can assert the
    // caller sees a DIFFERENT built transaction (a new sequence
    // number), not the stale one from before the restore.
    const stale = { sequence: "100" };
    const rebuilt = { sequence: "101" }; // The account's next sequence number, consumed by the restore transaction itself.
    const restorePreamble = { minResourceFee: "1000", transactionData: {} };
    const tx = {
      simulation: { transactionData: {}, result: {}, restorePreamble },
      built: stale,
      simulate: vi.fn(async ({ restore }: { restore: boolean }) => {
        if (restore) {
          (tx as { built: unknown }).built = rebuilt;
        }
      }),
    } as unknown as { simulation: unknown; built: unknown; simulate: ReturnType<typeof vi.fn> };

    await maybeRestore(tx as never, () => true);

    expect(tx.built).toBe(rebuilt);
    expect(tx.built).not.toBe(stale);
  });

  it("wraps a failed restore in a SyloxError, never the SDK's raw RestorationFailure", async () => {
    const restorePreamble = { minResourceFee: "1000", transactionData: {} };
    const tx = fakeTx({
      simulation: { transactionData: {}, result: {}, restorePreamble },
      simulate: vi.fn(async () => {
        throw new AssembledTransaction.Errors.RestorationFailure(
          "Automatic restore failed! Result: {}",
        );
      }),
    });

    await expect(maybeRestore(tx, () => true)).rejects.toBeInstanceOf(SyloxError);
    await expect(maybeRestore(tx, () => true)).rejects.toThrow(/restore failed/i);
  });

  it("propagates any other error from tx.simulate unchanged", async () => {
    const restorePreamble = { minResourceFee: "1000", transactionData: {} };
    const boom = new Error("network blip, unrelated to restore");
    const tx = fakeTx({
      simulation: { transactionData: {}, result: {}, restorePreamble },
      simulate: vi.fn(async () => {
        throw boom;
      }),
    });

    await expect(maybeRestore(tx, () => true)).rejects.toBe(boom);
  });
});

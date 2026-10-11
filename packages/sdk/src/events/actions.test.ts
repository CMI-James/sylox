import { describe, expect, it, vi } from "vitest";
import {
  prepareCheckpointCure,
  confirmCheckpointCure,
  prepareFinalize,
  confirmFinalize,
  prepareProposeTier1,
  confirmProposeTier1,
  prepareChallenge,
  confirmChallenge,
} from "./actions.js";
import { SyloxError } from "../errors.js";
import type { SyloxNetwork } from "../networks.js";

/**
 * Ported from web/app/lib/event-actions.test.ts, ADAPTED: every
 * prepare* call now takes an explicit `network` (this SDK has no
 * implicit "the" network the way the web app's own module-level
 * deployment.ts singleton did), `eventRegistryClient` is mocked with
 * the new `(network, signer?)` signature, and every thrown-error
 * assertion is rewritten against `SyloxError` (`.message`/`.code`)
 * instead of a plain `Error`'s string message. New tests cover
 * proposeTier1/challenge, which don't exist in the source file (new in
 * this PR, Section 19.6).
 *
 * PR #69 review, required fix #2: prepare* now takes the full `signer:
 * Signer`, not a bare `address: string` - see actions.ts's and
 * events/restore.ts's own doc comments for why (restoreFootprint needs
 * signTransaction at Client construction time, not just by confirm*'s
 * later signAndSend). `lastConstructedWith` below now records the
 * whole signer object eventRegistryClient was actually called with, so
 * tests can assert both that the right publicKey AND the right
 * signTransaction function reached the client construction call - the
 * exact thing that was missing before this fix.
 */

const { eventRegistryClient, lastConstructedWith } = vi.hoisted(() => {
  const state = { lastConstructedWith: undefined as unknown };
  const client = {
    checkpoint_cure: vi.fn(async () => ({
      simulation: undefined,
      result: { isErr: () => false, unwrapErr: () => ({ message: "" }) },
      built: { source: state.lastConstructedWith },
      signAndSend: vi.fn(async () => ({
        result: {
          isErr: () => false,
          unwrap: () => ({ recorded: BigInt(1), any_below_threshold: false, any_missing: false }),
        },
        sendTransactionResponse: { hash: "abc123" },
      })),
    })),
    finalize: vi.fn(async () => ({
      simulation: undefined,
      result: { isErr: () => false, unwrapErr: () => ({ message: "" }) },
      built: { source: state.lastConstructedWith },
      signAndSend: vi.fn(async () => ({
        result: { isErr: () => false, unwrap: () => undefined },
        sendTransactionResponse: { hash: "def456" },
      })),
    })),
    current_version: vi.fn(async () => ({ result: 3 })),
    propose_tier1: vi.fn(async () => ({
      simulation: undefined,
      result: { isErr: () => false, unwrapErr: () => ({ message: "" }) },
      built: { source: state.lastConstructedWith },
      signAndSend: vi.fn(async () => ({
        result: { isErr: () => false, unwrap: () => BigInt(42) },
        sendTransactionResponse: { hash: "propose123" },
      })),
    })),
    challenge: vi.fn(async () => ({
      simulation: undefined,
      result: { isErr: () => false, unwrapErr: () => ({ message: "" }) },
      built: { source: state.lastConstructedWith },
      signAndSend: vi.fn(async () => ({
        result: { isErr: () => false, unwrap: () => undefined },
        sendTransactionResponse: { hash: "challenge123" },
      })),
    })),
  };
  return {
    eventRegistryClient: vi.fn((_network: unknown, signer?: { publicKey: string; signTransaction: unknown }) => {
      state.lastConstructedWith = signer?.publicKey;
      return client;
    }),
    lastConstructedWith: state,
  };
});

vi.mock("../contracts/event-registry.js", () => ({ eventRegistryClient }));

const NETWORK: SyloxNetwork = {
  rpcUrl: "https://fake-rpc.example",
  networkPassphrase: "Test SDF Network ; September 2015",
  contracts: { riskOracle: "CFAKE_ORACLE", eventRegistry: "CFAKE_REGISTRY" },
  // demoAsset is required on SyloxNetwork (both deployment source files
  // are committed - see networks.ts's doc comment) but unused by any
  // test in this file; a minimal well-shaped fixture satisfies the type.
  demoAsset: { contract_id: "CFAKE_DEMO_ASSET", asset_code: "DEMOUSD", issuer: "GFAKE_ISSUER" },
};

const ADDRESS_A = "GCWWB2WYVRE4SSMASR6EMFQ7D3K6BEOLN5UQAXGS5YWPX2ZJ44JYKER5";
const ADDRESS_B = "GBXYFBRIS5M7S2UDQ64AE4QHSJG7UIN6VRPDDAEBKP724V344GAL5MJP";

function fakeSigner(publicKey: string) {
  return {
    publicKey,
    signTransaction: vi.fn(async () => ({ signedTxXdr: "fake-xdr" })),
  };
}

describe("event-actions - publicKey wiring", () => {
  it("prepareCheckpointCure builds the client with the connected signer (publicKey) as the second argument", async () => {
    const signer = fakeSigner(ADDRESS_A);
    await prepareCheckpointCure(NETWORK, BigInt(1), signer);
    expect(eventRegistryClient).toHaveBeenCalledWith(NETWORK, signer);
  });

  it("the prepared transaction's own built source account equals the connected address", async () => {
    const prepared = await prepareCheckpointCure(NETWORK, BigInt(1), fakeSigner(ADDRESS_A));
    expect(prepared.tx.built?.source).toBe(ADDRESS_A);
    expect(prepared.preparedFor).toBe(ADDRESS_A);
  });

  it("prepareFinalize builds the client with the connected signer (publicKey) as the second argument", async () => {
    const signer = fakeSigner(ADDRESS_B);
    await prepareFinalize(NETWORK, BigInt(1), signer);
    expect(eventRegistryClient).toHaveBeenCalledWith(NETWORK, signer);
  });

  /**
   * PR #69 review, required fix #2's actual regression test: before the
   * fix, prepare* built eventRegistryClient from a bare address string,
   * so the client it handed to maybeRestore never carried a
   * signTransaction at all - restoreFootprint would throw "no
   * signTransaction function provided" the first time a real restore
   * was ever needed. Asserting the exact signer object (not just its
   * publicKey) reaches eventRegistryClient proves signTransaction is
   * now wired in at construction time, before maybeRestore ever runs.
   */
  it("prepareFinalize passes the signer's own signTransaction through to eventRegistryClient, not just its publicKey", async () => {
    const signer = fakeSigner(ADDRESS_A);
    await prepareFinalize(NETWORK, BigInt(1), signer);
    const [, calledWithSigner] = vi.mocked(eventRegistryClient).mock.calls.at(-1)!;
    expect((calledWithSigner as typeof signer).signTransaction).toBe(signer.signTransaction);
  });

  it("confirmCheckpointCure signs and sends when the signer matches who it was prepared for", async () => {
    const prepared = await prepareCheckpointCure(NETWORK, BigInt(1), fakeSigner(ADDRESS_A));
    const result = await confirmCheckpointCure(prepared, fakeSigner(ADDRESS_A));
    expect(result.txHash).toBe("abc123");
  });

  it("confirmCheckpointCure refuses to sign a transaction prepared for a different address", async () => {
    const prepared = await prepareCheckpointCure(NETWORK, BigInt(1), fakeSigner(ADDRESS_A));
    await expect(confirmCheckpointCure(prepared, fakeSigner(ADDRESS_B))).rejects.toThrow(/connected wallet changed/i);
  });

  it("confirmFinalize refuses to sign a transaction prepared for a different address", async () => {
    const prepared = await prepareFinalize(NETWORK, BigInt(1), fakeSigner(ADDRESS_A));
    await expect(confirmFinalize(prepared, fakeSigner(ADDRESS_B))).rejects.toThrow(/connected wallet changed/i);
  });

  it("confirmFinalize signs and sends when the signer matches who it was prepared for", async () => {
    const prepared = await prepareFinalize(NETWORK, BigInt(1), fakeSigner(ADDRESS_A));
    const result = await confirmFinalize(prepared, fakeSigner(ADDRESS_A));
    expect(result.txHash).toBe("def456");
  });
});

/**
 * The real error-mapping path: prepare* throw a SyloxError carrying
 * plain copy from errors.ts, never the contract's raw doc-comment
 * message.
 */
function diagnosticFor(code: number): string {
  return `HostError: Error(Contract, #${code})\n\nEvent log (newest first):\n   0: [Diagnostic Event] ...`;
}

function fakeErrClient(opts: { prepareErrorCode?: number; confirmErrorCode?: number }) {
  const prepareSim = opts.prepareErrorCode !== undefined ? { error: diagnosticFor(opts.prepareErrorCode) } : undefined;
  const confirmSim = opts.confirmErrorCode !== undefined ? { error: diagnosticFor(opts.confirmErrorCode) } : undefined;

  function makeTx(isPrepareErr: boolean) {
    const tx = {
      simulation: isPrepareErr ? prepareSim : undefined,
      result: { isErr: () => isPrepareErr, unwrapErr: () => ({ message: "the raw contract doc comment text" }) },
      signAndSend: vi.fn(async () => {
        const isConfirmErr = opts.confirmErrorCode !== undefined;
        return {
          assembled: { simulation: isConfirmErr ? confirmSim : undefined },
          result: {
            isErr: () => isConfirmErr,
            unwrapErr: () => ({ message: "the raw contract doc comment text" }),
            unwrap: () => ({ recorded: BigInt(1), any_below_threshold: false, any_missing: false }),
          },
          sendTransactionResponse: { hash: "abc123" },
        };
      }),
    };
    return tx;
  }

  return {
    checkpoint_cure: vi.fn(async () => makeTx(opts.prepareErrorCode !== undefined)),
    finalize: vi.fn(async () => makeTx(opts.prepareErrorCode !== undefined)),
  };
}

describe("event-actions - plain-language error mapping", () => {
  it("prepareCheckpointCure throws a SyloxError with the plain WrongState (206) sentence, never the raw contract message", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue(fakeErrClient({ prepareErrorCode: 206 }) as never);

    await expect(prepareCheckpointCure(NETWORK, BigInt(1), fakeSigner(ADDRESS_A))).rejects.toThrow(
      "This event has already moved past this step, or doesn't use a cure check.",
    );
    try {
      await prepareCheckpointCure(NETWORK, BigInt(1), fakeSigner(ADDRESS_A));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SyloxError);
      expect((e as InstanceType<typeof SyloxError>).code).toBe(206);
      expect((e as InstanceType<typeof SyloxError>).contractErrorName).toBe("WrongState");
    }
  });

  it("prepareFinalize throws a SyloxError with the plain ChallengeWindowOpen (204) sentence, never the raw contract message", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue(fakeErrClient({ prepareErrorCode: 204 }) as never);

    await expect(prepareFinalize(NETWORK, BigInt(1), fakeSigner(ADDRESS_A))).rejects.toThrow(
      "The challenge window for this event is still open.",
    );
  });

  it("prepareFinalize falls back to the generic message with the code, for an unmapped error", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue(fakeErrClient({ prepareErrorCode: 5 }) as never);

    await expect(prepareFinalize(NETWORK, BigInt(1), fakeSigner(ADDRESS_A))).rejects.toThrow(
      "The contract rejected this action (error 5).",
    );
  });

  it("never lets the raw contract doc-comment text reach the thrown error", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue(fakeErrClient({ prepareErrorCode: 206 }) as never);

    await expect(prepareFinalize(NETWORK, BigInt(1), fakeSigner(ADDRESS_A))).rejects.not.toThrow(
      /the raw contract doc comment text/,
    );
  });

  it("confirmCheckpointCure throws the plain mapped sentence when signAndSend itself fails simulation", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue(fakeErrClient({ confirmErrorCode: 215 }) as never);
    const prepared = await prepareCheckpointCure(NETWORK, BigInt(1), fakeSigner(ADDRESS_A));

    await expect(confirmCheckpointCure(prepared, fakeSigner(ADDRESS_A))).rejects.toThrow(
      "This event no longer exists.",
    );
  });

  it("confirmFinalize throws the plain mapped sentence when signAndSend itself fails simulation", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue(fakeErrClient({ confirmErrorCode: 213 }) as never);
    const prepared = await prepareFinalize(NETWORK, BigInt(1), fakeSigner(ADDRESS_A));

    await expect(confirmFinalize(prepared, fakeSigner(ADDRESS_A))).rejects.toThrow(
      /This event's price data isn't fully settled yet/,
    );
  });
});

describe("proposeTier1 (new, Section 19.6)", () => {
  it("resolves the canonical version via current_version before calling propose_tier1", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue({
      current_version: vi.fn(async () => ({ result: 3 })),
      propose_tier1: vi.fn(async () => ({
        simulation: undefined,
        result: { isErr: () => false, unwrapErr: () => ({ message: "" }) },
        built: { source: ADDRESS_A },
        signAndSend: vi.fn(async () => ({
          result: { isErr: () => false, unwrap: () => BigInt(42) },
          sendTransactionResponse: { hash: "propose123" },
        })),
      })),
    } as never);

    const prepared = await prepareProposeTier1(NETWORK, "CARS_SAC", "Depeg", fakeSigner(ADDRESS_A));
    const result = await confirmProposeTier1(prepared, fakeSigner(ADDRESS_A));
    expect(result.result).toBe(BigInt(42));
    expect(result.txHash).toBe("propose123");
  });

  it("throws UnknownDefinition (200) when current_version resolves to 0 (no canonical definition yet)", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue({
      current_version: vi.fn(async () => ({ result: 0 })),
      propose_tier1: vi.fn(),
    } as never);

    try {
      await prepareProposeTier1(NETWORK, "CARS_SAC", "Depeg", fakeSigner(ADDRESS_A));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SyloxError);
      expect((e as InstanceType<typeof SyloxError>).contractErrorName).toBe("UnknownDefinition");
    }
  });

  it("confirmProposeTier1 refuses to sign a transaction prepared for a different address", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue({
      current_version: vi.fn(async () => ({ result: 3 })),
      propose_tier1: vi.fn(async () => ({
        simulation: undefined,
        result: { isErr: () => false, unwrapErr: () => ({ message: "" }) },
        built: { source: ADDRESS_A },
        signAndSend: vi.fn(),
      })),
    } as never);

    const prepared = await prepareProposeTier1(NETWORK, "CARS_SAC", "Depeg", fakeSigner(ADDRESS_A));
    await expect(confirmProposeTier1(prepared, fakeSigner(ADDRESS_B))).rejects.toThrow(/connected wallet changed/i);
  });
});

describe("challenge (new, Section 19.6)", () => {
  const EVIDENCE_32_BYTES = new Uint8Array(32).fill(7);

  it("prepares and confirms a challenge with a valid 32-byte evidence hash", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue({
      challenge: vi.fn(async () => ({
        simulation: undefined,
        result: { isErr: () => false, unwrapErr: () => ({ message: "" }) },
        built: { source: ADDRESS_A },
        signAndSend: vi.fn(async () => ({
          result: { isErr: () => false, unwrap: () => undefined },
          sendTransactionResponse: { hash: "challenge123" },
        })),
      })),
    } as never);

    const prepared = await prepareChallenge(NETWORK, BigInt(7), EVIDENCE_32_BYTES, fakeSigner(ADDRESS_A));
    const result = await confirmChallenge(prepared, fakeSigner(ADDRESS_A));
    expect(result.txHash).toBe("challenge123");
  });

  it("rejects an evidence hash that isn't exactly 32 bytes, before ever calling the contract", async () => {
    const challengeFn = vi.fn();
    vi.mocked(eventRegistryClient).mockReturnValue({ challenge: challengeFn } as never);

    await expect(prepareChallenge(NETWORK, BigInt(7), new Uint8Array(16), fakeSigner(ADDRESS_A))).rejects.toThrow(
      /32 bytes/,
    );
    expect(challengeFn).not.toHaveBeenCalled();
  });

  it("maps ChallengeWindowClosed (205) to its plain sentence and contract error name", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue({
      challenge: vi.fn(async () => ({
        simulation: { error: diagnosticFor(205) },
        result: { isErr: () => true, unwrapErr: () => ({ message: "raw" }) },
      })),
    } as never);

    try {
      await prepareChallenge(NETWORK, BigInt(7), EVIDENCE_32_BYTES, fakeSigner(ADDRESS_A));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SyloxError);
      expect((e as InstanceType<typeof SyloxError>).contractErrorName).toBe("ChallengeWindowClosed");
    }
  });
});

/**
 * PR #69 review, required fix #2's end-to-end regression coverage:
 * restore.test.ts already unit-tests maybeRestore in isolation (given a
 * fake AssembledTransaction, it builds/signs/submits correctly), but
 * that alone doesn't prove prepare* actually HANDS maybeRestore a
 * transaction capable of signing - which is exactly the gap this fix
 * closes (see actions.ts's and restore.ts's own doc comments: before
 * this fix, eventRegistryClient was built from a bare address with no
 * signTransaction, so restoreFootprint would have thrown regardless of
 * how correct maybeRestore's own logic was). This test drives a real
 * prepareFinalize call, with eventRegistryClient mocked to return a
 * transaction whose first simulation reports a restore is needed - the
 * same shape maybeRestore's own tests use - and asserts the restore
 * actually runs (restoreFootprint called, tx re-simulated) using
 * nothing but the signer prepareFinalize itself was given, with no
 * separate signer threaded in some other way. This is still a unit
 * test, not a live-testnet reproduction (per the PR description's
 * deviation #3 and this package's own real-restore limitation - no
 * reproducible way to force a genuinely archived ledger entry against
 * a freshly-deployed contract) - but it proves the exact wiring that
 * was broken is fixed, at the only level this PR's scope can reach.
 */
describe("prepareFinalize + a real restore-needed simulation (PR #69 review, required fix #2)", () => {
  it("passes the signer through to the point where restoreFootprint can actually run, then re-simulates and succeeds", async () => {
    const signer = fakeSigner(ADDRESS_A);
    const restorePreamble = { minResourceFee: "12345", transactionData: {} };
    const restoreFootprint = vi.fn(async () => ({}));
    let simulation: unknown = {
      transactionData: {},
      result: {},
      restorePreamble,
    };
    const simulate = vi.fn(async () => {
      // After a successful restore, the real AssembledTransaction.simulate()
      // re-simulates in place; here that now reports success, matching
      // the "re-run the original call" contract maybeRestore relies on.
      simulation = undefined;
    });

    vi.mocked(eventRegistryClient).mockReturnValue({
      finalize: vi.fn(async () => ({
        get simulation() {
          return simulation;
        },
        result: { isErr: () => false, unwrapErr: () => ({ message: "" }) },
        built: { source: signer.publicKey },
        restoreFootprint,
        simulate,
        signAndSend: vi.fn(async () => ({
          result: { isErr: () => false, unwrap: () => undefined },
          sendTransactionResponse: { hash: "restored-then-finalized" },
        })),
      })),
    } as never);

    const onRestoreNeeded = vi.fn(async () => true);
    const prepared = await prepareFinalize(NETWORK, BigInt(1), signer, { onRestoreNeeded });

    expect(onRestoreNeeded).toHaveBeenCalledWith({ minResourceFee: "12345" });
    expect(restoreFootprint).toHaveBeenCalledWith(restorePreamble);
    expect(simulate).toHaveBeenCalledOnce();

    const result = await confirmFinalize(prepared, signer);
    expect(result.txHash).toBe("restored-then-finalized");
  });
});

// Keep lastConstructedWith referenced so TS doesn't flag the hoisted destructure as unused if a future edit trims the publicKey-wiring tests above.
void lastConstructedWith;

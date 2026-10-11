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
 * the new `(network, publicKey?)` signature, and every thrown-error
 * assertion is rewritten against `SyloxError` (`.message`/`.code`)
 * instead of a plain `Error`'s string message. New tests cover
 * proposeTier1/challenge, which don't exist in the source file (new in
 * this PR, Section 19.6).
 */

const { eventRegistryClient, lastConstructedWith } = vi.hoisted(() => {
  const state = { lastConstructedWith: undefined as string | undefined };
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
    eventRegistryClient: vi.fn((_network: unknown, publicKey?: string) => {
      state.lastConstructedWith = publicKey;
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
  it("prepareCheckpointCure builds the client with the connected address as publicKey", async () => {
    await prepareCheckpointCure(NETWORK, BigInt(1), ADDRESS_A);
    expect(eventRegistryClient).toHaveBeenCalledWith(NETWORK, ADDRESS_A);
  });

  it("the prepared transaction's own built source account equals the connected address", async () => {
    const prepared = await prepareCheckpointCure(NETWORK, BigInt(1), ADDRESS_A);
    expect(prepared.tx.built?.source).toBe(ADDRESS_A);
    expect(prepared.preparedFor).toBe(ADDRESS_A);
  });

  it("prepareFinalize builds the client with the connected address as publicKey", async () => {
    await prepareFinalize(NETWORK, BigInt(1), ADDRESS_B);
    expect(eventRegistryClient).toHaveBeenCalledWith(NETWORK, ADDRESS_B);
  });

  it("confirmCheckpointCure signs and sends when the signer matches who it was prepared for", async () => {
    const prepared = await prepareCheckpointCure(NETWORK, BigInt(1), ADDRESS_A);
    const result = await confirmCheckpointCure(prepared, fakeSigner(ADDRESS_A));
    expect(result.txHash).toBe("abc123");
  });

  it("confirmCheckpointCure refuses to sign a transaction prepared for a different address", async () => {
    const prepared = await prepareCheckpointCure(NETWORK, BigInt(1), ADDRESS_A);
    await expect(confirmCheckpointCure(prepared, fakeSigner(ADDRESS_B))).rejects.toThrow(/connected wallet changed/i);
  });

  it("confirmFinalize refuses to sign a transaction prepared for a different address", async () => {
    const prepared = await prepareFinalize(NETWORK, BigInt(1), ADDRESS_A);
    await expect(confirmFinalize(prepared, fakeSigner(ADDRESS_B))).rejects.toThrow(/connected wallet changed/i);
  });

  it("confirmFinalize signs and sends when the signer matches who it was prepared for", async () => {
    const prepared = await prepareFinalize(NETWORK, BigInt(1), ADDRESS_A);
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

    await expect(prepareCheckpointCure(NETWORK, BigInt(1), ADDRESS_A)).rejects.toThrow(
      "This event has already moved past this step, or doesn't use a cure check.",
    );
    try {
      await prepareCheckpointCure(NETWORK, BigInt(1), ADDRESS_A);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SyloxError);
      expect((e as InstanceType<typeof SyloxError>).code).toBe(206);
      expect((e as InstanceType<typeof SyloxError>).contractErrorName).toBe("WrongState");
    }
  });

  it("prepareFinalize throws a SyloxError with the plain ChallengeWindowOpen (204) sentence, never the raw contract message", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue(fakeErrClient({ prepareErrorCode: 204 }) as never);

    await expect(prepareFinalize(NETWORK, BigInt(1), ADDRESS_A)).rejects.toThrow(
      "The challenge window for this event is still open.",
    );
  });

  it("prepareFinalize falls back to the generic message with the code, for an unmapped error", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue(fakeErrClient({ prepareErrorCode: 5 }) as never);

    await expect(prepareFinalize(NETWORK, BigInt(1), ADDRESS_A)).rejects.toThrow(
      "The contract rejected this action (error 5).",
    );
  });

  it("never lets the raw contract doc-comment text reach the thrown error", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue(fakeErrClient({ prepareErrorCode: 206 }) as never);

    await expect(prepareFinalize(NETWORK, BigInt(1), ADDRESS_A)).rejects.not.toThrow(
      /the raw contract doc comment text/,
    );
  });

  it("confirmCheckpointCure throws the plain mapped sentence when signAndSend itself fails simulation", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue(fakeErrClient({ confirmErrorCode: 215 }) as never);
    const prepared = await prepareCheckpointCure(NETWORK, BigInt(1), ADDRESS_A);

    await expect(confirmCheckpointCure(prepared, fakeSigner(ADDRESS_A))).rejects.toThrow(
      "This event no longer exists.",
    );
  });

  it("confirmFinalize throws the plain mapped sentence when signAndSend itself fails simulation", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue(fakeErrClient({ confirmErrorCode: 213 }) as never);
    const prepared = await prepareFinalize(NETWORK, BigInt(1), ADDRESS_A);

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

    const prepared = await prepareProposeTier1(NETWORK, "CARS_SAC", "Depeg", ADDRESS_A);
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
      await prepareProposeTier1(NETWORK, "CARS_SAC", "Depeg", ADDRESS_A);
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

    const prepared = await prepareProposeTier1(NETWORK, "CARS_SAC", "Depeg", ADDRESS_A);
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

    const prepared = await prepareChallenge(NETWORK, BigInt(7), EVIDENCE_32_BYTES, ADDRESS_A);
    const result = await confirmChallenge(prepared, fakeSigner(ADDRESS_A));
    expect(result.txHash).toBe("challenge123");
  });

  it("rejects an evidence hash that isn't exactly 32 bytes, before ever calling the contract", async () => {
    const challengeFn = vi.fn();
    vi.mocked(eventRegistryClient).mockReturnValue({ challenge: challengeFn } as never);

    await expect(prepareChallenge(NETWORK, BigInt(7), new Uint8Array(16), ADDRESS_A)).rejects.toThrow(
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
      await prepareChallenge(NETWORK, BigInt(7), EVIDENCE_32_BYTES, ADDRESS_A);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SyloxError);
      expect((e as InstanceType<typeof SyloxError>).contractErrorName).toBe("ChallengeWindowClosed");
    }
  });
});

// Keep lastConstructedWith referenced so TS doesn't flag the hoisted destructure as unused if a future edit trims the publicKey-wiring tests above.
void lastConstructedWith;

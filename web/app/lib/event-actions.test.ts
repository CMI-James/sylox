import { describe, expect, it, vi } from "vitest";
import {
  prepareCheckpointCure,
  confirmCheckpointCure,
  prepareFinalize,
  confirmFinalize,
} from "./event-actions";

/**
 * Fakes eventRegistryClient(publicKey) itself, so these tests can
 * assert on the exact publicKey it was constructed with - the one
 * thing that actually proves the fix (eventRegistryClient bakes
 * publicKey into the built transaction's own source account; see
 * lib/contracts/event-registry.ts's doc comment, confirmed live
 * against testnet: tx.built.source === the publicKey passed in).
 */
const { eventRegistryClient, lastConstructedWith } = vi.hoisted(() => {
  const state = { lastConstructedWith: undefined as string | undefined };
  const client = {
    checkpoint_cure: vi.fn(async () => ({
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
      result: { isErr: () => false, unwrapErr: () => ({ message: "" }) },
      built: { source: state.lastConstructedWith },
      signAndSend: vi.fn(async () => ({
        result: { isErr: () => false, unwrap: () => undefined },
        sendTransactionResponse: { hash: "def456" },
      })),
    })),
  };
  return {
    eventRegistryClient: vi.fn((publicKey?: string) => {
      state.lastConstructedWith = publicKey;
      return client;
    }),
    lastConstructedWith: state,
  };
});

vi.mock("./contracts/event-registry", () => ({ eventRegistryClient }));

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
    await prepareCheckpointCure(BigInt(1), ADDRESS_A);
    expect(eventRegistryClient).toHaveBeenCalledWith(ADDRESS_A);
  });

  it("the prepared transaction's own built source account equals the connected address", async () => {
    const prepared = await prepareCheckpointCure(BigInt(1), ADDRESS_A);
    expect(prepared.tx.built?.source).toBe(ADDRESS_A);
    expect(prepared.preparedFor).toBe(ADDRESS_A);
  });

  it("prepareFinalize builds the client with the connected address as publicKey", async () => {
    await prepareFinalize(BigInt(1), ADDRESS_B);
    expect(eventRegistryClient).toHaveBeenCalledWith(ADDRESS_B);
  });

  it("confirmCheckpointCure signs and sends when the signer matches who it was prepared for", async () => {
    const prepared = await prepareCheckpointCure(BigInt(1), ADDRESS_A);
    const result = await confirmCheckpointCure(prepared, fakeSigner(ADDRESS_A));
    expect(result.txHash).toBe("abc123");
  });

  it("confirmCheckpointCure refuses to sign a transaction prepared for a different address", async () => {
    const prepared = await prepareCheckpointCure(BigInt(1), ADDRESS_A);
    await expect(confirmCheckpointCure(prepared, fakeSigner(ADDRESS_B))).rejects.toThrow(
      /connected wallet changed/i,
    );
  });

  it("confirmFinalize refuses to sign a transaction prepared for a different address", async () => {
    const prepared = await prepareFinalize(BigInt(1), ADDRESS_A);
    await expect(confirmFinalize(prepared, fakeSigner(ADDRESS_B))).rejects.toThrow(
      /connected wallet changed/i,
    );
  });

  it("confirmFinalize signs and sends when the signer matches who it was prepared for", async () => {
    const prepared = await prepareFinalize(BigInt(1), ADDRESS_A);
    const result = await confirmFinalize(prepared, fakeSigner(ADDRESS_A));
    expect(result.txHash).toBe("def456");
  });
});

/**
 * The real error-mapping path: prepareCheckpointCure/prepareFinalize
 * throw plain copy from lib/contract-errors.ts, never the contract's
 * raw doc-comment message (what EVERY other test in this file's own
 * fakes return as "" for, so this path had no coverage at all before
 * these tests existed). Each fake simulates a real `.simulation.error`
 * diagnostic (confirmed against live testnet - see
 * contract-errors.test.ts) so extractErrorCode's real parsing runs,
 * not just the describe* mapping on its own.
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
  it("prepareCheckpointCure throws the plain WrongState (206) sentence, never the raw contract message", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue(fakeErrClient({ prepareErrorCode: 206 }) as never);

    await expect(prepareCheckpointCure(BigInt(1), ADDRESS_A)).rejects.toThrow(
      "Couldn't check the cure progress: This event has already moved past this step, or doesn't use a cure check.",
    );
  });

  it("prepareFinalize throws the plain ChallengeWindowOpen (204) sentence, never the raw contract message", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue(fakeErrClient({ prepareErrorCode: 204 }) as never);

    await expect(prepareFinalize(BigInt(1), ADDRESS_A)).rejects.toThrow(
      "Couldn't finalize this event: The challenge window for this event is still open.",
    );
  });

  it("prepareFinalize falls back to the generic message with the code, for an unmapped error", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue(fakeErrClient({ prepareErrorCode: 5 }) as never);

    await expect(prepareFinalize(BigInt(1), ADDRESS_A)).rejects.toThrow(
      "Couldn't finalize this event: The contract rejected this action (error 5).",
    );
  });

  it("never lets the raw contract doc-comment text reach the thrown error", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue(fakeErrClient({ prepareErrorCode: 206 }) as never);

    await expect(prepareFinalize(BigInt(1), ADDRESS_A)).rejects.not.toThrow(/the raw contract doc comment text/);
  });

  it("confirmCheckpointCure throws the plain mapped sentence when signAndSend itself fails simulation", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue(fakeErrClient({ confirmErrorCode: 215 }) as never);
    const prepared = await prepareCheckpointCure(BigInt(1), ADDRESS_A);

    await expect(confirmCheckpointCure(prepared, fakeSigner(ADDRESS_A))).rejects.toThrow(
      "Couldn't check the cure progress: This event no longer exists.",
    );
  });

  it("confirmFinalize throws the plain mapped sentence when signAndSend itself fails simulation", async () => {
    vi.mocked(eventRegistryClient).mockReturnValue(fakeErrClient({ confirmErrorCode: 213 }) as never);
    const prepared = await prepareFinalize(BigInt(1), ADDRESS_A);

    await expect(confirmFinalize(prepared, fakeSigner(ADDRESS_A))).rejects.toThrow(
      /Couldn't finalize this event: This event's price data isn't fully settled yet/,
    );
  });
});

import { describe, expect, it } from "vitest";
import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import {
  extractErrorCode,
  finalizeError,
  checkpointCureError,
  scoreError,
  coverGateError,
  proposeTier1Error,
  challengeError,
  SyloxError,
} from "./errors.js";

/**
 * Ported from web/app/lib/contract-errors.test.ts, ADAPTED: the source
 * file's `describe*Error(code)` functions returned a plain string;
 * this SDK's equivalents (finalizeError/checkpointCureError/
 * scoreError/coverGateError) construct and return a `SyloxError`
 * instance instead (per Section 19.7's "the SDK throws SyloxError with
 * the contract error name"), so every assertion against a returned
 * string below is rewritten against `.message`, plus new assertions on
 * `.code` and `.contractErrorName` that didn't exist in the source
 * file (the richer shape is this PR's whole reason for existing).
 */

/** A minimal fake AssembledTransaction - extractErrorCode only ever reads `.simulation`. */
function fakeTx(simulation: unknown): AssembledTransaction<unknown> {
  return { simulation } as unknown as AssembledTransaction<unknown>;
}

// The exact diagnostic text format real testnet RPC returns (confirmed
// directly against live testnet before writing this fixture).
function diagnosticFor(code: number): string {
  return `HostError: Error(Contract, #${code})\n\nEvent log (newest first):\n   0: [Diagnostic Event] ...`;
}

describe("extractErrorCode", () => {
  it("extracts the numeric code from a real simulation error diagnostic", () => {
    const tx = fakeTx({ error: diagnosticFor(206) });
    expect(extractErrorCode(tx)).toBe(206);
  });

  it("extracts a different code correctly, not just the first one seen in tests", () => {
    const tx = fakeTx({ error: diagnosticFor(215) });
    expect(extractErrorCode(tx)).toBe(215);
  });

  it("returns null for a successful simulation (no 'error' field at all)", () => {
    const tx = fakeTx({ transactionData: "whatever", result: 42 });
    expect(extractErrorCode(tx)).toBeNull();
  });

  it("returns null when there's no simulation at all (e.g. a transaction never simulated)", () => {
    const tx = fakeTx(undefined);
    expect(extractErrorCode(tx)).toBeNull();
  });

  it("returns null when the error field doesn't match the expected Error(Contract, #N) shape", () => {
    const tx = fakeTx({ error: "some unrelated network failure, not a contract error at all" });
    expect(extractErrorCode(tx)).toBeNull();
  });
});

describe("SyloxError", () => {
  it("is a real Error subclass with name 'SyloxError'", () => {
    const e = finalizeError(206);
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(SyloxError);
    expect(e.name).toBe("SyloxError");
  });
});

describe("finalizeError", () => {
  it("maps WrongState (206) to a plain, finalize-specific sentence and its contract error name", () => {
    const e = finalizeError(206);
    expect(e.message).toBe("This event has already moved past this step.");
    expect(e.code).toBe(206);
    expect(e.contractErrorName).toBe("WrongState");
  });

  it("maps UnknownEvent (215) to a plain sentence and its contract error name", () => {
    const e = finalizeError(215);
    expect(e.message).toBe("This event no longer exists.");
    expect(e.contractErrorName).toBe("UnknownEvent");
  });

  it("maps ChallengeWindowOpen (204) to a plain sentence", () => {
    expect(finalizeError(204).message).toBe("The challenge window for this event is still open.");
  });

  it("maps DataNotFinal (213) to a plain sentence", () => {
    expect(finalizeError(213).message).toMatch(/isn't fully settled/i);
  });

  it("never returns the raw contract doc-comment text for a mapped code", () => {
    const result = finalizeError(206).message;
    expect(result).not.toMatch(/Proposed.*Escalated/); // The real WrongState doc comment's own wording.
  });

  it("falls back to a generic message with the code, and a null contractErrorName, for a code with no plain sentence yet", () => {
    const e = finalizeError(999);
    expect(e.message).toBe("The contract rejected this action (error 999).");
    expect(e.contractErrorName).toBeNull();
    expect(e.code).toBe(999);
  });

  it("falls back to a generic message with no code, when none could be extracted", () => {
    const e = finalizeError(null);
    expect(e.message).toBe("The contract rejected this action.");
    expect(e.code).toBeNull();
    expect(e.contractErrorName).toBeNull();
  });
});

describe("checkpointCureError", () => {
  it("maps WrongState (206) to a checkpoint-specific sentence, distinct from finalize's own wording", () => {
    const e = checkpointCureError(206);
    expect(e.message).toMatch(/already moved past this step/i);
    expect(e.message).not.toBe(finalizeError(206).message); // Same code, different action, different copy.
    expect(e.contractErrorName).toBe("WrongState");
  });

  it("maps UnknownEvent (215) to a plain sentence", () => {
    expect(checkpointCureError(215).message).toBe("This event no longer exists.");
  });

  it("falls back to the generic message for an unmapped code", () => {
    expect(checkpointCureError(42).message).toBe("The contract rejected this action (error 42).");
  });

  it("falls back to the generic message with no code", () => {
    expect(checkpointCureError(null).message).toBe("The contract rejected this action.");
  });
});

describe("scoreError", () => {
  it("maps UnknownAsset (100) to a plain sentence and its contract error name", () => {
    const e = scoreError(100);
    expect(e.message).toBe("This asset isn't tracked by the oracle.");
    expect(e.contractErrorName).toBe("UnknownAsset");
  });

  it("falls back to the generic message for an unmapped code", () => {
    expect(scoreError(5).message).toBe("The contract rejected this action (error 5).");
  });
});

describe("coverGateError", () => {
  it("maps NotInitialized (2) to a plain sentence", () => {
    expect(coverGateError(2).message).toMatch(/protocol isn't ready/i);
  });

  it("falls back to the generic message for an unmapped code", () => {
    expect(coverGateError(201).message).toBe("The contract rejected this action (error 201).");
  });

  it("falls back to the generic message with no code", () => {
    expect(coverGateError(null).message).toBe("The contract rejected this action.");
  });
});

describe("proposeTier1Error", () => {
  it("maps EventInProgress (201) to a plain sentence and its contract error name", () => {
    const e = proposeTier1Error(201);
    expect(e.message).toBe("An event is already open for this asset and kind.");
    expect(e.contractErrorName).toBe("EventInProgress");
  });

  it("maps Tier1CheckFailed (202) to a plain sentence", () => {
    expect(proposeTier1Error(202).contractErrorName).toBe("Tier1CheckFailed");
  });

  it("maps VersionNotCovered (214) to a plain sentence", () => {
    expect(proposeTier1Error(214).contractErrorName).toBe("VersionNotCovered");
  });

  it("falls back to the generic message for an unmapped code", () => {
    expect(proposeTier1Error(999).message).toBe("The contract rejected this action (error 999).");
  });
});

describe("challengeError", () => {
  it("maps ChallengeWindowClosed (205) to a plain sentence and its contract error name", () => {
    const e = challengeError(205);
    expect(e.contractErrorName).toBe("ChallengeWindowClosed");
  });

  it("maps WrongState (206) to a challenge-specific sentence, distinct from finalize's own wording", () => {
    const e = challengeError(206);
    expect(e.contractErrorName).toBe("WrongState");
    expect(e.message).not.toBe(finalizeError(206).message);
  });

  it("falls back to the generic message for an unmapped code", () => {
    expect(challengeError(999).message).toBe("The contract rejected this action (error 999).");
  });
});

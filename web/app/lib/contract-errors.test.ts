import { describe, expect, it } from "vitest";
import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import {
  extractErrorCode,
  describeFinalizeError,
  describeCheckpointCureError,
  describeScoreError,
  describeCoverGateError,
} from "./contract-errors";

/** A minimal fake AssembledTransaction - extractErrorCode only ever reads `.simulation`. */
function fakeTx(simulation: unknown): AssembledTransaction<unknown> {
  return { simulation } as unknown as AssembledTransaction<unknown>;
}

// The exact diagnostic text format real testnet RPC returns (confirmed
// directly against live testnet before writing this fixture - see
// contract-errors.ts's own doc comment on extractErrorCode).
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

describe("describeFinalizeError", () => {
  it("maps WrongState (206) to a plain, finalize-specific sentence", () => {
    expect(describeFinalizeError(206)).toBe("This event has already moved past this step.");
  });

  it("maps UnknownEvent (215) to a plain sentence", () => {
    expect(describeFinalizeError(215)).toBe("This event no longer exists.");
  });

  it("maps ChallengeWindowOpen (204) to a plain sentence", () => {
    expect(describeFinalizeError(204)).toBe("The challenge window for this event is still open.");
  });

  it("maps DataNotFinal (213) to a plain sentence", () => {
    expect(describeFinalizeError(213)).toMatch(/isn't fully settled/i);
  });

  it("never returns the raw contract doc-comment text for a mapped code", () => {
    const result = describeFinalizeError(206);
    expect(result).not.toMatch(/Proposed.*Escalated/); // The real WrongState doc comment's own wording.
  });

  it("falls back to a generic message with the code, for a code with no plain sentence yet", () => {
    expect(describeFinalizeError(999)).toBe("The contract rejected this action (error 999).");
  });

  it("falls back to a generic message with no code, when none could be extracted", () => {
    expect(describeFinalizeError(null)).toBe("The contract rejected this action.");
  });
});

describe("describeCheckpointCureError", () => {
  it("maps WrongState (206) to a checkpoint-specific sentence, distinct from finalize's own wording", () => {
    const message = describeCheckpointCureError(206);
    expect(message).toMatch(/already moved past this step/i);
    expect(message).not.toBe(describeFinalizeError(206)); // Same code, different action, different copy.
  });

  it("maps UnknownEvent (215) to a plain sentence", () => {
    expect(describeCheckpointCureError(215)).toBe("This event no longer exists.");
  });

  it("falls back to the generic message for an unmapped code", () => {
    expect(describeCheckpointCureError(42)).toBe("The contract rejected this action (error 42).");
  });

  it("falls back to the generic message with no code", () => {
    expect(describeCheckpointCureError(null)).toBe("The contract rejected this action.");
  });
});

describe("describeScoreError", () => {
  it("maps UnknownAsset (100) to a plain sentence", () => {
    expect(describeScoreError(100)).toBe("This asset isn't tracked by the oracle.");
  });

  it("falls back to the generic message for an unmapped code", () => {
    expect(describeScoreError(5)).toBe("The contract rejected this action (error 5).");
  });
});

describe("describeCoverGateError", () => {
  it("maps NotInitialized (2) to a plain sentence", () => {
    expect(describeCoverGateError(2)).toMatch(/oracle isn't ready/i);
  });

  it("falls back to the generic message for an unmapped code", () => {
    expect(describeCoverGateError(201)).toBe("The contract rejected this action (error 201).");
  });

  it("falls back to the generic message with no code", () => {
    expect(describeCoverGateError(null)).toBe("The contract rejected this action.");
  });
});

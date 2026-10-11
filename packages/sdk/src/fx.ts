/**
 * Fixed-point display helpers. "al.fx converts for display only"
 * (Section 19.7) - pure functions, no I/O, never used in a write path's
 * own argument-building (amounts stay `bigint` in base units
 * everywhere else in this SDK).
 */

// RiskOracle's peg_ratio is an i128, scale 1e7 (asset-data.ts's own
// PEG_RATIO_SCALE, confirmed against RiskOracle's doc comment on
// peg_ratio - same convention this SDK's al.oracle module reads
// straight off the contract).
const PEG_RATIO_SCALE = 10_000_000;

// Every Stellar Asset Contract (SAC) - including TUSD and the tracked
// USDC SAC this repo's deployments/testnet.json points at - wraps a
// classic Stellar asset 1:1, and classic Stellar assets are fixed at 7
// decimal places by the protocol itself (not a per-asset choice a SAC
// could override). The generated token bindings' own `decimals()`
// (web/app/lib/contracts/token/src/client.ts) is a REAL contract read,
// not a hardcoded constant on the TS side - this helper hardcodes 7 as
// the known SAC convention for a plain display helper, but any caller
// that needs to be certain for a SPECIFIC contract id should still call
// that asset's own `decimals()` rather than assume this constant covers
// a non-SAC token this SDK hasn't verified.
const TOKEN_AMOUNT_SCALE = 10_000_000;

/**
 * Converts a peg-ratio-scale i128 value (RiskOracle's own peg_ratio,
 * SignalSet fields, etc. - scale 1e7) to a plain JS number for display.
 * Never used to build a contract call argument - the contract itself
 * only ever sees the bigint.
 */
export function toNumber(i128Value: bigint): number {
  return Number(i128Value) / PEG_RATIO_SCALE;
}

/**
 * Converts a human-readable USDC/token-style decimal string (e.g.
 * "20000" or "20000.5") to its base-unit bigint (7 decimals, the
 * classic Stellar Asset Contract convention every SAC in this protocol
 * uses - TUSD, the tracked USDC SAC, and any future series collateral
 * alike). Throws a plain `Error` (not `SyloxError` - this is a pure
 * input-validation failure, never a contract rejection) for a value
 * that isn't a valid non-negative decimal number.
 */
export function usdc(amount: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error(`Invalid USDC amount: "${amount}" - expected a non-negative decimal string.`);
  }
  const [whole, fraction = ""] = amount.split(".");
  if (fraction.length > 7) {
    throw new Error(`Invalid USDC amount: "${amount}" - at most 7 decimal places are representable.`);
  }
  const paddedFraction = fraction.padEnd(7, "0");
  return BigInt(whole) * BigInt(TOKEN_AMOUNT_SCALE) + BigInt(paddedFraction || "0");
}

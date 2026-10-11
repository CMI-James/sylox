import { describe, expect, it } from "vitest";
import { toNumber, usdc } from "./fx.js";

describe("toNumber", () => {
  it("converts a peg-ratio-scale (1e7) bigint to its decimal number", () => {
    expect(toNumber(BigInt(9_934_000))).toBeCloseTo(0.9934, 10);
  });

  it("converts exactly 1.0 (scale value itself) to 1", () => {
    expect(toNumber(BigInt(10_000_000))).toBe(1);
  });

  it("converts 0 to 0", () => {
    expect(toNumber(BigInt(0))).toBe(0);
  });

  it("converts a negative value correctly (a peg ratio is never negative in practice, but the helper itself is a pure division)", () => {
    expect(toNumber(BigInt(-5_000_000))).toBe(-0.5);
  });
});

describe("usdc", () => {
  it("converts a whole-number decimal string to its base-unit bigint (7 decimals)", () => {
    expect(usdc("20000")).toBe(BigInt(200_000_000_000));
  });

  it("converts a fractional decimal string to its base-unit bigint", () => {
    expect(usdc("1.5")).toBe(BigInt(15_000_000));
  });

  it("converts a fully-specified 7-decimal fraction exactly", () => {
    expect(usdc("1.1234567")).toBe(BigInt(11_234_567));
  });

  it("converts zero", () => {
    expect(usdc("0")).toBe(BigInt(0));
  });

  it("round-trips with toNumber for a representable value", () => {
    const amount = usdc("100000");
    expect(toNumber(amount)).toBe(100_000);
  });

  it("throws on a negative amount", () => {
    expect(() => usdc("-5")).toThrow(/Invalid USDC amount/);
  });

  it("throws on a non-numeric string", () => {
    expect(() => usdc("abc")).toThrow(/Invalid USDC amount/);
  });

  it("throws on more than 7 decimal places", () => {
    expect(() => usdc("1.12345678")).toThrow(/at most 7 decimal places/);
  });

  it("throws on an empty string", () => {
    expect(() => usdc("")).toThrow(/Invalid USDC amount/);
  });
});

import { describe, expect, it } from "vitest";
import { planChunks, type LedgerRange } from "./chunk-plan.js";

// Ported verbatim from web/app/lib/chunk-plan.test.ts - chunk-plan.ts
// itself is pure and synchronous, with no framework dependency, so
// this test needed no adaptation beyond the import path's .js
// extension (NodeNext).

function assertNoGapOrOverlap(ranges: LedgerRange[], floor: number, latestLedger: number) {
  for (let i = 1; i < ranges.length; i++) {
    expect(ranges[i].end).toBe(ranges[i - 1].start);
  }
  if (ranges.length > 0) {
    expect(ranges[0].end).toBe(latestLedger + 1);
    expect(ranges[ranges.length - 1].start).toBe(floor);
  }
  for (const r of ranges) {
    expect(r.start).toBeLessThan(r.end);
    expect(r.start).toBeGreaterThanOrEqual(floor);
    expect(r.end).toBeLessThanOrEqual(latestLedger + 1);
  }
}

describe("planChunks", () => {
  it("exact multiple of the chunk size", () => {
    const ranges = planChunks(9999, 0, 1000);
    expect(ranges).toHaveLength(10);
    assertNoGapOrOverlap(ranges, 0, 9999);
    expect(ranges[0]).toEqual({ start: 9000, end: 10000 });
    expect(ranges[ranges.length - 1]).toEqual({ start: 0, end: 1000 });
  });

  it("window not a multiple of the chunk size - last range is the remainder", () => {
    const ranges = planChunks(9500, 0, 1000);
    assertNoGapOrOverlap(ranges, 0, 9500);
    expect(ranges[ranges.length - 1]).toEqual({ start: 0, end: 501 });
    expect(ranges[ranges.length - 1].end - ranges[ranges.length - 1].start).toBe(501);
  });

  it("window smaller than one chunk - a single, smaller range", () => {
    const ranges = planChunks(1050, 1000, 2000);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({ start: 1000, end: 1051 });
    assertNoGapOrOverlap(ranges, 1000, 1050);
  });

  it("latest == floor - a single one-ledger range", () => {
    const ranges = planChunks(5000, 5000, 2000);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({ start: 5000, end: 5001 });
  });

  it("latest < floor - no ranges at all", () => {
    expect(planChunks(100, 200, 50)).toEqual([]);
  });

  it("adjacent ranges touch exactly, newest first, with no gap or overlap - real-world size", () => {
    const latest = 5116000;
    const floor = latest - 120_960;
    const ranges = planChunks(latest, floor, 2000);
    assertNoGapOrOverlap(ranges, floor, latest);
    expect(ranges).toHaveLength(61);
  });

  it("rejects a non-positive chunk size", () => {
    expect(() => planChunks(100, 0, 0)).toThrow();
    expect(() => planChunks(100, 0, -5)).toThrow();
  });
});

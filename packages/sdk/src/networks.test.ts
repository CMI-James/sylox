import { describe, expect, it } from "vitest";
import { Networks } from "./networks.js";

/**
 * Networks.Testnet is generated at import time from the real
 * deployments/testnet.json (and, optionally, testnet-demo-asset.json)
 * on disk - these tests run against whatever is actually checked out,
 * not a fixture, since the whole point of this module is to never
 * drift from that file. See networks.ts's own doc comment for why a
 * static JSON import is used for testnet.json but a guarded `fs` read
 * for the optional demo-asset file.
 */
describe("Networks.Testnet", () => {
  it("exposes rpcUrl and networkPassphrase from deployments/testnet.json", () => {
    expect(Networks.Testnet.rpcUrl).toBe("https://soroban-testnet.stellar.org");
    expect(Networks.Testnet.networkPassphrase).toBe("Test SDF Network ; September 2015");
  });

  it("exposes only riskOracle and eventRegistry contract ids - no staking/treasury (out of this PR's scope)", () => {
    expect(Networks.Testnet.contracts.riskOracle).toMatch(/^C[A-Z0-9]{55}$/);
    expect(Networks.Testnet.contracts.eventRegistry).toMatch(/^C[A-Z0-9]{55}$/);
    expect(Networks.Testnet.contracts).not.toHaveProperty("staking");
    expect(Networks.Testnet.contracts).not.toHaveProperty("treasury");
  });

  it("demoAsset is either absent or a well-shaped object - never throws either way", () => {
    // This asserts the module import itself never throws regardless of
    // whether testnet-demo-asset.json happens to exist in this
    // checkout (see networks.ts's loadOptionalDemoAsset doc comment -
    // the whole point is graceful absence, not a fixed expectation of
    // presence).
    if (Networks.Testnet.demoAsset) {
      expect(typeof Networks.Testnet.demoAsset.contract_id).toBe("string");
      expect(typeof Networks.Testnet.demoAsset.asset_code).toBe("string");
    } else {
      expect(Networks.Testnet.demoAsset).toBeUndefined();
    }
  });

  it("is a plain, already-built object - not a function a caller would need to invoke", () => {
    expect(typeof Networks.Testnet).toBe("object");
    expect(typeof Networks.Testnet.rpcUrl).toBe("string");
  });
});

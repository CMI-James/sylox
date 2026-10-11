/**
 * GENERATED FILE - do not edit by hand.
 *
 * Produced by scripts/generate-networks.mjs from
 * deployments/testnet.json and deployments/testnet-demo-asset.json at
 * the repo root. Regenerate with `npm run generate:networks -w
 * packages/sdk` (also runs automatically before `build`/`test` via
 * this package's prebuild/pretest npm scripts) any time either source
 * file changes - e.g. after a contract redeploy - then commit the
 * result. CI's sdk-networks-drift job (.github/workflows/ci.yml) fails
 * the build if this file is out of sync with those two source files, so
 * it cannot silently drift.
 *
 * Both source files are build-time inputs, not optional runtime reads:
 * both are committed to the repo (deployments/testnet-demo-asset.json
 * since PR #60), and this generator fails loudly if either is missing
 * or malformed rather than producing a partial file.
 */

export const GENERATED_TESTNET_NETWORK = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  contracts: {
    riskOracle: "CD73S5ZPCPPPI2WSSUMGMEETM7YUSLDNQRHQEZNELB3NBHXJWYAGJEXE",
    eventRegistry: "CA7CQNGU6X7DAJUN747KZHA3YDNO4GBLWVDU45BUBVKLEV7H3CVIP6EF",
  },
  demoAsset: {
    "contract_id": "CAPGF3AMXYKRJ6CBONVDRIB7NZNP4HPNLJ5U5YKQ67CC5IWRG435PGT3",
    "asset_code": "DEMOUSD",
    "issuer": "GAZHWYDFGFK2JDE4K74PVCZ6WTLG4IULZ2FFVEYIZDT2JK2YPHJUQP4L",
    "holder": "GCINECIQIQW3W4TTGVFMK7DGTHXYMD22PNYNF5LLJOES3EWDIDM5VFSG",
    "note": "SAMPLE asset only, auth_revocable + clawback_enabled, never real value. Never call this a real stablecoin."
  },
} as const;

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Unlike packages/sdk's own vitest config, scripts/ is NOT
    // excluded here - scripts/generate-contract-reference.mjs is
    // exactly the kind of generation-script logic this repo's own
    // convention (packages/sdk/scripts/generate-networks.mjs) says is
    // worth testing (given deliberately malformed/minimal fixture
    // source instead of this repo's own real files, so the test
    // doesn't depend on packages/sdk's current real contents - see
    // scripts/generate-contract-reference.test.ts).
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
});

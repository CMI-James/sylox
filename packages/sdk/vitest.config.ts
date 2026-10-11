import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // scripts/smoke.ts hits live testnet RPC - never part of the
    // default `npm test` run (which must stay independent of testnet
    // uptime). Run it explicitly via `npm run bindings:generate`-style
    // direct invocation (tsx/node scripts/smoke.ts), not through vitest.
    exclude: ["**/node_modules/**", "**/dist/**", "**/scripts/**"],
  },
});

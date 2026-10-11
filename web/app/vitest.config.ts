import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // scripts/smoke-write-path.test.ts hits live testnet RPC - never
    // part of the default `npm test` run (which must stay independent
    // of testnet uptime), only runnable explicitly via
    // `npm run smoke:write-path -w web/app` (see its own header
    // comment, and the README's "Write-path smoke test" section).
    exclude: ["**/node_modules/**", "**/e2e/**", "**/scripts/smoke-write-path.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});

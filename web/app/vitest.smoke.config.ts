import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Runs ONLY scripts/smoke-write-path.test.ts against live testnet RPC.
// A standalone config (not merged with vitest.config.ts) because that
// base config excludes this exact file by name - see its own comment -
// and Vitest/Vite's mergeConfig concatenates exclude arrays rather
// than letting an override clear them, so merging could not un-exclude
// it. Invoked via `npm run smoke:write-path -w web/app`, never from
// `npm test` or CI.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["scripts/smoke-write-path.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./vitest.global-setup.ts"],
    pool: "forks",
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
});

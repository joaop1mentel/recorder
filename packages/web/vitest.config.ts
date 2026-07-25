import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@rt/core": resolve(__dirname, "../core/src/index.ts") },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});

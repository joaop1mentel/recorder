import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * Build separado do content script do Meet.
 *
 * Content scripts do Manifest V3 não são ES modules: não podem ter `import`/
 * `export` no arquivo final. Por isso este build usa formato **IIFE** e roda
 * como um segundo passo (`vite build --config vite.config.content.ts`), sem
 * `emptyOutDir` para não apagar o que o build principal já gerou.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@rt/core": resolve(__dirname, "../../packages/core/src/index.ts"),
      "@rt/web": resolve(__dirname, "../../packages/web/src/index.ts"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "esnext",
    lib: {
      entry: resolve(__dirname, "src/content/meet.ts"),
      formats: ["iife"],
      name: "RecorderMeet",
      fileName: () => "content-meet.js",
    },
  },
});

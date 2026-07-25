import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// @rt/core é código-fonte TS do workspace: usamos alias para o Vite compilá-lo
// junto com o app (em vez de tentar pré-empacotar como dependência node_modules).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@rt/core": resolve(__dirname, "../../packages/core/src/index.ts"),
      // o worker precisa vir ANTES do alias do pacote, senão "@rt/web" casa primeiro
      "@rt/web/whisper.worker": resolve(
        __dirname,
        "../../packages/web/src/whisper.worker.ts",
      ),
      "@rt/web": resolve(__dirname, "../../packages/web/src/index.ts"),
    },
  },
  optimizeDeps: { exclude: ["@rt/core", "@rt/web"] },
  worker: { format: "es" },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "esnext",
    rollupOptions: {
      input: {
        panel: resolve(__dirname, "panel.html"),
        permiso: resolve(__dirname, "permiso.html"),
        offscreen: resolve(__dirname, "offscreen.html"),
        background: resolve(__dirname, "src/background.ts"),
      },
      output: {
        // background precisa de nome estável (referenciado no manifest);
        // o resto pode ser versionado com hash.
        entryFileNames: (chunk) =>
          chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});

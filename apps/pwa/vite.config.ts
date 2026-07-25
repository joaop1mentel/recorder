import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { resolve } from "node:path";

// O GitHub Pages serve o site numa subpasta (`/<repo>/`). Sem `base` correto, o
// service worker e os assets apontariam para a raiz do domínio e o app quebraria
// só em produção. Trocar por `/` se um dia for para um domínio próprio.
const base = process.env.PWA_BASE ?? "/recorder-translator/";

export default defineConfig({
  base,
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
  build: { target: "esnext" },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["capture-worklet.js", "icone-192.png", "icone-512.png"],
      manifest: {
        name: "Recorder — gravar e transcrever",
        short_name: "Recorder",
        description:
          "Grava conversas e transcreve offline no próprio aparelho. Nada é enviado para a internet.",
        lang: "pt-BR",
        start_url: base,
        scope: base,
        display: "standalone",
        orientation: "portrait",
        background_color: "#18181b",
        theme_color: "#18181b",
        icons: [
          { src: "icone-192.png", sizes: "192x192", type: "image/png" },
          { src: "icone-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icone-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // o runtime do onnxruntime tem ~21 MB e precisa estar em cache para o app
        // funcionar offline; o padrão do Workbox recusaria um arquivo desse tamanho
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,wasm,mjs,png,svg}"],
        // O mesmo .wasm de 21 MB sai duas vezes do build: em `ort/` (copiado por
        // nós, e o único que o runtime busca, via `wasmPaths`) e em `assets/`
        // (emitido pelo bundler ao seguir o import do onnxruntime, nunca usado).
        // Sem esta exclusão o celular baixaria 43 MB em vez de 21 MB na instalação.
        globIgnores: ["**/assets/ort-wasm-*.wasm"],
        runtimeCaching: [
          {
            // O modelo Whisper (~78 MB) NÃO entra no precache — travaria a
            // instalação. É baixado sob demanda na 1ª transcrição e fica em
            // cache a partir daí.
            urlPattern: /^https:\/\/huggingface\.co\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "modelos-whisper",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});

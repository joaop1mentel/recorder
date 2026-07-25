// Copia para o `public/` do app que chamar:
//   - o runtime onnxruntime-web (.mjs + .wasm), servido localmente para o
//     Whisper funcionar offline e sem depender de CDN (a CSP da extensão
//     bloquearia o script remoto de qualquer forma);
//   - o `capture-worklet.js`, que precisa ser arquivo real de mesma origem.
//
// Uso:  node ../../packages/web/scripts/copy-assets.mjs <destino-public>
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgWeb = join(here, "..");
const root = join(pkgWeb, "..", "..");

const destPublic = resolve(process.argv[2] ?? "public");
const destOrt = join(destPublic, "ort");

const arquivosOrt = [
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];

const candidatos = [
  join(root, "node_modules", "onnxruntime-web", "dist"),
  join(pkgWeb, "node_modules", "onnxruntime-web", "dist"),
];
const srcDir = candidatos.find((d) => existsSync(join(d, arquivosOrt[0])));

if (!srcDir) {
  console.error(
    "[copy-assets] onnxruntime-web não encontrado — rode `npm install` na raiz primeiro.",
  );
  process.exit(1);
}

mkdirSync(destOrt, { recursive: true });
for (const f of arquivosOrt) copyFileSync(join(srcDir, f), join(destOrt, f));

mkdirSync(destPublic, { recursive: true });
copyFileSync(
  join(pkgWeb, "public", "capture-worklet.js"),
  join(destPublic, "capture-worklet.js"),
);

console.log(`[copy-assets] ort/ + capture-worklet.js -> ${destPublic}`);

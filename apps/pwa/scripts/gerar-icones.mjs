// Gera os ícones do PWA a partir de um SVG inline, para não versionar binários.
// Rode uma vez: node scripts/gerar-icones.mjs
// (o sharp já vem instalado como dependência do @huggingface/transformers)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, "..", "public");
mkdirSync(dest, { recursive: true });

// Microfone simples em fundo escuro; a margem generosa serve ao ícone
// "maskable" do Android, que recorta as bordas.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#18181b"/>
  <g fill="#ef4444">
    <rect x="216" y="120" width="80" height="160" rx="40"/>
    <path d="M168 248a88 88 0 0 0 176 0h-32a56 56 0 0 1-112 0z"/>
    <rect x="240" y="336" width="32" height="56" rx="8"/>
    <rect x="192" y="376" width="128" height="28" rx="14"/>
  </g>
</svg>`;

for (const tamanho of [192, 512]) {
  const buf = await sharp(Buffer.from(svg)).resize(tamanho, tamanho).png().toBuffer();
  writeFileSync(join(dest, `icone-${tamanho}.png`), buf);
  console.log(`[icones] icone-${tamanho}.png`);
}

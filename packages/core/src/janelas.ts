import type { AudioChunk, FalaGravada } from "./ports.js";
import type { FonteAudio } from "./segments.js";
import { paraFloat32 } from "./util.js";

export interface OpcoesJanela {
  /** teto de uma janela, em ms (padrão 30000 — a janela em que o Whisper foi treinado) */
  maxJanelaMs?: number;
  /** pausa a partir da qual a janela é fechada, em ms (padrão 2000) */
  maxGapMs?: number;
}

/** Uma janela pronta para ir ao transcritor, com as falas que a compõem. */
export interface Janela {
  chunk: AudioChunk;
  fonte: FonteAudio;
  t0: number;
  t1: number;
}

const MAX_JANELA_MS = 30_000;
const MAX_GAP_MS = 2_000;

/**
 * Junta falas curtas em janelas de até ~30 s para mandar ao Whisper.
 *
 * **Por que isso existe:** o Whisper foi treinado em janelas de 30 s e erra
 * muito — ou inventa texto — quando recebe fragmentos soltos de 1 ou 2
 * segundos. Mandar uma fala por vez, como fazíamos, era a maior causa de
 * transcrição ruim.
 *
 * **O silêncio entre as falas é preservado** (preenchido com zeros). Se as
 * falas fossem simplesmente coladas, os timestamps devolvidos pelo Whisper não
 * corresponderiam mais ao tempo real da gravação e o `.srt` sairia
 * dessincronizado. `maxGapMs` garante que esse preenchimento nunca cresça: uma
 * pausa longa fecha a janela em vez de virar minutos de silêncio.
 *
 * Falas de fontes diferentes (microfone x aba, numa reunião) nunca entram na
 * mesma janela — senão a atribuição de quem falou se perderia.
 */
export function agruparEmJanelas(
  falas: FalaGravada[],
  opts: OpcoesJanela = {},
): Janela[] {
  const maxJanelaMs = opts.maxJanelaMs ?? MAX_JANELA_MS;
  const maxGapMs = opts.maxGapMs ?? MAX_GAP_MS;

  const ordenadas = [...falas].sort((a, b) => a.t0 - b.t0);
  const janelas: Janela[] = [];
  let grupo: FalaGravada[] = [];

  const fechar = () => {
    if (grupo.length) janelas.push(montar(grupo));
    grupo = [];
  };

  for (const fala of ordenadas) {
    const anterior = grupo[grupo.length - 1];
    if (anterior) {
      const gap = fala.t0 - anterior.t1;
      const duracaoComEsta = fala.t1 - grupo[0]!.t0;
      const trocouFonte = fala.fonte !== anterior.fonte;
      if (gap > maxGapMs || duracaoComEsta > maxJanelaMs || trocouFonte) {
        fechar();
      }
    }
    grupo.push(fala);
  }
  fechar();

  return janelas;
}

/** Concatena as falas de um grupo reconstruindo o silêncio entre elas. */
function montar(grupo: FalaGravada[]): Janela {
  const primeira = grupo[0]!;
  const ultima = grupo[grupo.length - 1]!;
  const sampleRate = primeira.sampleRate;
  const t0 = primeira.t0;
  const t1 = ultima.t1;

  const total = Math.max(
    1,
    Math.round(((t1 - t0) / 1000) * sampleRate),
  );
  const pcm = new Float32Array(total);

  for (const fala of grupo) {
    // posiciona cada fala no seu lugar real dentro da janela; o que sobra entre
    // elas fica zerado, que é exatamente o silêncio original
    const offset = Math.round(((fala.t0 - t0) / 1000) * sampleRate);
    const amostras = paraFloat32(fala.pcm);
    const cabe = Math.min(amostras.length, total - offset);
    if (cabe > 0) pcm.set(amostras.subarray(0, cabe), offset);
  }

  return {
    chunk: { pcm, sampleRate, t0 },
    fonte: primeira.fonte,
    t0,
    t1,
  };
}

import {
  novoId,
  type AudioChunk,
  type Idioma,
  type Segment,
  type Transcriber,
} from "@rt/core";

// Whisper espera o nome do idioma por extenso.
const NOME_WHISPER: Record<string, string> = {
  pt: "portuguese",
  en: "english",
  es: "spanish",
  fr: "french",
  de: "german",
  it: "italian",
  ja: "japanese",
  zh: "chinese",
};

/** Trecho com tempo devolvido pelo worker (timestamps em segundos). */
interface TrechoAsr {
  timestamp: [number, number | null];
  text: string;
}
interface RespostaAsr {
  text: string;
  chunks: TrechoAsr[] | null;
}
type Pendente = {
  resolve: (r: RespostaAsr) => void;
  reject: (e: Error) => void;
};

export interface WhisperOpts {
  modelId?: string;
  /** URL da pasta com o runtime onnxruntime (`ort/`), servida pelo próprio app */
  ortBase: string;
  /**
   * Worker já instanciado. Vem de fora porque cada bundler resolve o caminho do
   * worker à sua maneira (`new Worker(new URL(...), { type: "module" })`).
   */
  worker: Worker;
}

/**
 * Transcriber offline com Whisper (transformers.js) rodando num Web Worker,
 * para não travar a UI. Compartilhado entre a extensão e o PWA.
 */
export class WhisperTranscriber implements Transcriber {
  private worker: Worker;
  private seq = 0;
  private pendentes = new Map<number, Pendente>();
  private pronto: Promise<void>;
  /** "webgpu" ou "wasm" — só se sabe depois do init */
  private deviceUsado: string | null = null;

  constructor(opts: WhisperOpts) {
    this.worker = opts.worker;
    this.worker.onmessage = (e: MessageEvent) => {
      const { id, ok, text, chunks, device, error } = e.data;
      const p = this.pendentes.get(id);
      if (!p) return;
      this.pendentes.delete(id);
      if (!ok) {
        p.reject(new Error(error));
        return;
      }
      if (device) this.deviceUsado = device;
      p.resolve({ text: text ?? "", chunks: chunks ?? null });
    };
    this.pronto = this.chamar("init", {
      modelId: opts.modelId ?? "Xenova/whisper-base",
      ortBase: opts.ortBase,
    }).then(() => undefined);
  }

  /** Resolve quando o modelo terminou de carregar (útil para status na UI). */
  whenReady(): Promise<void> {
    return this.pronto;
  }

  /** "webgpu" (rápido) ou "wasm" (lento). Só disponível após `whenReady()`. */
  device(): string | null {
    return this.deviceUsado;
  }

  async transcribe(chunk: AudioChunk, idioma?: Idioma): Promise<Segment[]> {
    await this.pronto;
    const durMs = (chunk.pcm.length / chunk.sampleRate) * 1000;
    const language =
      idioma && idioma !== "auto" ? NOME_WHISPER[idioma] : undefined;
    const r = await this.chamar("transcribe", { pcm: chunk.pcm, language });

    // Com timestamps, uma janela longa volta quebrada em vários trechos — é o
    // que mantém o texto em linhas curtas mesmo mandando 30s de cada vez.
    if (r.chunks?.length) {
      const segs: Segment[] = [];
      for (const t of r.chunks) {
        const texto = t.text?.trim();
        if (!texto) continue;
        const [ini, fim] = t.timestamp;
        segs.push({
          id: novoId(),
          // timestamps vêm em SEGUNDOS e relativos ao áudio enviado
          t0: chunk.t0 + ini * 1000,
          // fim nulo acontece no último trecho de uma janela cortada
          t1: chunk.t0 + (fim ?? ini + 1) * 1000,
          textoOrig: texto,
          idiomaOrig: idioma ?? "auto",
        });
      }
      if (segs.length) return segs;
    }

    // sem timestamps (áudio curto): um segmento cobrindo o bloco inteiro
    if (!r.text.trim()) return [];
    return [
      {
        id: novoId(),
        t0: chunk.t0,
        t1: chunk.t0 + durMs,
        textoOrig: r.text.trim(),
        idiomaOrig: idioma ?? "auto",
      },
    ];
  }

  async dispose(): Promise<void> {
    this.worker.terminate();
  }

  private chamar(
    type: "init" | "transcribe",
    payload: Record<string, unknown>,
  ): Promise<RespostaAsr> {
    const id = ++this.seq;
    return new Promise<RespostaAsr>((resolve, reject) => {
      this.pendentes.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, payload });
    });
  }
}

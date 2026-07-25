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

type Pendente = { resolve: (t: string) => void; reject: (e: Error) => void };

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

  constructor(opts: WhisperOpts) {
    this.worker = opts.worker;
    this.worker.onmessage = (e: MessageEvent) => {
      const { id, ok, text, error } = e.data;
      const p = this.pendentes.get(id);
      if (!p) return;
      this.pendentes.delete(id);
      ok ? p.resolve(text ?? "") : p.reject(new Error(error));
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

  async transcribe(chunk: AudioChunk, idioma?: Idioma): Promise<Segment[]> {
    await this.pronto;
    const durMs = (chunk.pcm.length / chunk.sampleRate) * 1000;
    const language =
      idioma && idioma !== "auto" ? NOME_WHISPER[idioma] : undefined;
    const text = await this.chamar("transcribe", { pcm: chunk.pcm, language });
    if (!text.trim()) return [];
    return [
      {
        id: novoId(),
        t0: chunk.t0,
        t1: chunk.t0 + durMs,
        textoOrig: text.trim(),
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
  ): Promise<string> {
    const id = ++this.seq;
    return new Promise<string>((resolve, reject) => {
      this.pendentes.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, payload });
    });
  }
}

import type { Idioma } from "../idiomas.js";
import type {
  AudioCapture,
  AudioChunk,
  DepositoFalas,
  FalaGravada,
  Storage,
  Transcriber,
  Translator,
} from "../ports.js";
import type { FonteAudio, Segment } from "../segments.js";
import type { Session, SessionMeta } from "../session/estado.js";
import { resumo } from "../session/estado.js";
import { novoId } from "../util.js";

/** Captura de mentira: emite blocos pré-roteirizados quando `start()` é chamado. */
export class FakeCapture implements AudioCapture {
  private cb: (c: AudioChunk) => void = () => {};
  constructor(
    private readonly chunks: AudioChunk[],
    readonly fonte: FonteAudio = "mic",
  ) {}
  onChunk(cb: (c: AudioChunk) => void): void {
    this.cb = cb;
  }
  async start(): Promise<void> {
    for (const c of this.chunks) this.cb(c);
  }
  async stop(): Promise<void> {}
}

/** Transcritor de mentira: transforma cada bloco em texto via função injetada. */
export class FakeTranscriber implements Transcriber {
  constructor(private readonly fn: (c: AudioChunk) => string) {}
  async transcribe(c: AudioChunk, idioma?: Idioma): Promise<Segment[]> {
    const durMs = (c.pcm.length / c.sampleRate) * 1000;
    return [
      {
        id: novoId(),
        t0: c.t0,
        t1: c.t0 + durMs,
        textoOrig: this.fn(c),
        idiomaOrig: idioma ?? "auto",
      },
    ];
  }
}

/** Tradutor de mentira: aplica uma transformação de string (padrão: colchetes). */
export class FakeTranslator implements Translator {
  constructor(private readonly fn: (t: string) => string = (t) => `[${t}]`) {}
  async ready(): Promise<void> {}
  async translate(texto: string): Promise<string> {
    return this.fn(texto);
  }
}

/** Armazenamento em memória, para testes. */
export class MemoryStorage implements Storage {
  private mapa = new Map<string, Session>();
  async saveSession(s: Session): Promise<void> {
    this.mapa.set(s.id, structuredClone(s));
  }
  async getSession(id: string): Promise<Session | undefined> {
    const s = this.mapa.get(id);
    return s ? structuredClone(s) : undefined;
  }
  async list(): Promise<SessionMeta[]> {
    return [...this.mapa.values()].map(resumo);
  }
  async deleteSession(id: string): Promise<void> {
    this.mapa.delete(id);
  }
}

/** Depósito de falas em memória, para testar o modo "transcrever depois". */
export class MemoryDeposito implements DepositoFalas {
  private mapa = new Map<string, FalaGravada[]>();
  async guardar(sessionId: string, fala: FalaGravada): Promise<void> {
    const atual = this.mapa.get(sessionId) ?? [];
    atual.push(fala);
    this.mapa.set(sessionId, atual);
  }
  async listar(sessionId: string): Promise<FalaGravada[]> {
    return [...(this.mapa.get(sessionId) ?? [])];
  }
  async limpar(sessionId: string): Promise<void> {
    this.mapa.delete(sessionId);
  }
}

/** Cria um AudioChunk sintético com PCM de energia controlada. */
export function chunkSintetico(
  t0: number,
  amplitude: number,
  amostras = 16000,
  sampleRate = 16000,
): AudioChunk {
  const pcm = new Float32Array(amostras);
  for (let i = 0; i < amostras; i++) {
    pcm[i] = Math.sin(i * 0.1) * amplitude;
  }
  return { pcm, sampleRate, t0 };
}

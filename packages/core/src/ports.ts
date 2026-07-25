import type { Idioma } from "./idiomas.js";
import type { FonteAudio, Segment } from "./segments.js";
import type { Session, SessionMeta } from "./session/estado.js";

/**
 * As quatro "portas" que cada plataforma implementa com sua própria tecnologia.
 * O núcleo depende apenas destas interfaces — nunca de uma API concreta.
 *
 *  - Extensão (desktop): getUserMedia · Whisper WASM · Chrome Translator API · IndexedDB
 *  - Celular:            mic nativo   · whisper.rn   · Google ML Kit          · SQLite
 */

/** Um bloco de áudio PCM mono, normalizado em -1..1. */
export interface AudioChunk {
  pcm: Float32Array;
  sampleRate: number;
  /** início do bloco, em ms desde o começo da gravação */
  t0: number;
}

/** Captura de áudio. O adapter é responsável por janelar/VAD se quiser. */
export interface AudioCapture {
  /**
   * Origem deste adapter. O pipeline usa isto para atribuir o falante — numa
   * reunião rodam dois adapters ao mesmo tempo (microfone + áudio da aba).
   * Ausente = "mic" (mantém os adapters e testes antigos funcionando).
   */
  readonly fonte?: FonteAudio;
  start(): Promise<void>;
  stop(): Promise<void>;
  onChunk(cb: (chunk: AudioChunk) => void): void;
  /** opcional: nível (RMS 0..1) para indicador visual */
  onLevel?(cb: (rms: number) => void): void;
}

/** Um participante identificado pela plataforma, antes de virar nome de exibição. */
export interface FalanteRef {
  /** estável enquanto durar a chamada (ex.: id do tile do participante) */
  id: string;
  /** nome real, quando a plataforma deixa ler; ausente vira "Participante N" */
  nome?: string;
}

/**
 * Diz quem estava falando num intervalo de tempo. Na extensão isto é lido do
 * DOM do Meet; o núcleo nunca sabe disso. Se o seletor do Meet mudar, o
 * rotulador simplesmente devolve `undefined` e a transcrição segue sem nomes.
 */
export interface RotuladorFalante {
  falanteEm(t0: number, t1: number): FalanteRef | undefined;
}

/** Transcrição offline de um bloco de áudio em um ou mais segmentos (sem tradução). */
export interface Transcriber {
  transcribe(chunk: AudioChunk, idioma?: Idioma): Promise<Segment[]>;
  dispose?(): Promise<void>;
}

/** Tradução offline de texto entre dois idiomas. */
export interface Translator {
  /** prepara o par de idiomas (baixa pacote se necessário) */
  ready(src: Idioma, dst: Idioma): Promise<void>;
  translate(texto: string, src: Idioma, dst: Idioma): Promise<string>;
}

/**
 * Uma fala capturada mas ainda não transcrita, guardada como int16 para ocupar
 * metade do espaço (ver `paraInt16`).
 */
export interface FalaGravada {
  id: string;
  t0: number;
  t1: number;
  pcm: Int16Array;
  sampleRate: number;
  fonte: FonteAudio;
}

/**
 * Depósito das falas cruas no modo "transcrever depois". Fica fora da memória
 * (IndexedDB no navegador) porque no celular a transcrição é mais lenta que a
 * fala: guardar tudo em RAM estouraria numa gravação longa.
 */
export interface DepositoFalas {
  guardar(sessionId: string, fala: FalaGravada): Promise<void>;
  listar(sessionId: string): Promise<FalaGravada[]>;
  limpar(sessionId: string): Promise<void>;
}

/** Persistência local das sessões gravadas. */
export interface Storage {
  saveSession(s: Session): Promise<void>;
  getSession(id: string): Promise<Session | undefined>;
  list(): Promise<SessionMeta[]>;
  deleteSession(id: string): Promise<void>;
}

// Reexport para conveniência de quem importa só de ports.
export type { Session, SessionMeta };

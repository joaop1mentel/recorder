import type { Idioma } from "../idiomas.js";
import type { Segment } from "../segments.js";
import { novoId } from "../util.js";

/** Estados possíveis de uma sessão de gravação. */
export type EstadoSessao =
  | "idle"
  | "recording"
  | "paused"
  | "finalizing"
  | "done"
  | "error";

/** Eventos que disparam transições. */
export type EventoSessao =
  | "START"
  | "PAUSE"
  | "RESUME"
  | "STOP"
  | "FINALIZED"
  | "ERROR";

const TRANSICOES: Record<
  EstadoSessao,
  Partial<Record<EventoSessao, EstadoSessao>>
> = {
  idle: { START: "recording", ERROR: "error" },
  recording: { PAUSE: "paused", STOP: "finalizing", ERROR: "error" },
  paused: { RESUME: "recording", STOP: "finalizing", ERROR: "error" },
  finalizing: { FINALIZED: "done", ERROR: "error" },
  done: {},
  error: {},
};

/** Retorna true se o evento é válido a partir do estado atual. */
export function podeTransicionar(
  estado: EstadoSessao,
  evento: EventoSessao,
): boolean {
  return TRANSICOES[estado][evento] !== undefined;
}

/**
 * Aplica uma transição pura. Lança se o evento for inválido no estado atual —
 * isso protege o pipeline de chamadas fora de ordem (ex.: PAUSE antes de START).
 */
export function transicao(
  estado: EstadoSessao,
  evento: EventoSessao,
): EstadoSessao {
  const proximo = TRANSICOES[estado][evento];
  if (proximo === undefined) {
    throw new Error(`Transição inválida: ${estado} --${evento}-->`);
  }
  return proximo;
}

/** Uma gravação completa: metadados + transcrito. */
export interface Session {
  id: string;
  titulo?: string;
  criadoEm: number;
  atualizadoEm: number;
  estado: EstadoSessao;
  idiomaOrig: Idioma;
  idiomaAlvo: Idioma;
  segments: Segment[];
  /** duração conhecida, em ms */
  duracaoMs: number;
}

/** Resumo leve para listagens (histórico), sem carregar todos os segmentos. */
export interface SessionMeta {
  id: string;
  titulo?: string;
  criadoEm: number;
  atualizadoEm: number;
  idiomaOrig: Idioma;
  idiomaAlvo: Idioma;
  duracaoMs: number;
  totalSegmentos: number;
}

export function criarSessao(
  idiomaOrig: Idioma,
  idiomaAlvo: Idioma,
): Session {
  const agora = Date.now();
  return {
    id: novoId(),
    criadoEm: agora,
    atualizadoEm: agora,
    estado: "idle",
    idiomaOrig,
    idiomaAlvo,
    segments: [],
    duracaoMs: 0,
  };
}

export function resumo(s: Session): SessionMeta {
  return {
    id: s.id,
    titulo: s.titulo,
    criadoEm: s.criadoEm,
    atualizadoEm: s.atualizadoEm,
    idiomaOrig: s.idiomaOrig,
    idiomaAlvo: s.idiomaAlvo,
    duracaoMs: s.duracaoMs,
    totalSegmentos: s.segments.length,
  };
}

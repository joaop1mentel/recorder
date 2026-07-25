import type { Idioma, Segment, Session } from "@rt/core";

/**
 * Contrato de mensagens entre os três contextos da extensão.
 *
 *   painel (UI)  ⇄  offscreen (áudio + IA)      — controle e resultados
 *   content(Meet) →  background → offscreen     — reunião detectada, quem fala
 *
 * O áudio vive no offscreen (e não no painel) porque o painel lateral morre se
 * o usuário o fechar — inaceitável no meio de uma reunião de uma hora.
 */

export interface OpcoesGravacao {
  origem: Idioma;
  alvo: Idioma;
  modelo: string;
  traduzirAoVivo: boolean;
  /** presente = grava também o áudio da aba (reunião) */
  streamId?: string;
}

/** painel → offscreen */
export type ComandoOffscreen =
  | { tipo: "iniciar"; opts: OpcoesGravacao }
  | { tipo: "pausar" }
  | { tipo: "retomar" }
  | { tipo: "parar" };

/** offscreen → painel */
export type EventoOffscreen =
  | { tipo: "segmento"; seg: Segment }
  | { tipo: "estado"; estado: string }
  | { tipo: "status"; campo: "modelo" | "traducao"; msg: string }
  | { tipo: "nivel"; valor: number }
  | { tipo: "erro"; msg: string; permissaoMic?: boolean }
  | { tipo: "finalizado"; session: Session };

/** content script do Meet → background/offscreen */
export type EventoMeet =
  | { tipo: "meet:entrou"; titulo?: string }
  | { tipo: "meet:saiu" }
  | { tipo: "meet:falaInicio"; id: string; nome?: string; wall: number }
  | { tipo: "meet:falaFim"; id: string; wall: number }
  /** o content script não conseguiu ler o layout do Meet (seletores mudaram) */
  | { tipo: "meet:semLeitura" };

export type Mensagem = ComandoOffscreen | EventoOffscreen | EventoMeet;

/** Canal do painel: pergunta ao background se há uma reunião aberta agora. */
export interface EstadoReuniao {
  emReuniao: boolean;
  tabId?: number;
  titulo?: string;
  /** true = detectamos a reunião mas não conseguimos ler os nomes dos participantes */
  semLeitura?: boolean;
}

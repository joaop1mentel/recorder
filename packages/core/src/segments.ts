import type { Idioma } from "./idiomas.js";

/**
 * De onde veio o áudio. Numa reunião isto já separa os falantes sem depender de
 * nada frágil: o microfone é sempre o dono do aparelho, a aba são os outros.
 */
export type FonteAudio = "mic" | "aba";

/** Quem falou um trecho, já pronto para exibir. */
export interface Falante {
  /** estável dentro da sessão (o mesmo participante mantém o mesmo id) */
  id: string;
  /** nome de exibição: "Você", o nome real da chamada ou "Participante 2" */
  nome: string;
  fonte: FonteAudio;
}

/**
 * Um trecho falado já transcrito. É a unidade básica do transcrito.
 * Os tempos são em milissegundos desde o início da gravação.
 */
export interface Segment {
  id: string;
  /** início, em ms desde o começo da gravação */
  t0: number;
  /** fim, em ms desde o começo da gravação */
  t1: number;
  textoOrig: string;
  idiomaOrig: Idioma;
  /** tradução para o idioma-alvo; ausente enquanto não traduzido */
  textoTrad?: string;
  idiomaTrad?: Idioma;
  /** true = hipótese ao vivo, ainda não confirmada */
  parcial?: boolean;
  /** quem falou; ausente na gravação presencial de fonte única */
  falante?: Falante;
}

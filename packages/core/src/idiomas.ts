/**
 * Idioma em código curto (ex.: "pt", "en", "es") ou "auto" para detecção
 * automática na transcrição. Mantido como string para não acoplar o núcleo
 * à lista de idiomas suportada por cada motor (Whisper / ML Kit / Translator API).
 */
export type Idioma = string;

export const AUTO: Idioma = "auto";

/** Idiomas com bom suporte offline nos três motores do projeto. */
export const IDIOMAS_COMUNS: ReadonlyArray<{ codigo: Idioma; nome: string }> = [
  { codigo: "pt", nome: "Português" },
  { codigo: "en", nome: "Inglês" },
  { codigo: "es", nome: "Espanhol" },
  { codigo: "fr", nome: "Francês" },
  { codigo: "de", nome: "Alemão" },
  { codigo: "it", nome: "Italiano" },
  { codigo: "ja", nome: "Japonês" },
  { codigo: "zh", nome: "Chinês" },
];

export function nomeIdioma(codigo: Idioma): string {
  if (codigo === AUTO) return "Detecção automática";
  return IDIOMAS_COMUNS.find((i) => i.codigo === codigo)?.nome ?? codigo;
}

import type { Session } from "./session/estado.js";

/** Formata ms como timestamp de SRT: HH:MM:SS,mmm */
function tempoSrt(ms: number): string {
  const clamp = Math.max(0, Math.floor(ms));
  const h = Math.floor(clamp / 3_600_000);
  const m = Math.floor((clamp % 3_600_000) / 60_000);
  const s = Math.floor((clamp % 60_000) / 1000);
  const mmm = clamp % 1000;
  const p = (n: number, largura = 2) => String(n).padStart(largura, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(mmm, 3)}`;
}

export interface ExportOpts {
  /** usar o texto traduzido (padrão: original) */
  traduzido?: boolean;
}

/** Legendas .srt (original ou tradução), com o nome de quem falou quando houver. */
export function paraSrt(session: Session, opts: ExportOpts = {}): string {
  return session.segments
    .map((seg, i) => {
      const texto = opts.traduzido
        ? (seg.textoTrad ?? seg.textoOrig)
        : seg.textoOrig;
      const quem = seg.falante ? `${seg.falante.nome}: ` : "";
      return `${i + 1}\n${tempoSrt(seg.t0)} --> ${tempoSrt(seg.t1)}\n${quem}${texto}\n`;
    })
    .join("\n");
}

export interface TxtOpts {
  /** incluir original e tradução (padrão true) */
  bilingue?: boolean;
}

/** Transcrito em texto simples, com marca de tempo e falante por linha. */
export function paraTxt(session: Session, opts: TxtOpts = {}): string {
  const bilingue = opts.bilingue ?? true;
  return session.segments
    .map((seg) => {
      const carimbo = tempoSrt(seg.t0).slice(0, 8); // HH:MM:SS
      const quem = seg.falante ? `${seg.falante.nome}: ` : "";
      let linha = `[${carimbo}] ${quem}${seg.textoOrig}`;
      if (bilingue && seg.textoTrad) linha += `\n           ↳ ${seg.textoTrad}`;
      return linha;
    })
    .join("\n");
}

/** Sessão completa como JSON (para reimportar / backup). */
export function paraJson(session: Session): string {
  return JSON.stringify(session, null, 2);
}

/**
 * Texto da conversa (só o original) para alimentar a IA.
 *
 * Quando há falantes, sai como diálogo (`Nome: fala`, uma linha por turno) — é
 * isso que permite o resumo dizer *quem* combinou o quê, em vez de devolver um
 * bloco anônimo. Sem falantes, continua sendo texto corrido como antes.
 */
export function textoConversa(session: Pick<Session, "segments">): string {
  const temFalante = session.segments.some((s) => s.falante);
  if (!temFalante) {
    return session.segments
      .map((s) => s.textoOrig.trim())
      .filter(Boolean)
      .join(" ");
  }
  const linhas: string[] = [];
  for (const seg of session.segments) {
    const texto = seg.textoOrig.trim();
    if (!texto) continue;
    const nome = seg.falante?.nome ?? "Participante";
    const anterior = linhas[linhas.length - 1];
    // junta falas seguidas da mesma pessoa num turno só, para não picotar o diálogo
    if (anterior?.startsWith(`${nome}: `)) {
      linhas[linhas.length - 1] = `${anterior} ${texto}`;
    } else {
      linhas.push(`${nome}: ${texto}`);
    }
  }
  return linhas.join("\n");
}

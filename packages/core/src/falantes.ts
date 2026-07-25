import type { FalanteRef, RotuladorFalante } from "./ports.js";
import type { Falante, FonteAudio } from "./segments.js";

/** Como o dono do aparelho aparece no transcrito (áudio do próprio microfone). */
export const VOCE: Falante = { id: "voce", nome: "Você", fonte: "mic" };

/**
 * Transforma "de onde veio o áudio" em "quem falou", com degradação suave:
 *
 *  1. microfone            → sempre "Você" (não depende de DOM, nunca quebra)
 *  2. aba + nome conhecido → o nome real da chamada
 *  3. aba + só id          → "Participante N", numerado por ordem de entrada na conversa
 *  4. aba sem nada         → "Participante" genérico (o rotulador falhou por completo,
 *                            mas a transcrição continua inteira)
 *
 * O passo 3 é o que segura a experiência quando o Google mexe no layout do Meet:
 * perde-se o nome, não a separação.
 */
export class AtribuidorFalantes {
  private readonly numeroPorId = new Map<string, number>();
  private readonly rotulador?: RotuladorFalante;

  constructor(rotulador?: RotuladorFalante) {
    this.rotulador = rotulador;
  }

  atribuir(fonte: FonteAudio, t0: number, t1: number): Falante {
    if (fonte === "mic") return VOCE;

    let ref: FalanteRef | undefined;
    try {
      ref = this.rotulador?.falanteEm(t0, t1);
    } catch {
      // rotulador quebrado (seletor do Meet mudou) não pode derrubar a gravação
      ref = undefined;
    }

    if (!ref) return { id: "participante", nome: "Participante", fonte: "aba" };
    if (ref.nome?.trim()) {
      return { id: ref.id, nome: ref.nome.trim(), fonte: "aba" };
    }
    return { id: ref.id, nome: `Participante ${this.numeroDe(ref.id)}`, fonte: "aba" };
  }

  /** Numeração estável: o mesmo id recebe sempre o mesmo número na sessão. */
  private numeroDe(id: string): number {
    const existente = this.numeroPorId.get(id);
    if (existente !== undefined) return existente;
    const proximo = this.numeroPorId.size + 1;
    this.numeroPorId.set(id, proximo);
    return proximo;
  }
}

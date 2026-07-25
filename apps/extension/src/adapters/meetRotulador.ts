import type { FalanteRef, RotuladorFalante } from "@rt/core";

/** Um intervalo em que um participante esteve com o microfone ativo, em tempo de relógio. */
export interface JanelaFala {
  id: string;
  nome?: string;
  /** Date.now() de quando começou a falar */
  inicio: number;
  /** Date.now() de quando parou; ausente = ainda falando */
  fim?: number;
}

/**
 * Responde "quem falou neste trecho?" cruzando o tempo do áudio com as janelas
 * de fala observadas no DOM do Meet (enviadas pelo content script).
 *
 * O áudio usa tempo relativo ao início da gravação; o content script usa
 * `Date.now()`. A conversão passa por `inicioWall`, o relógio no momento em que
 * a captura começou — é o único ponto onde os dois mundos se encontram.
 */
export class MeetRotulador implements RotuladorFalante {
  private janelas: JanelaFala[] = [];

  constructor(private inicioWall: number) {}

  /** Redefine o marco zero (chamar quando a captura de fato começar). */
  marcarInicio(wall: number): void {
    this.inicioWall = wall;
  }

  registrar(j: JanelaFala): void {
    this.janelas.push(j);
    // a lista é varrida a cada segmento; sem poda, uma reunião longa degrada
    if (this.janelas.length > 500) this.janelas = this.janelas.slice(-300);
  }

  /** Fecha a janela aberta de um participante (parou de falar). */
  fechar(id: string, fim: number): void {
    for (let i = this.janelas.length - 1; i >= 0; i--) {
      const j = this.janelas[i]!;
      if (j.id === id && j.fim === undefined) {
        j.fim = fim;
        return;
      }
    }
  }

  falanteEm(t0: number, t1: number): FalanteRef | undefined {
    const inicio = this.inicioWall + t0;
    const fim = this.inicioWall + t1;

    // Escolhe quem mais se sobrepõe ao trecho: numa conversa real as falas
    // se atropelam, e pegar o "primeiro que bate" daria o falante errado.
    let melhor: JanelaFala | undefined;
    let maiorSobreposicao = 0;
    for (const j of this.janelas) {
      const jFim = j.fim ?? Number.MAX_SAFE_INTEGER;
      const sobreposicao = Math.min(fim, jFim) - Math.max(inicio, j.inicio);
      if (sobreposicao > maiorSobreposicao) {
        maiorSobreposicao = sobreposicao;
        melhor = j;
      }
    }
    if (!melhor) return undefined;
    return { id: melhor.id, nome: melhor.nome };
  }
}

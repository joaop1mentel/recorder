import { concatPcm } from "./util.js";

/** Energia RMS (0..1) de um bloco PCM mono. Silêncio ≈ 0. */
export function rms(pcm: Float32Array): number {
  if (pcm.length === 0) return 0;
  let soma = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i]!;
    soma += v * v;
  }
  return Math.sqrt(soma / pcm.length);
}

/** Uma fala isolada (entre silêncios), pronta para ir ao transcritor. */
export interface UtterancePCM {
  pcm: Float32Array;
  sampleRate: number;
  t0: number;
  t1: number;
}

export interface VadOpts {
  sampleRate: number;
  /** limiar de energia para considerar "fala" (padrão 0.01) */
  limiar?: number;
  /** silêncio contínuo que fecha uma fala, em ms (padrão 700) */
  silencioMs?: number;
  /** duração mínima para emitir uma fala, em ms (padrão 700) */
  minFalaMs?: number;
  /** duração máxima antes de forçar corte, em ms (padrão 25000) */
  maxFalaMs?: number;
}

/**
 * Segmentador por atividade de voz (VAD) simples, baseado em energia.
 * Acumula frames enquanto há fala e emite uma UtterancePCM quando detecta
 * silêncio suficiente ou atinge a duração máxima. Usado pelos adapters de
 * captura para transformar o fluxo contínuo do microfone em falas discretas.
 */
export class SegmentadorVAD {
  private readonly opts: Required<VadOpts>;
  private buf: Float32Array[] = [];
  private falando = false;
  private inicioMs = 0;
  private fimMs = 0;
  private silencioAcum = 0;
  private duracaoBufMs = 0;

  constructor(opts: VadOpts) {
    // Os padrões são calibrados para o que o Whisper aceita bem, não para
    // "detectar som": trechos de 0,25 s costumam ser ruído e, isolados, o
    // modelo inventa texto. Fechar tarde é melhor que picotar uma frase.
    this.opts = {
      limiar: 0.01,
      silencioMs: 700,
      minFalaMs: 700,
      maxFalaMs: 25000,
      ...opts,
    };
  }

  /** Alimenta um frame de áudio. Retorna as falas fechadas por este frame (0 ou 1). */
  push(frame: Float32Array, tMs: number): UtterancePCM[] {
    const dur = (frame.length / this.opts.sampleRate) * 1000;
    const energia = rms(frame);
    const saida: UtterancePCM[] = [];

    if (energia >= this.opts.limiar) {
      if (!this.falando) {
        this.falando = true;
        this.inicioMs = tMs;
        this.buf = [];
        this.duracaoBufMs = 0;
      }
      this.silencioAcum = 0;
      this.acumular(frame, tMs, dur);
      if (this.duracaoBufMs >= this.opts.maxFalaMs) {
        const u = this.emitir();
        if (u) saida.push(u);
      }
    } else if (this.falando) {
      // silêncio dentro de uma fala: mantém no buffer até estourar o hangover
      this.acumular(frame, tMs, dur);
      this.silencioAcum += dur;
      if (this.silencioAcum >= this.opts.silencioMs) {
        const u = this.emitir();
        if (u) saida.push(u);
      }
    }
    return saida;
  }

  /** Fecha qualquer fala em andamento (chamar no stop da gravação). */
  flush(): UtterancePCM | null {
    return this.falando ? this.emitir() : null;
  }

  private acumular(frame: Float32Array, tMs: number, dur: number): void {
    this.buf.push(frame);
    this.duracaoBufMs += dur;
    this.fimMs = tMs + dur;
  }

  private emitir(): UtterancePCM | null {
    const falaMs = this.duracaoBufMs;
    const buf = this.buf;
    const inicio = this.inicioMs;
    const fim = this.fimMs;
    this.falando = false;
    this.buf = [];
    this.duracaoBufMs = 0;
    this.silencioAcum = 0;
    if (falaMs < this.opts.minFalaMs) return null;
    return {
      pcm: concatPcm(buf),
      sampleRate: this.opts.sampleRate,
      t0: inicio,
      t1: fim,
    };
  }
}

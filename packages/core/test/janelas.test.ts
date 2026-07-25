import { describe, expect, it } from "vitest";
import { agruparEmJanelas } from "../src/janelas.js";
import type { FalaGravada } from "../src/ports.js";
import { paraInt16 } from "../src/util.js";
import type { FonteAudio } from "../src/segments.js";

const SR = 16000;

/** Fala sintética com amplitude constante, para dar para conferir onde ela caiu. */
function fala(
  t0: number,
  duracaoMs: number,
  amplitude = 0.5,
  fonte: FonteAudio = "mic",
): FalaGravada {
  const n = Math.round((duracaoMs / 1000) * SR);
  const pcm = new Float32Array(n).fill(amplitude);
  return {
    id: `${t0}`,
    t0,
    t1: t0 + duracaoMs,
    pcm: paraInt16(pcm),
    sampleRate: SR,
    fonte,
  };
}

describe("agruparEmJanelas", () => {
  it("junta falas próximas numa janela só", () => {
    const janelas = agruparEmJanelas([
      fala(0, 1000),
      fala(1500, 1000), // 500 ms de pausa
      fala(3000, 1000), // 500 ms de pausa
    ]);
    expect(janelas).toHaveLength(1);
    expect(janelas[0]!.t0).toBe(0);
    expect(janelas[0]!.t1).toBe(4000);
  });

  it("pausa longa fecha a janela (não vira minutos de silêncio)", () => {
    const janelas = agruparEmJanelas([
      fala(0, 1000),
      fala(60_000, 1000), // 59 s de pausa
    ]);
    expect(janelas).toHaveLength(2);
    expect(janelas[0]!.t1).toBe(1000);
    expect(janelas[1]!.t0).toBe(60_000);
  });

  it("respeita o teto de 30 s por janela", () => {
    // 20 falas de 2 s coladas = 40 s de áudio contínuo
    const falas = Array.from({ length: 20 }, (_, i) => fala(i * 2000, 2000));
    const janelas = agruparEmJanelas(falas);
    expect(janelas.length).toBeGreaterThan(1);
    for (const j of janelas) {
      expect(j.t1 - j.t0).toBeLessThanOrEqual(30_000);
    }
  });

  it("não mistura microfone e aba na mesma janela", () => {
    const janelas = agruparEmJanelas([
      fala(0, 1000, 0.5, "mic"),
      fala(1200, 1000, 0.5, "aba"),
    ]);
    expect(janelas).toHaveLength(2);
    expect(janelas[0]!.fonte).toBe("mic");
    expect(janelas[1]!.fonte).toBe("aba");
  });

  /**
   * O ponto que decide se o .srt sai sincronizado: as falas têm de cair na
   * posição real dentro da janela, com o silêncio original entre elas.
   */
  it("preserva o silêncio, mantendo os tempos alinhados", () => {
    const janelas = agruparEmJanelas([fala(0, 1000), fala(2000, 1000)]);
    expect(janelas).toHaveLength(1);
    const { pcm } = janelas[0]!.chunk;

    // 3 s de janela (0 → 3000 ms)
    expect(pcm.length).toBe(SR * 3);
    // 1º segundo: fala
    expect(Math.abs(pcm[SR / 2]!)).toBeGreaterThan(0.1);
    // 2º segundo: silêncio reconstruído
    expect(Math.abs(pcm[SR + SR / 2]!)).toBeLessThan(0.01);
    // 3º segundo: fala de novo
    expect(Math.abs(pcm[2 * SR + SR / 2]!)).toBeGreaterThan(0.1);
  });

  it("t0 da janela vira o offset do chunk enviado ao Whisper", () => {
    const janelas = agruparEmJanelas([fala(5000, 1000)]);
    expect(janelas[0]!.chunk.t0).toBe(5000);
    expect(janelas[0]!.chunk.sampleRate).toBe(SR);
  });

  it("lista vazia devolve nenhuma janela", () => {
    expect(agruparEmJanelas([])).toEqual([]);
  });

  it("ordena falas fora de ordem antes de agrupar", () => {
    const janelas = agruparEmJanelas([fala(2000, 500), fala(0, 500)]);
    expect(janelas[0]!.t0).toBe(0);
  });
});

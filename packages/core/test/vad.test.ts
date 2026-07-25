import { describe, expect, it } from "vitest";
import { rms, SegmentadorVAD } from "../src/vad.js";

const SR = 16000;
function frame(amplitude: number, ms: number): Float32Array {
  const n = Math.round((ms / 1000) * SR);
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = Math.sin(i * 0.1) * amplitude;
  return f;
}

describe("rms", () => {
  it("é ~0 para silêncio e >0 para sinal", () => {
    expect(rms(new Float32Array(100))).toBe(0);
    expect(rms(frame(0.5, 100))).toBeGreaterThan(0.1);
  });
});

describe("SegmentadorVAD", () => {
  it("emite uma fala após fala seguida de silêncio suficiente", () => {
    const vad = new SegmentadorVAD({ sampleRate: SR, silencioMs: 300 });
    const falas = [];
    let t = 0;
    // 1s de fala
    for (let i = 0; i < 10; i++) {
      falas.push(...vad.push(frame(0.5, 100), t));
      t += 100;
    }
    // 400ms de silêncio (> 300 de hangover) → fecha
    let emitidas = [];
    for (let i = 0; i < 4; i++) {
      emitidas.push(...vad.push(frame(0, 100), t));
      t += 100;
    }
    expect(emitidas.length).toBe(1);
    expect(emitidas[0]!.t0).toBe(0);
    expect(emitidas[0]!.pcm.length).toBeGreaterThan(SR); // ~1.x s acumulado
  });

  it("descarta falas curtas demais", () => {
    const vad = new SegmentadorVAD({ sampleRate: SR, minFalaMs: 500, silencioMs: 200 });
    let emitidas = [];
    emitidas.push(...vad.push(frame(0.5, 100), 0)); // só 100ms de fala
    for (let i = 0; i < 3; i++) {
      emitidas.push(...vad.push(frame(0, 100), 100 + i * 100));
    }
    expect(emitidas.length).toBe(0);
  });

  it("flush fecha a fala em andamento", () => {
    const vad = new SegmentadorVAD({ sampleRate: SR });
    // 1,2 s: acima do minFalaMs padrão (700 ms)
    for (let i = 0; i < 12; i++) vad.push(frame(0.5, 100), i * 100);
    const u = vad.flush();
    expect(u).not.toBeNull();
    expect(u!.pcm.length).toBeGreaterThan(0);
    expect(vad.flush()).toBeNull(); // nada sobrando
  });

  it("padrões descartam fragmentos curtos (o Whisper alucina com eles)", () => {
    const vad = new SegmentadorVAD({ sampleRate: SR });
    // 400 ms de fala: som real, mas curto demais para transcrever com contexto
    for (let i = 0; i < 4; i++) vad.push(frame(0.5, 100), i * 100);
    expect(vad.flush()).toBeNull();
  });
});

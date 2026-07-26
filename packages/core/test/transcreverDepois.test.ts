import { describe, expect, it } from "vitest";
import { Pipeline, transcreverPendentes } from "../src/pipeline.js";
import {
  criarReamostradorDeFluxo,
  paraFloat32,
  paraInt16,
  reamostrar,
} from "../src/util.js";
import {
  FakeCapture,
  FakeTranscriber,
  FakeTranslator,
  MemoryDeposito,
  chunkSintetico,
} from "../src/testing/fakes.js";

function pipelineDepois(deposito: MemoryDeposito, chunks = 2) {
  const lista = Array.from({ length: chunks }, (_, i) =>
    chunkSintetico(i * 1000, 0.5),
  );
  return new Pipeline({
    capture: new FakeCapture(lista),
    transcriber: new FakeTranscriber(() => "nunca chamado durante a captura"),
    translator: new FakeTranslator(),
    idiomaOrig: "pt",
    idiomaAlvo: "en",
    modo: "depois",
    deposito,
  });
}

describe('modo "transcrever depois"', () => {
  it("não transcreve durante a captura, só arquiva o áudio", async () => {
    const deposito = new MemoryDeposito();
    const gravadas: number[] = [];
    const lista = [chunkSintetico(0, 0.5), chunkSintetico(1000, 0.5)];
    const p = new Pipeline(
      {
        capture: new FakeCapture(lista),
        transcriber: new FakeTranscriber(() => {
          throw new Error("não deveria transcrever no modo depois");
        }),
        translator: new FakeTranslator(),
        idiomaOrig: "pt",
        idiomaAlvo: "en",
        modo: "depois",
        deposito,
      },
      { onFalaGravada: (n) => gravadas.push(n) },
    );

    await p.start();
    const s = await p.stop();

    expect(s.segments).toHaveLength(0); // nada transcrito ainda
    expect(gravadas).toEqual([1, 2]); // mas as duas falas foram guardadas
    expect(await deposito.listar(s.id)).toHaveLength(2);
    expect(s.duracaoMs).toBeGreaterThan(0);
  });

  it("transcreverPendentes preenche o transcrito e reporta progresso", async () => {
    const deposito = new MemoryDeposito();
    const p = pipelineDepois(deposito);
    await p.start();
    const s = await p.stop();

    const progresso: string[] = [];
    let i = 0;
    await transcreverPendentes(
      s,
      new FakeTranscriber(() => `janela ${++i}`),
      deposito,
      { onProgresso: (x) => progresso.push(`${x.feitas}/${x.total}`) },
    );

    // As duas falas são vizinhas, então viram UMA janela e uma única chamada ao
    // Whisper — é justamente isso que corrige a precisão.
    expect(s.segments.map((x) => x.textoOrig)).toEqual(["janela 1"]);
    expect(progresso).toEqual(["0/1", "1/1"]);
  });

  it("falas separadas por pausa longa viram janelas distintas", async () => {
    const deposito = new MemoryDeposito();
    const p = new Pipeline({
      capture: new FakeCapture([
        chunkSintetico(0, 0.5),
        chunkSintetico(60_000, 0.5), // 1 min depois
      ]),
      transcriber: new FakeTranscriber(() => ""),
      translator: new FakeTranslator(),
      idiomaOrig: "pt",
      idiomaAlvo: "en",
      modo: "depois",
      deposito,
    });
    await p.start();
    const s = await p.stop();

    let i = 0;
    await transcreverPendentes(
      s,
      new FakeTranscriber(() => `janela ${++i}`),
      deposito,
    );
    expect(s.segments.map((x) => x.textoOrig)).toEqual(["janela 1", "janela 2"]);
  });

  it("limpa o áudio cru após transcrever (não enche o disco do celular)", async () => {
    const deposito = new MemoryDeposito();
    const p = pipelineDepois(deposito);
    await p.start();
    const s = await p.stop();

    await transcreverPendentes(s, new FakeTranscriber(() => "x"), deposito);
    expect(await deposito.listar(s.id)).toHaveLength(0);
  });

  it("modo depois sem depósito falha de forma explícita", async () => {
    const erros: unknown[] = [];
    const p = new Pipeline(
      {
        capture: new FakeCapture([chunkSintetico(0, 0.5)]),
        transcriber: new FakeTranscriber(() => "x"),
        translator: new FakeTranslator(),
        idiomaOrig: "pt",
        idiomaAlvo: "en",
        modo: "depois",
      },
      { onErro: (e) => erros.push(e) },
    );
    await p.start();
    await p.stop();
    expect(String(erros[0])).toContain("deposito");
  });
});

describe("conversões de PCM", () => {
  it("float32 -> int16 -> float32 preserva o sinal dentro da tolerância", () => {
    const original = new Float32Array([0, 0.5, -0.5, 0.999, -0.999]);
    const voltou = paraFloat32(paraInt16(original));
    for (let i = 0; i < original.length; i++) {
      expect(voltou[i]!).toBeCloseTo(original[i]!, 4);
    }
  });

  it("int16 satura em vez de estourar fora de -1..1", () => {
    const i16 = paraInt16(new Float32Array([2, -2]));
    expect(i16[0]).toBe(32767);
    expect(i16[1]).toBe(-32768);
  });

  it("reamostra 48 kHz para 16 kHz reduzindo o tamanho a um terço", () => {
    // o caso do iPhone: hardware em 48 kHz, Whisper esperando 16 kHz
    const em48k = new Float32Array(4800);
    for (let i = 0; i < em48k.length; i++) em48k[i] = Math.sin(i * 0.01);
    const em16k = reamostrar(em48k, 48000, 16000);
    expect(em16k.length).toBe(1600);
    // a onda tem de continuar reconhecível, não virar ruído
    expect(em16k[0]!).toBeCloseTo(em48k[0]!, 3);
    expect(em16k[100]!).toBeCloseTo(em48k[300]!, 2);
  });

  it("mesma taxa devolve o mesmo buffer, sem trabalho à toa", () => {
    const pcm = new Float32Array([1, 2, 3]);
    expect(reamostrar(pcm, 16000, 16000)).toBe(pcm);
  });

  it("reamostrador de fluxo não perde amostras entre quanta pequenos", () => {
    // simula o AudioWorklet: 128 amostras por vez, 48 kHz -> 16 kHz (razão 3)
    const total = 4800; // 100 ms a 48 kHz
    const em48k = new Float32Array(total);
    for (let i = 0; i < total; i++) em48k[i] = Math.sin(i * 0.01);

    const fluxo = criarReamostradorDeFluxo(48000, 16000);
    const emStream: number[] = [];
    for (let i = 0; i < total; i += 128) {
      const quantum = em48k.slice(i, i + 128);
      for (const v of fluxo(quantum)) emStream.push(v);
    }

    const deUmaVez = reamostrar(em48k, 48000, 16000);
    // processar em quanta pequenos tem de dar (quase) o mesmo resultado que
    // reamostrar o buffer inteiro de uma vez, sem descartar nada nas bordas
    expect(emStream.length).toBeGreaterThanOrEqual(deUmaVez.length - 1);
    for (let i = 0; i < deUmaVez.length - 2; i++) {
      expect(emStream[i]!).toBeCloseTo(deUmaVez[i]!, 3);
    }
  });

  it("reamostrador de fluxo não faz nada quando a taxa já é a mesma", () => {
    const fluxo = criarReamostradorDeFluxo(16000, 16000);
    const pcm = new Float32Array([1, 2, 3]);
    expect(fluxo(pcm)).toBe(pcm);
  });
});

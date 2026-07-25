import { describe, expect, it } from "vitest";
import { Pipeline, traduzirPendentes } from "../src/pipeline.js";
import {
  FakeCapture,
  FakeTranscriber,
  FakeTranslator,
  MemoryStorage,
  chunkSintetico,
} from "../src/testing/fakes.js";

const falas = ["hello", "world"];
function capturaComDuasFalas() {
  return new FakeCapture([chunkSintetico(0, 0.5), chunkSintetico(1000, 0.5)]);
}
function transcritorSequencial() {
  let i = 0;
  return new FakeTranscriber(() => falas[i++ % falas.length]!);
}

describe("Pipeline", () => {
  it("grava, transcreve e traduz ao vivo, terminando em 'done'", async () => {
    const estados: string[] = [];
    const p = new Pipeline(
      {
        capture: capturaComDuasFalas(),
        transcriber: transcritorSequencial(),
        translator: new FakeTranslator((t) => t.toUpperCase()),
        idiomaOrig: "en",
        idiomaAlvo: "pt",
        traduzirAoVivo: true,
      },
      { onEstado: (e) => estados.push(e) },
    );

    await p.start();
    const session = await p.stop();

    expect(session.estado).toBe("done");
    expect(session.segments.map((s) => s.textoOrig)).toEqual(["hello", "world"]);
    expect(session.segments.map((s) => s.textoTrad)).toEqual(["HELLO", "WORLD"]);
    expect(session.duracaoMs).toBeGreaterThan(0);
    expect(estados).toContain("recording");
    expect(estados).toContain("done");
  });

  it("modo 'traduzir depois' deixa segmentos sem tradução até traduzirPendentes", async () => {
    const p = new Pipeline({
      capture: capturaComDuasFalas(),
      transcriber: transcritorSequencial(),
      translator: new FakeTranslator((t) => `<${t}>`),
      idiomaOrig: "en",
      idiomaAlvo: "pt",
      traduzirAoVivo: false,
    });

    await p.start();
    const session = await p.stop();
    expect(session.segments.every((s) => s.textoTrad === undefined)).toBe(true);

    await traduzirPendentes(session, new FakeTranslator((t) => `<${t}>`));
    expect(session.segments.map((s) => s.textoTrad)).toEqual(["<hello>", "<world>"]);
  });

  it("ignora blocos capturados enquanto pausado", async () => {
    // captura que emite 1 bloco, pausamos, emitimos mais — via controle manual
    let cb: ((c: any) => void) | undefined;
    const capture = {
      onChunk: (fn: (c: any) => void) => {
        cb = fn;
      },
      start: async () => {},
      stop: async () => {},
    };
    const p = new Pipeline({
      capture,
      transcriber: new FakeTranscriber(() => "x"),
      translator: new FakeTranslator(),
      idiomaOrig: "en",
      idiomaAlvo: "pt",
    });
    const tick = () => new Promise((r) => setTimeout(r, 0)); // drena a fila
    await p.start();
    cb!(chunkSintetico(0, 0.5));
    await tick(); // processado gravando → 1 segmento
    p.pause();
    cb!(chunkSintetico(1000, 0.5));
    await tick(); // processado durante a pausa → descartado
    p.resume();
    cb!(chunkSintetico(2000, 0.5));
    await tick();
    const session = await p.stop();
    expect(session.segments.length).toBe(2); // o do meio foi descartado
  });

  it("MemoryStorage persiste e lê de volta", async () => {
    const store = new MemoryStorage();
    const p = new Pipeline({
      capture: capturaComDuasFalas(),
      transcriber: transcritorSequencial(),
      translator: new FakeTranslator(),
      idiomaOrig: "en",
      idiomaAlvo: "pt",
    });
    await p.start();
    const session = await p.stop();
    await store.saveSession(session);
    const lida = await store.getSession(session.id);
    expect(lida?.segments.length).toBe(2);
    const lista = await store.list();
    expect(lista[0]?.totalSegmentos).toBe(2);
  });
});

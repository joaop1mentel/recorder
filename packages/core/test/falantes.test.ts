import { describe, expect, it } from "vitest";
import { AtribuidorFalantes } from "../src/falantes.js";
import { Pipeline } from "../src/pipeline.js";
import type { RotuladorFalante } from "../src/ports.js";
import { textoConversa } from "../src/export.js";
import {
  FakeCapture,
  FakeTranscriber,
  FakeTranslator,
  chunkSintetico,
} from "../src/testing/fakes.js";

/** Rotulador que responde conforme uma tabela de janelas simples. */
function rotuladorFixo(
  resposta: { id: string; nome?: string } | undefined,
): RotuladorFalante {
  return { falanteEm: () => resposta };
}

describe("AtribuidorFalantes", () => {
  it("microfone é sempre 'Você', mesmo sem rotulador", () => {
    const a = new AtribuidorFalantes();
    expect(a.atribuir("mic", 0, 100).nome).toBe("Você");
  });

  it("usa o nome real quando o rotulador devolve um", () => {
    const a = new AtribuidorFalantes(rotuladorFixo({ id: "p1", nome: "Maria" }));
    expect(a.atribuir("aba", 0, 100).nome).toBe("Maria");
  });

  it("sem nome, numera participantes de forma estável", () => {
    let atual: { id: string; nome?: string } = { id: "p1" };
    const a = new AtribuidorFalantes({ falanteEm: () => atual });

    expect(a.atribuir("aba", 0, 100).nome).toBe("Participante 1");
    atual = { id: "p2" };
    expect(a.atribuir("aba", 100, 200).nome).toBe("Participante 2");
    atual = { id: "p1" }; // o primeiro voltou a falar
    expect(a.atribuir("aba", 200, 300).nome).toBe("Participante 1");
  });

  it("rotulador que lança não derruba a atribuição", () => {
    const quebrado: RotuladorFalante = {
      falanteEm: () => {
        throw new Error("seletor do Meet mudou");
      },
    };
    const a = new AtribuidorFalantes(quebrado);
    expect(a.atribuir("aba", 0, 100).nome).toBe("Participante");
  });

  it("sem rotulador, áudio da aba vira 'Participante' genérico", () => {
    const a = new AtribuidorFalantes(rotuladorFixo(undefined));
    expect(a.atribuir("aba", 0, 100).nome).toBe("Participante");
  });
});

describe("Pipeline com duas fontes", () => {
  it("separa microfone e aba, ordenando as falas pelo tempo", async () => {
    const mic = new FakeCapture([chunkSintetico(1000, 0.5)], "mic");
    const aba = new FakeCapture([chunkSintetico(0, 0.5)], "aba");

    const p = new Pipeline({
      captures: [mic, aba],
      transcriber: new FakeTranscriber((c) => (c.t0 === 0 ? "oi" : "tudo bem")),
      translator: new FakeTranslator(),
      idiomaOrig: "pt",
      idiomaAlvo: "en",
      traduzirAoVivo: false,
      rotulador: rotuladorFixo({ id: "p1", nome: "Maria" }),
    });

    await p.start();
    const s = await p.stop();

    // a fala da aba (t0=0) tem de vir antes da do microfone (t0=1000)
    expect(s.segments.map((x) => x.falante?.nome)).toEqual(["Maria", "Você"]);
    expect(s.segments.map((x) => x.textoOrig)).toEqual(["oi", "tudo bem"]);
  });

  it("fonte única não rotula falante (gravação presencial)", async () => {
    const p = new Pipeline({
      capture: new FakeCapture([chunkSintetico(0, 0.5)]),
      transcriber: new FakeTranscriber(() => "sozinho"),
      translator: new FakeTranslator(),
      idiomaOrig: "pt",
      idiomaAlvo: "en",
      traduzirAoVivo: false,
    });
    await p.start();
    const s = await p.stop();
    expect(s.segments[0]?.falante).toBeUndefined();
  });
});

describe("textoConversa com falantes", () => {
  it("vira diálogo 'Nome: fala' e agrupa turnos seguidos da mesma pessoa", () => {
    const segments = [
      { nome: "Maria", texto: "bom dia" },
      { nome: "Maria", texto: "vamos começar" },
      { nome: "Você", texto: "claro" },
    ].map((x, i) => ({
      id: String(i),
      t0: i * 1000,
      t1: i * 1000 + 900,
      textoOrig: x.texto,
      idiomaOrig: "pt" as const,
      falante: { id: x.nome, nome: x.nome, fonte: "aba" as const },
    }));

    expect(textoConversa({ segments })).toBe(
      "Maria: bom dia vamos começar\nVocê: claro",
    );
  });

  it("sem falantes continua sendo texto corrido", () => {
    const segments = [
      { id: "a", t0: 0, t1: 1, textoOrig: "um", idiomaOrig: "pt" as const },
      { id: "b", t0: 1, t1: 2, textoOrig: "dois", idiomaOrig: "pt" as const },
    ];
    expect(textoConversa({ segments })).toBe("um dois");
  });
});

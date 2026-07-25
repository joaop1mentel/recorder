import { describe, expect, it } from "vitest";
import { paraSrt, paraTxt, paraJson, textoConversa } from "../src/export.js";
import { criarSessao, type Session } from "../src/session/estado.js";

function sessaoExemplo(): Session {
  const s = criarSessao("en", "pt");
  s.segments = [
    { id: "a", t0: 0, t1: 1500, textoOrig: "Hello", idiomaOrig: "en", textoTrad: "Olá", idiomaTrad: "pt" },
    { id: "b", t0: 1500, t1: 3661000 + 2000, textoOrig: "World", idiomaOrig: "en", textoTrad: "Mundo", idiomaTrad: "pt" },
  ];
  return s;
}

describe("export", () => {
  it("gera SRT com timestamps HH:MM:SS,mmm", () => {
    const srt = paraSrt(sessaoExemplo());
    expect(srt).toContain("00:00:00,000 --> 00:00:01,500");
    expect(srt).toContain("1\n00:00:00,000");
    expect(srt).toContain("Hello");
    // 3661000+2000 ms = 01:01:03,000
    expect(srt).toContain("01:01:03,000");
  });

  it("SRT traduzido usa o texto na língua-alvo", () => {
    const srt = paraSrt(sessaoExemplo(), { traduzido: true });
    expect(srt).toContain("Olá");
    expect(srt).not.toContain("Hello");
  });

  it("TXT bilíngue mostra original e tradução", () => {
    const txt = paraTxt(sessaoExemplo());
    expect(txt).toContain("[00:00:00] Hello");
    expect(txt).toContain("↳ Olá");
  });

  it("textoConversa junta só os originais", () => {
    expect(textoConversa(sessaoExemplo())).toBe("Hello World");
  });

  it("JSON é reimportável", () => {
    const s = sessaoExemplo();
    const parsed = JSON.parse(paraJson(s)) as Session;
    expect(parsed.segments.length).toBe(2);
    expect(parsed.idiomaAlvo).toBe("pt");
  });
});

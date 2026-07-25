import { describe, expect, it } from "vitest";
import { transicao, podeTransicionar } from "../src/session/estado.js";

describe("máquina de estados da sessão", () => {
  it("segue o caminho feliz idle→recording→paused→recording→finalizing→done", () => {
    let e = transicao("idle", "START");
    expect(e).toBe("recording");
    e = transicao(e, "PAUSE");
    expect(e).toBe("paused");
    e = transicao(e, "RESUME");
    expect(e).toBe("recording");
    e = transicao(e, "STOP");
    expect(e).toBe("finalizing");
    e = transicao(e, "FINALIZED");
    expect(e).toBe("done");
  });

  it("permite parar direto de paused", () => {
    expect(transicao("paused", "STOP")).toBe("finalizing");
  });

  it("qualquer estado ativo vai para error", () => {
    expect(transicao("recording", "ERROR")).toBe("error");
    expect(transicao("finalizing", "ERROR")).toBe("error");
  });

  it("rejeita transições inválidas", () => {
    expect(() => transicao("idle", "PAUSE")).toThrow(/inválida/);
    expect(() => transicao("done", "START")).toThrow(/inválida/);
    expect(podeTransicionar("recording", "RESUME")).toBe(false);
    expect(podeTransicionar("idle", "START")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { urlsDeAssets } from "../src/assets.js";

describe("urlsDeAssets", () => {
  it("resolve sob o subcaminho do GitHub Pages", () => {
    const u = urlsDeAssets("/recorder/", "https://joaop1mentel.github.io");
    expect(u.worklet).toBe(
      "https://joaop1mentel.github.io/recorder/capture-worklet.js",
    );
    expect(u.ortBase).toBe("https://joaop1mentel.github.io/recorder/ort/");
  });

  it("resolve na raiz do domínio", () => {
    const u = urlsDeAssets("/", "https://exemplo.com");
    expect(u.worklet).toBe("https://exemplo.com/capture-worklet.js");
    expect(u.ortBase).toBe("https://exemplo.com/ort/");
  });

  it("funciona no dev server com porta", () => {
    const u = urlsDeAssets("/", "http://192.168.0.10:5173");
    expect(u.worklet).toBe("http://192.168.0.10:5173/capture-worklet.js");
  });

  /**
   * A regressão que motivou este arquivo: `new URL(rel, "/recorder/")` lança
   * "Invalid URL", e por ser código de módulo derrubava o app na tela preta.
   */
  it("não lança quando a base é caminho, não URL absoluta", () => {
    expect(() => urlsDeAssets("/recorder/", "https://x.com")).not.toThrow();
    expect(() => new URL("capture-worklet.js", "/recorder/")).toThrow();
  });
});

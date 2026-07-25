/**
 * Resolve as URLs dos assets servidos pelo próprio app (worklet e runtime ORT).
 *
 * Existe como função separada por causa de uma armadilha que já derrubou o PWA
 * inteiro: o `BASE_URL` do Vite é um **caminho** (`"/recorder/"`), não uma URL.
 * Passá-lo direto como base de `new URL()` lança `Invalid URL` — e, como isso
 * roda no escopo do módulo, o app nem chega a renderizar (tela preta, sem
 * mensagem). Ancorar na origem primeiro resolve.
 */
export interface UrlsDeAssets {
  worklet: string;
  ortBase: string;
}

export function urlsDeAssets(baseUrl: string, origin: string): UrlsDeAssets {
  const base = new URL(baseUrl, origin);
  return {
    worklet: new URL("capture-worklet.js", base).href,
    ortBase: new URL("ort/", base).href,
  };
}

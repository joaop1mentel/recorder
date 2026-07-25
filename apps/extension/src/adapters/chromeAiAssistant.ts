import type { AssistenteIA } from "@rt/core";

/** Contexto (transcrito) é truncado — o Gemini Nano tem janela pequena. */
const MAX_CTX = 6000;

/**
 * Assistente de IA on-device via APIs nativas do Chrome (Gemini Nano):
 * Summarizer para resumo e Prompt API (LanguageModel) para o resto.
 * Offline, sem chave e sem custo — mesma família da Translator API.
 */
export class ChromeAiAssistant implements AssistenteIA {
  /** onStatus recebe progresso de download do modelo e "" ao concluir */
  constructor(private onStatus?: (msg: string) => void) {}

  static suportado(): boolean {
    return typeof LanguageModel !== "undefined" || typeof Summarizer !== "undefined";
  }

  async resumir(texto: string): Promise<string> {
    if (typeof Summarizer !== "undefined") {
      const s = await Summarizer.create({
        type: "key-points",
        format: "markdown",
        length: "medium",
        sharedContext:
          "Transcrição de uma conversa falada, em português. Quando houver " +
          "vários participantes, as falas vêm no formato 'Nome: texto'.",
        monitor: (m) => this.monitorar(m),
      });
      this.onStatus?.("");
      const r = await s.summarize(this.cortar(texto));
      s.destroy?.();
      return r;
    }
    return this.viaPrompt(
      "Você resume conversas. Devolva um resumo em tópicos (bullets), em português.",
      this.cortar(texto),
    );
  }

  /**
   * Pontos principais da reunião em andamento. Usa o Summarizer com saída
   * curta: isto roda repetidamente DURANTE a chamada, então precisa ser barato
   * — um resumo longo travaria a UI a cada atualização.
   */
  async pontosPrincipais(texto: string): Promise<string> {
    if (typeof Summarizer !== "undefined") {
      const s = await Summarizer.create({
        type: "key-points",
        format: "markdown",
        length: "short",
        sharedContext:
          "Transcrição parcial de uma reunião ainda em andamento, em português. " +
          "As falas vêm no formato 'Nome: texto'.",
        monitor: (m) => this.monitorar(m),
      });
      this.onStatus?.("");
      const r = await s.summarize(this.cortar(texto));
      s.destroy?.();
      return r;
    }
    return this.viaPrompt(
      "Liste em no máximo 5 bullets os pontos principais desta reunião até agora. " +
        "As falas vêm como 'Nome: texto' — cite quem disse quando for relevante. " +
        "Responda em português, sem introdução.",
      this.cortar(texto),
    );
  }

  itensDeAcao(texto: string): Promise<string> {
    return this.viaPrompt(
      "Você extrai itens de ação de uma conversa. Liste em bullets apenas as tarefas, decisões e combinados concretos, cada um começando com um verbo. Quando as falas vierem como 'Nome: texto', indique o responsável entre parênteses. Se não houver, responda 'Nenhum item de ação identificado.'. Responda em português.",
      this.cortar(texto),
    );
  }

  perguntar(contexto: string, pergunta: string): Promise<string> {
    return this.viaPrompt(
      "Responda à pergunta do usuário usando SOMENTE a conversa abaixo. Se a resposta não estiver na conversa, diga que não foi mencionado. Responda em português.\n\n=== CONVERSA ===\n" +
        this.cortar(contexto),
      pergunta,
    );
  }

  corrigir(texto: string): Promise<string> {
    return this.viaPrompt(
      "Corrija erros de transcrição no texto a seguir (pontuação, palavras trocadas por som parecido, nomes e termos técnicos), preservando o sentido e sem inventar conteúdo. Devolva apenas o texto corrigido, em português.",
      this.cortar(texto),
    );
  }

  private async viaPrompt(system: string, user: string): Promise<string> {
    if (typeof LanguageModel === "undefined") {
      throw new Error(
        "IA on-device indisponível — requer Chrome 138+ com o Prompt API (Gemini Nano).",
      );
    }
    const disp = await LanguageModel.availability();
    if (disp === "unavailable") {
      throw new Error("Modelo de IA on-device não disponível neste dispositivo.");
    }
    const sess = await LanguageModel.create({
      initialPrompts: [{ role: "system", content: system }],
      monitor: (m) => this.monitorar(m),
    });
    this.onStatus?.("");
    try {
      return await sess.prompt(user);
    } finally {
      sess.destroy?.();
    }
  }

  private monitorar(m: EventTarget): void {
    m.addEventListener("downloadprogress", (e: Event) => {
      const p = (e as ProgressEvent).loaded;
      this.onStatus?.(`Baixando modelo de IA… ${Math.round((p ?? 0) * 100)}%`);
    });
  }

  private cortar(texto: string): string {
    return texto.length > MAX_CTX ? texto.slice(-MAX_CTX) : texto;
  }
}

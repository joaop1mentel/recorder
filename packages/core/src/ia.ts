/**
 * Port do assistente de IA — implementado por cada plataforma com seu motor
 * on-device (na extensão: Summarizer + Prompt API do Chrome / Gemini Nano;
 * no celular, futuramente: Gemini Nano do Android / MediaPipe).
 * O núcleo só conhece esta interface.
 */
export interface AssistenteIA {
  /** resumo em tópicos da conversa */
  resumir(texto: string): Promise<string>;
  /**
   * Pontos principais até agora, para rodar DURANTE a reunião. Diferente de
   * `resumir`, é chamado várias vezes sobre uma conversa ainda em andamento —
   * a implementação deve ser barata e tolerar texto incompleto.
   */
  pontosPrincipais(texto: string): Promise<string>;
  /** extrai itens de ação, decisões e combinados */
  itensDeAcao(texto: string): Promise<string>;
  /** responde uma pergunta com base no transcrito */
  perguntar(contexto: string, pergunta: string): Promise<string>;
  /** conserta erros de transcrição usando o contexto */
  corrigir(texto: string): Promise<string>;
}

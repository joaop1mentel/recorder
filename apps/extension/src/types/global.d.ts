// Tipagem mínima das APIs de IA on-device do Chrome (Chrome 138+, Gemini Nano).
// Translator: https://developer.chrome.com/docs/ai/translator-api
// Summarizer + Prompt (LanguageModel): https://developer.chrome.com/docs/ai

declare global {
  type AiAvailability =
    | "unavailable"
    | "downloadable"
    | "downloading"
    | "available";

  // --- Translator -------------------------------------------------------
  interface TranslatorInstance {
    translate(input: string): Promise<string>;
    destroy?(): void;
  }
  interface TranslatorCreateOptions {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: EventTarget) => void;
  }
  interface TranslatorStatic {
    availability(o: {
      sourceLanguage: string;
      targetLanguage: string;
    }): Promise<AiAvailability>;
    create(o: TranslatorCreateOptions): Promise<TranslatorInstance>;
  }

  // --- Summarizer -------------------------------------------------------
  interface SummarizerInstance {
    summarize(input: string, opts?: { context?: string }): Promise<string>;
    destroy?(): void;
  }
  interface SummarizerStatic {
    availability(): Promise<AiAvailability>;
    create(o?: {
      type?: "tldr" | "key-points" | "teaser" | "headline";
      format?: "markdown" | "plain-text";
      length?: "short" | "medium" | "long";
      sharedContext?: string;
      monitor?: (m: EventTarget) => void;
    }): Promise<SummarizerInstance>;
  }

  // --- Prompt API (LanguageModel) ---------------------------------------
  interface LanguageModelInstance {
    prompt(input: string): Promise<string>;
    destroy?(): void;
  }
  interface LanguageModelStatic {
    availability(): Promise<AiAvailability>;
    create(o?: {
      initialPrompts?: Array<{
        role: "system" | "user" | "assistant";
        content: string;
      }>;
      temperature?: number;
      topK?: number;
      monitor?: (m: EventTarget) => void;
    }): Promise<LanguageModelInstance>;
  }

  /* eslint-disable no-var */
  var Translator: TranslatorStatic | undefined;
  var Summarizer: SummarizerStatic | undefined;
  var LanguageModel: LanguageModelStatic | undefined;
  /* eslint-enable no-var */
}

export {};

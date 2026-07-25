import type { Idioma, Translator } from "@rt/core";

/**
 * Tradução offline via Chrome Built-in Translator API (Chrome 138+, desktop).
 * O modelo roda no próprio navegador; o 1º par de idiomas pode exigir download.
 */
export class ChromeTranslator implements Translator {
  private inst?: TranslatorInstance;
  private par?: string;
  /** preparo em andamento, para deduplicar chamadas concorrentes */
  private prep?: { par: string; promise: Promise<void> };
  /** par que já falhou — para não martelar a API a cada segmento */
  private falhou?: { par: string; erro: Error };

  /** onStatus recebe mensagens de progresso (download do pacote) e "" ao concluir */
  constructor(private onStatus?: (msg: string) => void) {}

  static suportado(): boolean {
    return typeof Translator !== "undefined";
  }

  ready(src: Idioma, dst: Idioma): Promise<void> {
    if (typeof Translator === "undefined") {
      return Promise.reject(
        new Error("Translator API indisponível — requer Chrome 138+ no desktop."),
      );
    }
    if (src === "auto") {
      return Promise.reject(
        new Error("A tradução exige um idioma de origem definido (não 'auto')."),
      );
    }
    const par = `${src}->${dst}`;
    // mesmo idioma: nada a traduzir
    if (src === dst) return Promise.resolve();
    if (this.inst && this.par === par) return Promise.resolve();
    if (this.falhou && this.falhou.par === par) {
      return Promise.reject(this.falhou.erro);
    }
    if (this.prep && this.prep.par === par) return this.prep.promise;

    const promise = (async () => {
      try {
        const disp = await Translator!.availability({
          sourceLanguage: src,
          targetLanguage: dst,
        });
        if (disp === "unavailable") {
          throw new Error(
            `O par de idiomas ${par} não é suportado pela tradução on-device do Chrome.`,
          );
        }
        if (disp !== "available") {
          this.onStatus?.("Baixando pacote de tradução…");
        }
        this.inst = await Translator!.create({
          sourceLanguage: src,
          targetLanguage: dst,
          monitor: (m) => {
            m.addEventListener("downloadprogress", (e: Event) => {
              const p = (e as ProgressEvent).loaded;
              this.onStatus?.(
                `Baixando pacote de tradução… ${Math.round((p ?? 0) * 100)}%`,
              );
            });
          },
        });
        this.onStatus?.("");
        this.par = par;
      } catch (e) {
        const erro = e instanceof Error ? e : new Error(String(e));
        this.falhou = { par, erro }; // memoriza para não repetir
        throw erro;
      }
    })();
    this.prep = { par, promise };
    return promise;
  }

  async translate(texto: string, src: Idioma, dst: Idioma): Promise<string> {
    if (src === dst) return texto;
    if (!this.inst || this.par !== `${src}->${dst}`) await this.ready(src, dst);
    return this.inst!.translate(texto);
  }
}

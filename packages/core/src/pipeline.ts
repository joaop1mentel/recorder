import { AtribuidorFalantes } from "./falantes.js";
import { agruparEmJanelas, type OpcoesJanela } from "./janelas.js";
import type { Idioma } from "./idiomas.js";
import type {
  AudioCapture,
  AudioChunk,
  DepositoFalas,
  FalaGravada,
  RotuladorFalante,
  Transcriber,
  Translator,
} from "./ports.js";
import type { FonteAudio, Segment } from "./segments.js";
import {
  criarSessao,
  transicao,
  type EstadoSessao,
  type Session,
} from "./session/estado.js";
import { novoId, paraFloat32, paraInt16 } from "./util.js";

/**
 * `aoVivo` transcreve cada fala assim que ela fecha (desktop, onde o Whisper é
 * mais rápido que a fala). `depois` só guarda o áudio e transcreve tudo no fim —
 * é o modo do celular, onde transcrever ao vivo acumularia fila sem fim.
 */
export type ModoTranscricao = "aoVivo" | "depois";

interface PipelineBase {
  transcriber: Transcriber;
  translator: Translator;
  idiomaOrig: Idioma;
  idiomaAlvo: Idioma;
  /** traduzir cada fala assim que transcrita (padrão true). Se false, traduz só depois. */
  traduzirAoVivo?: boolean;
  /** identifica quem falou (reunião); ausente = gravação sem separação de falantes */
  rotulador?: RotuladorFalante;
  /** padrão "aoVivo" — preserva o comportamento da extensão */
  modo?: ModoTranscricao;
  /** obrigatório no modo "depois": onde as falas cruas ficam até serem transcritas */
  deposito?: DepositoFalas;
}

/**
 * Uma fonte de áudio (`capture`) ou várias (`captures`). Numa reunião são duas:
 * o microfone (você) e o áudio da aba (os outros participantes).
 */
export type PipelineOpts = PipelineBase &
  ({ capture: AudioCapture } | { captures: AudioCapture[] });

export interface PipelineListeners {
  /** um segmento final foi adicionado ao transcrito */
  onSegment?: (seg: Segment, session: Session) => void;
  /** o estado da sessão mudou */
  onEstado?: (estado: EstadoSessao, session: Session) => void;
  /** erro não fatal durante o processamento */
  onErro?: (erro: unknown) => void;
  /** modo "depois": uma fala foi guardada (ainda sem texto) — para o contador na UI */
  onFalaGravada?: (total: number) => void;
}

/**
 * Orquestra captura → transcrição → (tradução) e vai montando a `session`.
 * Toda a lógica de ordem/estado vive aqui, uma única vez, valendo para a
 * extensão e para o app de celular — cada plataforma só injeta os adapters.
 */
export class Pipeline {
  readonly session: Session;
  private readonly opts: PipelineOpts;
  private readonly listeners: PipelineListeners;
  private readonly captures: AudioCapture[];
  private readonly falantes: AtribuidorFalantes;
  /** processa os blocos em série para preservar a ordem temporal */
  private fila: Promise<void> = Promise.resolve();
  /** modo "depois": quantas falas já foram guardadas */
  private falasGravadas = 0;

  constructor(opts: PipelineOpts, listeners: PipelineListeners = {}) {
    this.opts = opts;
    this.listeners = listeners;
    this.captures = "captures" in opts ? opts.captures : [opts.capture];
    this.falantes = new AtribuidorFalantes(opts.rotulador);
    this.session = criarSessao(opts.idiomaOrig, opts.idiomaAlvo);
  }

  private get traduzirAoVivo(): boolean {
    // no modo "depois" nada é transcrito durante a captura, então não há o que traduzir
    return this.modo === "aoVivo" && (this.opts.traduzirAoVivo ?? true);
  }

  private get modo(): ModoTranscricao {
    return this.opts.modo ?? "aoVivo";
  }

  private mudarEstado(evento: Parameters<typeof transicao>[1]): void {
    this.session.estado = transicao(this.session.estado, evento);
    this.session.atualizadoEm = Date.now();
    this.listeners.onEstado?.(this.session.estado, this.session);
  }

  async start(): Promise<void> {
    this.mudarEstado("START");
    // Pede o microfone IMEDIATAMENTE, ainda dentro do gesto do usuário — antes
    // de qualquer preparo do tradutor (que pode baixar modelo e demorar), senão
    // o prompt de permissão aparece tarde e o Chrome o dispensa.
    for (const capture of this.captures) {
      const fonte = capture.fonte ?? "mic";
      capture.onChunk((chunk) => this.enfileirar(chunk, fonte));
    }
    await Promise.all(this.captures.map((c) => c.start()));
    if (this.traduzirAoVivo) {
      // prepara o par de idiomas em segundo plano; não bloqueia a gravação
      void this.opts.translator
        .ready(this.opts.idiomaOrig, this.opts.idiomaAlvo)
        .catch((e) => this.listeners.onErro?.(e));
    }
  }

  pause(): void {
    this.mudarEstado("PAUSE");
  }

  resume(): void {
    this.mudarEstado("RESUME");
  }

  /** Encerra a captura, drena os blocos pendentes e finaliza a sessão. */
  async stop(): Promise<Session> {
    await Promise.all(this.captures.map((c) => c.stop()));
    await this.fila; // processa o que já foi capturado (estado ainda permite)
    this.mudarEstado("STOP"); // recording|paused -> finalizing
    this.mudarEstado("FINALIZED"); // finalizing -> done
    // com várias fontes os blocos chegam intercalados; ordena pelo tempo real da fala
    this.session.segments.sort((a, b) => a.t0 - b.t0);
    this.session.atualizadoEm = Date.now();
    return this.session;
  }

  private enfileirar(chunk: AudioChunk, fonte: FonteAudio): void {
    this.fila = this.fila
      .then(() => this.processar(chunk, fonte))
      .catch((e) => this.listeners.onErro?.(e));
  }

  /**
   * Modo "depois": só arquiva o áudio. Barato o bastante para acompanhar a fala
   * em qualquer celular — a conta pesada fica para `transcreverPendentes`.
   */
  private async guardar(chunk: AudioChunk, fonte: FonteAudio): Promise<void> {
    const deposito = this.opts.deposito;
    if (!deposito) {
      throw new Error('Modo "depois" exige um `deposito` de falas.');
    }
    const durMs = (chunk.pcm.length / chunk.sampleRate) * 1000;
    await deposito.guardar(this.session.id, {
      id: novoId(),
      t0: chunk.t0,
      t1: chunk.t0 + durMs,
      pcm: paraInt16(chunk.pcm),
      sampleRate: chunk.sampleRate,
      fonte,
    });
    this.session.duracaoMs = Math.max(this.session.duracaoMs, chunk.t0 + durMs);
    this.falasGravadas++;
    this.listeners.onFalaGravada?.(this.falasGravadas);
  }

  private async processar(chunk: AudioChunk, fonte: FonteAudio): Promise<void> {
    if (this.session.estado !== "recording") return; // ignora blocos durante pausa
    if (this.modo === "depois") return this.guardar(chunk, fonte);

    const segs = await this.opts.transcriber.transcribe(
      chunk,
      this.opts.idiomaOrig,
    );
    for (const seg of segs) {
      if (!seg.textoOrig.trim()) continue;
      // só rotula quando há mais de uma fonte: na gravação presencial simples
      // não existe "quem falou", e marcar tudo como "Você" só poluiria.
      if (this.captures.length > 1) {
        seg.falante = this.falantes.atribuir(fonte, seg.t0, seg.t1);
      }
      if (this.traduzirAoVivo) {
        try {
          seg.textoTrad = await this.opts.translator.translate(
            seg.textoOrig,
            this.opts.idiomaOrig,
            this.opts.idiomaAlvo,
          );
          seg.idiomaTrad = this.opts.idiomaAlvo;
        } catch (e) {
          this.listeners.onErro?.(e); // sem tradução, mas mantém o original
        }
      }
      this.session.segments.push(seg);
      this.session.duracaoMs = Math.max(this.session.duracaoMs, seg.t1);
      this.listeners.onSegment?.(seg, this.session);
    }
  }
}

export interface ProgressoTranscricao {
  feitas: number;
  total: number;
}

/**
 * Transcreve as falas arquivadas no modo "depois" e monta o transcrito da sessão.
 *
 * É a etapa cara do celular: roda uma vez, ao parar a gravação, reportando
 * progresso para a UI poder mostrar a barra. Recebe o `rotulador` só para manter
 * a mesma regra de falantes do modo ao vivo.
 */
export async function transcreverPendentes(
  session: Session,
  transcriber: Transcriber,
  deposito: DepositoFalas,
  opts: {
    onProgresso?: (p: ProgressoTranscricao) => void;
    rotulador?: RotuladorFalante;
    /** true quando houve mais de uma fonte de áudio (reunião) */
    comFalantes?: boolean;
    janela?: OpcoesJanela;
  } = {},
): Promise<Session> {
  const falas = await deposito.listar(session.id);
  // Agrupar antes de transcrever é o que salva a precisão: o Whisper erra muito
  // com fragmentos soltos de 1-2 s, mas vai bem com janelas de ~30 s.
  const janelas = agruparEmJanelas(falas, opts.janela);
  const falantes = new AtribuidorFalantes(opts.rotulador);
  opts.onProgresso?.({ feitas: 0, total: janelas.length });

  for (let i = 0; i < janelas.length; i++) {
    const janela = janelas[i]!;
    const segs = await transcriber.transcribe(janela.chunk, session.idiomaOrig);
    for (const seg of segs) {
      if (!seg.textoOrig.trim()) continue;
      if (opts.comFalantes) {
        seg.falante = falantes.atribuir(janela.fonte, seg.t0, seg.t1);
      }
      session.segments.push(seg);
    }
    opts.onProgresso?.({ feitas: i + 1, total: janelas.length });
  }

  session.segments.sort((a, b) => a.t0 - b.t0);
  session.atualizadoEm = Date.now();
  // o áudio cru já cumpriu seu papel; segurá-lo encheria o disco do celular
  await deposito.limpar(session.id);
  return session;
}

/**
 * Traduz (ou completa) os segmentos ainda sem tradução — usado no modo
 * "traduzir depois da gravação" e para reprocessar sessões salvas.
 */
export async function traduzirPendentes(
  session: Session,
  translator: Translator,
): Promise<Session> {
  await translator.ready(session.idiomaOrig, session.idiomaAlvo);
  for (const seg of session.segments) {
    if (!seg.textoTrad && seg.textoOrig.trim()) {
      seg.textoTrad = await translator.translate(
        seg.textoOrig,
        session.idiomaOrig,
        session.idiomaAlvo,
      );
      seg.idiomaTrad = session.idiomaAlvo;
    }
  }
  session.atualizadoEm = Date.now();
  return session;
}

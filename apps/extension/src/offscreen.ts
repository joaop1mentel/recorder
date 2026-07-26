import {
  Pipeline,
  traduzirPendentes,
  type AudioCapture,
  type Session,
} from "@rt/core";
import { GetUserMediaCapture, WhisperTranscriber } from "@rt/web";
import { TabCapture } from "./adapters/tabCapture.js";
import { ChromeTranslator } from "./adapters/chromeTranslator.js";
import { MeetRotulador } from "./adapters/meetRotulador.js";
import type {
  ComandoOffscreen,
  EventoMeet,
  EventoOffscreen,
  OpcoesGravacao,
} from "./mensagens.js";

/**
 * Dono do áudio. Fica aqui (e não no painel lateral) porque o painel é destruído
 * assim que o usuário o fecha — o que numa reunião longa significaria perder a
 * gravação inteira. O offscreen sobrevive enquanto a extensão estiver ativa.
 */

/** Assets servidos pela própria extensão (a CSP do MV3 proíbe origem remota). */
const WORKLET_URL = chrome.runtime.getURL("capture-worklet.js");
const ORT_BASE = chrome.runtime.getURL("ort/");

let pipe: Pipeline | null = null;
let transcriber: WhisperTranscriber | null = null;
let translator: ChromeTranslator | null = null;
let rotulador: MeetRotulador | null = null;
let opcoes: OpcoesGravacao | null = null;

function emitir(ev: EventoOffscreen): void {
  chrome.runtime.sendMessage(ev).catch(() => {
    // painel fechado: a gravação continua, só não há ninguém ouvindo agora
  });
}

async function iniciar(opts: OpcoesGravacao): Promise<void> {
  opcoes = opts;
  emitir({ tipo: "status", campo: "modelo", msg: "Carregando modelo de transcrição…" });

  const mic = new GetUserMediaCapture(WORKLET_URL);
  mic.onLevel((v) => emitir({ tipo: "nivel", valor: v }));

  const captures: AudioCapture[] = [mic];
  if (opts.streamId) {
    // reunião: o áudio da aba entra como segunda fonte (os outros participantes)
    captures.push(new TabCapture(WORKLET_URL, opts.streamId));
    rotulador = new MeetRotulador(Date.now());
  } else {
    rotulador = null;
  }

  transcriber = new WhisperTranscriber({
    modelId: opts.modelo,
    ortBase: ORT_BASE,
    worker: new Worker(
      new URL("@rt/web/whisper.worker", import.meta.url),
      { type: "module" },
    ),
  });
  translator = new ChromeTranslator((msg) =>
    emitir({ tipo: "status", campo: "traducao", msg }),
  );

  const usarTraducao = opts.traduzirAoVivo && ChromeTranslator.suportado();
  if (usarTraducao) {
    translator.ready(opts.origem, opts.alvo).catch((e) =>
      emitir({ tipo: "erro", msg: String(e) }),
    );
  }

  pipe = new Pipeline(
    {
      captures,
      transcriber,
      translator,
      idiomaOrig: opts.origem,
      idiomaAlvo: opts.alvo,
      traduzirAoVivo: usarTraducao,
      rotulador: rotulador ?? undefined,
    },
    {
      onSegment: (seg) => emitir({ tipo: "segmento", seg }),
      onEstado: (estado) => emitir({ tipo: "estado", estado }),
      onErro: (e) => emitir({ tipo: "erro", msg: String(e) }),
    },
  );

  transcriber.whenReady().then(() =>
    emitir({ tipo: "status", campo: "modelo", msg: "" }),
  );

  try {
    // marca o zero do relógio o mais perto possível do início real da captura,
    // senão os nomes vindos do Meet ficam deslocados no tempo
    rotulador?.marcarInicio(Date.now());
    await pipe.start();
  } catch (e) {
    const erro = e as Error;
    emitir({
      tipo: "erro",
      msg: String(e),
      permissaoMic: erro?.name === "NotAllowedError",
    });
    emitir({ tipo: "estado", estado: "idle" });
    await limpar();
  }
}

async function parar(): Promise<void> {
  // captura e zera já aqui: se "parar" chegar duas vezes (duplo clique, painel
  // reenviando), a segunda chamada não pode ver `pipe` ainda de pé e chamar
  // `.stop()` de novo — isso fecha o mesmo AudioContext duas vezes e lança
  // "Cannot close a closed AudioContext".
  const emAndamento = pipe;
  if (!emAndamento) return;
  pipe = null;
  const session: Session = await emAndamento.stop();
  emitir({ tipo: "nivel", valor: 0 });

  // completa traduções que ficaram para trás (pacote de idioma ainda baixando)
  if (
    translator &&
    opcoes &&
    ChromeTranslator.suportado() &&
    opcoes.origem !== opcoes.alvo &&
    session.segments.some((s) => !s.textoTrad)
  ) {
    emitir({ tipo: "status", campo: "modelo", msg: "Traduzindo trechos pendentes…" });
    try {
      await traduzirPendentes(session, translator);
    } catch (e) {
      emitir({ tipo: "erro", msg: String(e) });
    }
    emitir({ tipo: "status", campo: "modelo", msg: "" });
  }

  emitir({ tipo: "finalizado", session });
  await limpar();
}

async function limpar(): Promise<void> {
  await transcriber?.dispose();
  pipe = null;
  transcriber = null;
  translator = null;
  rotulador = null;
  opcoes = null;
}

chrome.runtime.onMessage.addListener((msg: ComandoOffscreen | EventoMeet) => {
  switch (msg.tipo) {
    case "iniciar":
      void iniciar(msg.opts);
      break;
    case "pausar":
      pipe?.pause();
      break;
    case "retomar":
      pipe?.resume();
      break;
    case "parar":
      void parar();
      break;
    // sinais do Meet: alimentam o rotulador de falantes
    case "meet:falaInicio":
      rotulador?.registrar({ id: msg.id, nome: msg.nome, inicio: msg.wall });
      break;
    case "meet:falaFim":
      rotulador?.fechar(msg.id, msg.wall);
      break;
  }
  // sem resposta assíncrona: não retornamos true de propósito
  return undefined;
});

/**
 * Avisa o background que os listeners já estão no ar. Sem isto haveria uma
 * corrida: `createDocument()` resolve quando a página existe, mas o módulo
 * ainda pode estar carregando — um "iniciar" enviado nessa fresta se perderia
 * e o usuário veria "cliquei em Gravar e não aconteceu nada".
 */
chrome.runtime.sendMessage({ tipo: "offscreenPronto" }).catch(() => {});

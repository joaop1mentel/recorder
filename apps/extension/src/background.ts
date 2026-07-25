import type { EstadoReuniao, EventoMeet } from "./mensagens.js";

// Abre o painel lateral ao clicar no ícone da extensão.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.error("sidePanel:", e));

/** Aba do Meet em chamada agora (o Chrome descarta o service worker, então o estado também vai para o storage). */
let reuniao: EstadoReuniao = { emReuniao: false };

async function salvar(): Promise<void> {
  await chrome.storage.session.set({ reuniao }).catch(() => {});
}

async function carregar(): Promise<void> {
  const { reuniao: salva } = await chrome.storage.session
    .get("reuniao")
    .catch(() => ({ reuniao: undefined }));
  if (salva) reuniao = salva as EstadoReuniao;
}
void carregar();

function pintarBadge(): void {
  const ativo = reuniao.emReuniao;
  void chrome.action.setBadgeText({ text: ativo ? "REC" : "" });
  void chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
  void chrome.action.setTitle({
    title: ativo
      ? "Reunião detectada — abra o painel para gravar"
      : "Recorder + Translator — abrir painel",
  });
}

/**
 * `getMediaStreamId` já devolve Promise no Chrome atual, mas os @types ainda
 * declaram só a forma com callback — envolvemos para usar await sem `any`.
 */
function pedirStreamId(targetTabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId }, (streamId) => {
      const erro = chrome.runtime.lastError;
      if (erro) reject(new Error(erro.message));
      else resolve(streamId);
    });
  });
}

/**
 * Garante o documento offscreen, onde o áudio de fato roda. É criado sob
 * demanda porque o Chrome permite apenas um por extensão.
 */
let avisarPronto: (() => void) | null = null;

export async function garantirOffscreen(): Promise<void> {
  const existentes = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existentes.length > 0) return;

  // Espera o "offscreenPronto": createDocument resolve com a página criada, mas
  // o script pode ainda não ter registrado o onMessage — comandos enviados
  // nessa fresta se perderiam silenciosamente.
  const pronto = new Promise<void>((resolve) => {
    avisarPronto = resolve;
    // se algo der errado do outro lado, seguir mesmo assim é melhor que travar
    setTimeout(resolve, 3000);
  });
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification:
      "Capturar microfone e áudio da aba para transcrever a reunião no dispositivo.",
  });
  await pronto;
  avisarPronto = null;
}

chrome.runtime.onMessage.addListener((msg: EventoMeet | { tipo: string }, sender, responder) => {
  switch (msg.tipo) {
    case "meet:entrou":
      reuniao = {
        emReuniao: true,
        tabId: sender.tab?.id,
        titulo: (msg as Extract<EventoMeet, { tipo: "meet:entrou" }>).titulo,
      };
      pintarBadge();
      void salvar();
      break;

    case "meet:saiu":
      reuniao = { emReuniao: false };
      pintarBadge();
      void salvar();
      break;

    case "meet:semLeitura":
      reuniao = { ...reuniao, semLeitura: true };
      void salvar();
      break;

    case "offscreenPronto":
      avisarPronto?.();
      break;

    // o painel pergunta se há reunião aberta ao abrir
    case "reuniao?":
      responder(reuniao);
      return true;

    /**
     * O painel pede o streamId da aba da reunião. Precisa passar por aqui: a
     * API só existe no service worker, e o Chrome exige que a chamada nasça de
     * um gesto do usuário (o clique em "Gravar" no painel) — não há como
     * iniciar a captura da aba sozinho.
     */
    case "capturarAba":
      void (async () => {
        try {
          await garantirOffscreen();
          const tabId = reuniao.tabId;
          if (tabId === undefined) {
            responder({ erro: "Nenhuma reunião do Meet detectada." });
            return;
          }
          responder({ streamId: await pedirStreamId(tabId) });
        } catch (e) {
          responder({ erro: String(e) });
        }
      })();
      return true; // resposta assíncrona

    case "prepararOffscreen":
      void (async () => {
        try {
          await garantirOffscreen();
          responder({ ok: true });
        } catch (e) {
          responder({ erro: String(e) });
        }
      })();
      return true;
  }
  return undefined;
});

/**
 * Injeta o content script nas abas do Meet JÁ ABERTAS.
 *
 * `content_scripts` do manifest só roda em carregamento de página: quem já
 * estava numa reunião quando a extensão foi instalada/recarregada ficaria sem
 * detecção nenhuma até dar F5 — que foi exatamente o sintoma de "iniciei o Meet
 * e não apareceu nada".
 */
async function injetarNasAbasAbertas(): Promise<void> {
  try {
    const abas = await chrome.tabs.query({ url: "https://meet.google.com/*" });
    for (const aba of abas) {
      if (aba.id === undefined) continue;
      await chrome.scripting
        .executeScript({ target: { tabId: aba.id }, files: ["content-meet.js"] })
        .catch(() => {
          // aba protegida ou já com o script rodando — ignorar
        });
    }
  } catch {
    // sem a permissão "scripting" ou nenhuma aba do Meet aberta
  }
}
chrome.runtime.onInstalled.addListener(() => void injetarNasAbasAbertas());
chrome.runtime.onStartup.addListener(() => void injetarNasAbasAbertas());

// Se a aba da reunião for fechada, o content script não consegue mais avisar.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (reuniao.tabId === tabId) {
    reuniao = { emReuniao: false };
    pintarBadge();
    void salvar();
  }
});

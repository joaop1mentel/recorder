import type { EventoMeet } from "../mensagens.js";

/**
 * Content script do Google Meet. Faz duas coisas, ambas por observação do DOM:
 *
 *   1. detecta entrada/saída da chamada  → o painel oferece gravar
 *   2. observa quem está falando          → nomes reais no transcrito
 *
 * ⚠️ O Meet não tem API pública para isto e ofusca as classes do DOM. Todo
 * seletor aqui é frágil por natureza e vai quebrar quando o Google mexer no
 * layout. Por isso o código é escrito para FALHAR SILENCIOSAMENTE: se nada for
 * encontrado, avisa `meet:semLeitura` e a gravação continua sem nomes (o core
 * cai para "Participante N"). Nunca lançar erro daqui.
 */

const INTERVALO_VARREDURA = 500;
/** URL de sala é meet.google.com/abc-defg-hij (com ou sem barra no fim) */
const RE_SALA = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/i;

/** Liga logs no console da aba do Meet: `localStorage.recorderDebug = "1"`. */
const DEBUG = (() => {
  try {
    return localStorage.getItem("recorderDebug") === "1";
  } catch {
    return false;
  }
})();

function log(...args: unknown[]): void {
  if (DEBUG) console.log("[recorder/meet]", ...args);
}

function avisar(msg: EventoMeet): void {
  try {
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch {
    // extensão recarregada / contexto invalidado — não é problema do usuário
  }
}

/**
 * Estamos numa sala do Meet?
 *
 * Decidido **só pela URL**, de propósito. A primeira versão exigia também achar
 * o botão de microfone no DOM, e foi assim que o recurso morreu em silêncio na
 * primeira reunião de verdade: seletor não casou → nada foi detectado.
 *
 * O padrão da URL é estável há anos e não depende de idioma nem de layout. Um
 * falso positivo (badge aparecer na tela de entrada, antes de entrar) custa
 * quase nada; um falso negativo quebra o recurso inteiro.
 */
function naSala(): boolean {
  return RE_SALA.test(location.pathname);
}

/**
 * Tiles dos participantes. Tentamos vários seletores porque o Meet troca de um
 * para outro entre versões; o primeiro que devolver algo vence.
 */
function tiles(): HTMLElement[] {
  const tentativas = [
    "[data-participant-id]",
    "[data-requested-participant-id]",
    "[data-initial-participant-id]",
  ];
  for (const sel of tentativas) {
    const achados = Array.from(document.querySelectorAll<HTMLElement>(sel));
    if (achados.length) return achados;
  }
  return [];
}

function idDoTile(el: HTMLElement): string | undefined {
  return (
    el.dataset.participantId ??
    el.dataset.requestedParticipantId ??
    el.dataset.initialParticipantId ??
    undefined
  );
}

/**
 * Nome exibido no tile. O Meet costuma repetir o nome em vários nós; pegamos o
 * texto curto mais plausível, evitando cair em legendas ou textos longos.
 */
function nomeDoTile(el: HTMLElement): string | undefined {
  const candidatos = [
    el.getAttribute("data-self-name"),
    el.querySelector("[data-self-name]")?.getAttribute("data-self-name"),
    ...Array.from(el.querySelectorAll<HTMLElement>("div,span"))
      .map((n) => n.textContent?.trim() ?? "")
      .filter((t) => t.length > 0 && t.length <= 60 && !t.includes("\n")),
  ];
  for (const c of candidatos) {
    const nome = c?.trim();
    if (nome) return nome;
  }
  return undefined;
}

/**
 * Está falando? O Meet anima um indicador de voz no tile. Sem classe estável
 * para checar, usamos os sinais que sobrevivem melhor: o atributo de discurso
 * e a presença do container de animação do microfone.
 */
function estaFalando(el: HTMLElement): boolean {
  if (el.hasAttribute("data-is-speaking")) {
    return el.getAttribute("data-is-speaking") !== "false";
  }
  const indicador = el.querySelector<HTMLElement>(
    '[class*="IisKdb"], [class*="wEsLMd"], [data-speaking-indicator]',
  );
  if (!indicador) return false;
  // o indicador existe sempre; só está "aceso" quando visível/animando
  const estilo = getComputedStyle(indicador);
  return estilo.display !== "none" && estilo.visibility !== "hidden";
}

const falandoAgora = new Set<string>();
let dentro = false;
let jaAvisouSemLeitura = false;

function varrer(): void {
  const agora = naSala();
  if (agora !== dentro) {
    dentro = agora;
    log(agora ? "entrou na sala" : "saiu da sala", location.pathname);
    avisar(agora ? { tipo: "meet:entrou", titulo: document.title } : { tipo: "meet:saiu" });
    if (!agora) {
      falandoAgora.clear();
      jaAvisouSemLeitura = false;
    }
  }
  if (!dentro) return;

  const lista = tiles();
  if (!lista.length) {
    // Estamos na chamada mas não enxergamos ninguém: o layout mudou.
    // Avisa UMA vez — a gravação continua, só sem nomes.
    if (!jaAvisouSemLeitura) {
      jaAvisouSemLeitura = true;
      log("nenhum tile de participante encontrado — sem nomes nesta reunião");
      avisar({ tipo: "meet:semLeitura" });
    }
    return;
  }

  const vistos = new Set<string>();
  for (const tile of lista) {
    const id = idDoTile(tile);
    if (!id) continue;
    vistos.add(id);
    const falando = estaFalando(tile);
    const estava = falandoAgora.has(id);
    if (falando && !estava) {
      falandoAgora.add(id);
      avisar({
        tipo: "meet:falaInicio",
        id,
        nome: nomeDoTile(tile),
        wall: Date.now(),
      });
    } else if (!falando && estava) {
      falandoAgora.delete(id);
      avisar({ tipo: "meet:falaFim", id, wall: Date.now() });
    }
  }
  // participante que saiu da chamada enquanto falava
  for (const id of [...falandoAgora]) {
    if (!vistos.has(id)) {
      falandoAgora.delete(id);
      avisar({ tipo: "meet:falaFim", id, wall: Date.now() });
    }
  }
}

// Polling em vez de MutationObserver: o Meet muda o DOM dezenas de vezes por
// segundo (vídeo, layout), e observar tudo custaria mais CPU do que uma
// varredura curta a cada 500 ms.
setInterval(() => {
  try {
    varrer();
  } catch (e) {
    log("erro na varredura:", e);
    // qualquer mudança inesperada do Meet não pode derrubar a página do usuário
  }
}, INTERVALO_VARREDURA);

// Uma linha, sempre. Sem ela não há como responder "o script chegou a carregar?"
// olhando o console — e essa foi a primeira dúvida na primeira reunião real.
console.log(
  `[recorder] extensão ativa nesta aba · sala detectada: ${naSala() ? "sim" : "não"} (${location.pathname})`,
);

// varre já na carga, sem esperar o primeiro tick
varrer();

import { useEffect, useRef, useState } from "react";
import {
  IDIOMAS_COMUNS,
  paraJson,
  paraSrt,
  paraTxt,
  textoConversa,
  type Idioma,
  type Segment,
  type Session,
} from "@rt/core";
import { IndexedDbStorage } from "@rt/web";
import { ChromeTranslator } from "../adapters/chromeTranslator.js";
import { ChromeAiAssistant } from "../adapters/chromeAiAssistant.js";
import type {
  ComandoOffscreen,
  EstadoReuniao,
  EventoOffscreen,
} from "../mensagens.js";
import { baixar } from "./download.js";

type Estado = "idle" | "recording" | "paused" | "finalizing" | "done";
const MODELOS = [
  { id: "Xenova/whisper-tiny", nome: "Whisper tiny (rápido)" },
  { id: "Xenova/whisper-base", nome: "Whisper base (equilibrado)" },
  { id: "Xenova/whisper-small", nome: "Whisper small (preciso, pesado)" },
];
const storage = new IndexedDbStorage();

/** De quanto em quanto tempo os pontos principais são recalculados durante a reunião. */
const INTERVALO_PONTOS_MS = 90_000;
/** Mínimo de falas novas para valer a pena recalcular (evita gastar IA à toa). */
const MIN_SEGMENTOS_PONTOS = 5;

function mensagemErroInicio(msg: string, permissaoMic?: boolean): string {
  if (permissaoMic) {
    return "Permissão de microfone negada ou dispensada. Clique em Gravar de novo e escolha “Permitir”. Se o pedido não aparecer, clique no cadeado/ícone da barra de endereço e libere o microfone para esta extensão.";
  }
  return msg;
}

function enviar(cmd: ComandoOffscreen): void {
  void chrome.runtime.sendMessage(cmd).catch(() => {});
}

export function App() {
  const [origem, setOrigem] = useState<Idioma>("pt");
  const [alvo, setAlvo] = useState<Idioma>("en");
  const [modelo, setModelo] = useState("Xenova/whisper-base");
  const [aoVivo, setAoVivo] = useState(true);

  const [estado, setEstado] = useState<Estado>("idle");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [nivel, setNivel] = useState(0);
  const [statusModelo, setStatusModelo] = useState("");
  const [statusTrad, setStatusTrad] = useState("");
  const [aviso, setAviso] = useState("");
  const [precisaMic, setPrecisaMic] = useState(false);
  const [sessionAtual, setSessionAtual] = useState<Session | null>(null);
  const [historico, setHistorico] = useState<
    Awaited<ReturnType<typeof storage.list>>
  >([]);

  // Reunião
  const [reuniao, setReuniao] = useState<EstadoReuniao>({ emReuniao: false });
  const [gravandoReuniao, setGravandoReuniao] = useState(false);
  const [pontos, setPontos] = useState("");
  const [pontosEm, setPontosEm] = useState(0);

  // IA
  const [iaStatus, setIaStatus] = useState("");
  const [iaTitulo, setIaTitulo] = useState("");
  const [iaResultado, setIaResultado] = useState("");
  const [iaRodando, setIaRodando] = useState(false);
  const [pergunta, setPergunta] = useState("");

  const listaRef = useRef<HTMLDivElement>(null);
  // usados dentro do timer dos pontos, que não deve reagir a cada render
  const segsRef = useRef<Segment[]>([]);
  const pontosEmRef = useRef(0);

  useEffect(() => {
    segsRef.current = segments;
  }, [segments]);
  useEffect(() => {
    pontosEmRef.current = pontosEm;
  }, [pontosEm]);

  // Recebe tudo o que acontece no offscreen (onde o áudio realmente roda).
  useEffect(() => {
    const ouvir = (msg: EventoOffscreen) => {
      switch (msg.tipo) {
        case "segmento":
          setSegments((prev) => [...prev, msg.seg]);
          break;
        case "estado":
          setEstado(msg.estado as Estado);
          break;
        case "nivel":
          setNivel(msg.valor);
          break;
        case "status":
          if (msg.campo === "modelo") setStatusModelo(msg.msg);
          else setStatusTrad(msg.msg);
          break;
        case "erro":
          setAviso(mensagemErroInicio(msg.msg, msg.permissaoMic));
          if (msg.permissaoMic) setPrecisaMic(true);
          break;
        case "finalizado":
          void finalizar(msg.session);
          break;
      }
    };
    chrome.runtime.onMessage.addListener(ouvir);
    return () => chrome.runtime.onMessage.removeListener(ouvir);
  }, []);

  useEffect(() => {
    if (!ChromeTranslator.suportado()) {
      setAviso(
        "Tradução on-device indisponível neste navegador (requer Chrome 138+ desktop). A gravação e a transcrição continuam funcionando.",
      );
    }
    void recarregarHistorico();
    void consultarReuniao();
    // o content script avisa o background; consultamos de tempos em tempos
    const t = setInterval(() => void consultarReuniao(), 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    listaRef.current?.scrollTo({ top: listaRef.current.scrollHeight });
  }, [segments]);

  // Pontos principais ao vivo: recalcula por tempo, nunca a cada fala.
  useEffect(() => {
    if (!gravandoReuniao || estado !== "recording") return;
    if (!ChromeAiAssistant.suportado()) return;
    const t = setInterval(() => {
      const segs = segsRef.current;
      if (segs.length - pontosEmRef.current < MIN_SEGMENTOS_PONTOS) return;
      setPontosEm(segs.length);
      const texto = textoConversa({ segments: segs });
      new ChromeAiAssistant()
        .pontosPrincipais(texto)
        .then((r) => setPontos(r.trim()))
        .catch(() => {
          /* IA indisponível não pode atrapalhar a gravação */
        });
    }, INTERVALO_PONTOS_MS);
    return () => clearInterval(t);
  }, [gravandoReuniao, estado]);

  async function consultarReuniao() {
    try {
      const r = (await chrome.runtime.sendMessage({ tipo: "reuniao?" })) as
        | EstadoReuniao
        | undefined;
      if (r) setReuniao(r);
    } catch {
      // background reiniciando
    }
  }

  async function recarregarHistorico() {
    setHistorico(await storage.list());
  }

  function abrirPermissaoMic() {
    chrome.tabs.create({ url: chrome.runtime.getURL("permiso.html") });
  }

  async function finalizar(session: Session) {
    await storage.saveSession(session);
    setSessionAtual(session);
    setSegments(session.segments);
    setNivel(0);
    setGravandoReuniao(false);
    await recarregarHistorico();
  }

  /**
   * @param comReuniao captura também o áudio da aba do Meet. O streamId precisa
   * ser pedido aqui, no gesto do clique — o Chrome não libera captura de aba sem
   * ação direta do usuário.
   */
  async function iniciar(comReuniao: boolean) {
    setSegments([]);
    setSessionAtual(null);
    setAviso("");
    setPrecisaMic(false);
    setPontos("");
    setPontosEm(0);
    limparIA();

    let streamId: string | undefined;
    try {
      if (comReuniao) {
        const r = (await chrome.runtime.sendMessage({ tipo: "capturarAba" })) as
          | { streamId?: string; erro?: string }
          | undefined;
        if (r?.erro || !r?.streamId) {
          setAviso(
            `Não foi possível capturar o áudio da reunião: ${r?.erro ?? "sem stream"}. ` +
              "Abra a aba do Meet e tente de novo.",
          );
          return;
        }
        streamId = r.streamId;
      } else {
        await chrome.runtime.sendMessage({ tipo: "prepararOffscreen" });
      }
    } catch (e) {
      setAviso(String(e));
      return;
    }

    setGravandoReuniao(comReuniao);
    enviar({
      tipo: "iniciar",
      opts: {
        origem,
        alvo,
        modelo,
        traduzirAoVivo: aoVivo && ChromeTranslator.suportado(),
        streamId,
      },
    });
  }

  function exportar(fmt: "srt" | "txt" | "json") {
    const s = sessionAtual;
    if (!s) return;
    const base = `conversa-${new Date(s.criadoEm).toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
    if (fmt === "srt") baixar(`${base}.srt`, paraSrt(s, { traduzido: true }), "text/plain");
    if (fmt === "txt") baixar(`${base}.txt`, paraTxt(s), "text/plain");
    if (fmt === "json") baixar(`${base}.json`, paraJson(s), "application/json");
  }

  async function rodarIA(
    titulo: string,
    fn: (a: ChromeAiAssistant) => Promise<string>,
  ) {
    if (!sessionAtual) return;
    setIaRodando(true);
    setIaTitulo(titulo);
    setIaResultado("");
    setIaStatus("Preparando IA on-device…");
    try {
      const assistente = new ChromeAiAssistant(setIaStatus);
      const r = await fn(assistente);
      setIaResultado(r.trim());
    } catch (e) {
      setIaResultado("");
      setAviso(String(e));
    } finally {
      setIaStatus("");
      setIaRodando(false);
    }
  }

  const resumir = () =>
    rodarIA("Resumo", (a) => a.resumir(textoConversa(sessionAtual!)));
  const itensAcao = () =>
    rodarIA("Itens de ação", (a) => a.itensDeAcao(textoConversa(sessionAtual!)));
  const corrigir = () =>
    rodarIA("Transcrição corrigida", (a) =>
      a.corrigir(textoConversa(sessionAtual!)),
    );
  const perguntar = () => {
    const q = pergunta.trim();
    if (!q) return;
    void rodarIA(`Pergunta: ${q}`, (a) =>
      a.perguntar(textoConversa(sessionAtual!), q),
    );
  };

  function limparIA() {
    setIaResultado("");
    setIaTitulo("");
    setIaStatus("");
    setPergunta("");
  }

  async function abrirDoHistorico(id: string) {
    limparIA();
    const s = await storage.getSession(id);
    if (!s) return;
    setSessionAtual(s);
    setSegments(s.segments);
    setEstado("done");
  }

  const gravando = estado === "recording";
  const pausado = estado === "paused";
  const ativo = gravando || pausado || estado === "finalizing";

  return (
    <div className="app">
      <header>
        <h1>🎙️ Recorder + Translator</h1>
        <p className="sub">Grava conversas e reuniões — tudo offline no dispositivo.</p>
      </header>

      {reuniao.emReuniao && !ativo && (
        <section className="reuniao">
          <strong>📹 Reunião do Meet detectada</strong>
          {reuniao.titulo && <span className="titulo">{reuniao.titulo}</span>}
          <button className="rec" onClick={() => iniciar(true)}>
            ● Gravar reunião
          </button>
          <p className="dica">
            Grava sua voz e a dos participantes, separando quem falou.
          </p>
          {reuniao.semLeitura && (
            <p className="aviso">
              Não consegui ler os nomes dos participantes (o Meet mudou de
              layout). A gravação funciona normalmente — as falas aparecerão como
              “Participante 1, 2, 3…”.
            </p>
          )}
        </section>
      )}

      <section className="config" aria-disabled={ativo}>
        <label>
          Idioma falado
          <select value={origem} onChange={(e) => setOrigem(e.target.value)} disabled={ativo}>
            {IDIOMAS_COMUNS.map((i) => (
              <option key={i.codigo} value={i.codigo}>{i.nome}</option>
            ))}
          </select>
        </label>
        <label>
          Traduzir para
          <select value={alvo} onChange={(e) => setAlvo(e.target.value)} disabled={ativo}>
            {IDIOMAS_COMUNS.map((i) => (
              <option key={i.codigo} value={i.codigo}>{i.nome}</option>
            ))}
          </select>
        </label>
        <label>
          Modelo
          <select value={modelo} onChange={(e) => setModelo(e.target.value)} disabled={ativo}>
            {MODELOS.map((m) => (
              <option key={m.id} value={m.id}>{m.nome}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={aoVivo} onChange={(e) => setAoVivo(e.target.checked)} disabled={ativo} />
          Traduzir ao vivo
        </label>
      </section>

      <section className="controls">
        {!ativo && (
          <button className="rec" onClick={() => iniciar(false)}>
            ● Gravar {reuniao.emReuniao ? "só meu microfone" : ""}
          </button>
        )}
        {gravando && (
          <button onClick={() => enviar({ tipo: "pausar" })}>⏸ Pausar</button>
        )}
        {pausado && (
          <button onClick={() => enviar({ tipo: "retomar" })}>▶ Retomar</button>
        )}
        {ativo && (
          <button className="stop" onClick={() => enviar({ tipo: "parar" })}>⏹ Parar</button>
        )}
        {ativo && (
          <div className="meter" title="nível do microfone">
            <div className="bar" style={{ width: `${Math.min(100, nivel * 300)}%` }} />
          </div>
        )}
      </section>

      {statusModelo && <p className="status">{statusModelo}</p>}
      {statusTrad && <p className="status">{statusTrad}</p>}
      {aviso && <p className="aviso">{aviso}</p>}
      {precisaMic && (
        <button onClick={abrirPermissaoMic}>Liberar microfone numa aba…</button>
      )}

      {gravandoReuniao && ativo && pontos && (
        <section className="pontos">
          <h2>✨ Pontos principais (até agora)</h2>
          <pre>{pontos}</pre>
        </section>
      )}

      <section className="transcript" ref={listaRef}>
        {segments.length === 0 && !ativo && (
          <p className="vazio">Aperte “Gravar” e comece a falar. A transcrição aparece aqui.</p>
        )}
        {segments.map((s) => (
          <div className="seg" key={s.id}>
            {s.falante && <span className="falante">{s.falante.nome}</span>}
            <span className="orig">{s.textoOrig}</span>
            {s.textoTrad && <span className="trad">{s.textoTrad}</span>}
          </div>
        ))}
      </section>

      {sessionAtual && !ativo && (
        <section className="export">
          <span>Exportar:</span>
          <button onClick={() => exportar("srt")}>.srt</button>
          <button onClick={() => exportar("txt")}>.txt</button>
          <button onClick={() => exportar("json")}>.json</button>
        </section>
      )}

      {sessionAtual && !ativo && sessionAtual.segments.length > 0 && (
        <section className="ia">
          <h2>🤖 IA (on-device)</h2>
          {!ChromeAiAssistant.suportado() ? (
            <p className="aviso">
              IA on-device indisponível — requer Chrome 138+ com o Prompt API
              (Gemini Nano) habilitado.
            </p>
          ) : (
            <>
              <div className="ia-botoes">
                <button onClick={resumir} disabled={iaRodando}>Resumir</button>
                <button onClick={itensAcao} disabled={iaRodando}>Itens de ação</button>
                <button onClick={corrigir} disabled={iaRodando}>Corrigir transcrição</button>
              </div>
              <div className="ia-pergunta">
                <input
                  type="text"
                  placeholder="Pergunte sobre a conversa…"
                  value={pergunta}
                  onChange={(e) => setPergunta(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && perguntar()}
                  disabled={iaRodando}
                />
                <button onClick={perguntar} disabled={iaRodando || !pergunta.trim()}>
                  Perguntar
                </button>
              </div>
              {iaStatus && <p className="status">{iaStatus}</p>}
              {iaResultado && (
                <div className="ia-saida">
                  <strong>{iaTitulo}</strong>
                  <pre>{iaResultado}</pre>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {historico.length > 0 && (
        <section className="historico">
          <h2>Gravações salvas</h2>
          <ul>
            {historico.map((h) => (
              <li key={h.id}>
                <button onClick={() => abrirDoHistorico(h.id)}>
                  {new Date(h.criadoEm).toLocaleString("pt-BR")} · {h.totalSegmentos} trechos
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  IDIOMAS_COMUNS,
  Pipeline,
  paraJson,
  paraSrt,
  paraTxt,
  transcreverPendentes,
  type Idioma,
  type ProgressoTranscricao,
  type Segment,
  type Session,
} from "@rt/core";
import {
  GetUserMediaCapture,
  IndexedDbDeposito,
  IndexedDbStorage,
  WhisperTranscriber,
} from "@rt/web";
import { baixar } from "./download.js";

type Estado = "idle" | "gravando" | "pausado" | "transcrevendo" | "pronto";

/**
 * No celular o Whisper é bem mais lento que no desktop, então `tiny` é o padrão.
 * `base` fica disponível para quem topar esperar mais em troca de precisão.
 */
const MODELOS = [
  { id: "Xenova/whisper-tiny", nome: "Rápido (recomendado no celular)" },
  { id: "Xenova/whisper-base", nome: "Preciso (bem mais lento)" },
];

const storage = new IndexedDbStorage();
const deposito = new IndexedDbDeposito();

/** URLs dos assets locais, respeitando o `base` do GitHub Pages. */
const WORKLET_URL = new URL("capture-worklet.js", import.meta.env.BASE_URL).href;
const ORT_BASE = new URL("ort/", import.meta.env.BASE_URL).href;

function duracao(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function mensagemErro(e: unknown): string {
  const nome = e instanceof Error ? e.name : "";
  if (nome === "NotAllowedError") {
    return "Permissão de microfone negada. Libere o microfone para este site nas configurações do navegador e tente de novo.";
  }
  if (nome === "NotFoundError") {
    return "Nenhum microfone encontrado.";
  }
  return String(e);
}

export function App() {
  const [origem, setOrigem] = useState<Idioma>("pt");
  const [modelo, setModelo] = useState(MODELOS[0]!.id);

  const [estado, setEstado] = useState<Estado>("idle");
  const [falas, setFalas] = useState(0);
  const [nivel, setNivel] = useState(0);
  const [decorrido, setDecorrido] = useState(0);
  const [progresso, setProgresso] = useState<ProgressoTranscricao | null>(null);
  const [statusModelo, setStatusModelo] = useState("");
  const [aviso, setAviso] = useState("");

  const [segments, setSegments] = useState<Segment[]>([]);
  const [sessionAtual, setSessionAtual] = useState<Session | null>(null);
  const [historico, setHistorico] = useState<
    Awaited<ReturnType<typeof storage.list>>
  >([]);

  const pipeRef = useRef<Pipeline | null>(null);
  const inicioRef = useRef(0);

  useEffect(() => {
    void recarregarHistorico();
  }, []);

  // cronômetro da gravação
  useEffect(() => {
    if (estado !== "gravando") return;
    const t = setInterval(
      () => setDecorrido(Date.now() - inicioRef.current),
      500,
    );
    return () => clearInterval(t);
  }, [estado]);

  async function recarregarHistorico() {
    setHistorico(await storage.list());
  }

  async function iniciar() {
    setAviso("");
    setSegments([]);
    setSessionAtual(null);
    setFalas(0);
    setProgresso(null);
    setDecorrido(0);

    const capture = new GetUserMediaCapture(WORKLET_URL);
    capture.onLevel(setNivel);

    // Modo "depois": durante a gravação só arquivamos o áudio. Transcrever ao
    // vivo no celular acumularia fila sem fim — o Whisper em WASM não acompanha
    // a fala num processador de telefone.
    const pipe = new Pipeline(
      {
        capture,
        transcriber: {
          transcribe: async () => [], // não usado no modo "depois"
        },
        translator: {
          ready: async () => {},
          translate: async (t) => t, // sem tradução no celular (Gemini Nano é só desktop)
        },
        idiomaOrig: origem,
        idiomaAlvo: origem,
        modo: "depois",
        deposito,
      },
      {
        onFalaGravada: setFalas,
        onErro: (e) => setAviso(mensagemErro(e)),
      },
    );
    pipeRef.current = pipe;

    try {
      inicioRef.current = Date.now();
      await pipe.start();
      setEstado("gravando");
    } catch (e) {
      setAviso(mensagemErro(e));
      setEstado("idle");
    }
  }

  async function parar() {
    const pipe = pipeRef.current;
    if (!pipe) return;
    setNivel(0);
    const session = await pipe.stop();
    setEstado("transcrevendo");
    setStatusModelo("Carregando modelo de transcrição…");

    const transcriber = new WhisperTranscriber({
      modelId: modelo,
      ortBase: ORT_BASE,
      worker: new Worker(new URL("@rt/web/whisper.worker", import.meta.url), {
        type: "module",
      }),
    });

    try {
      await transcriber.whenReady();
      setStatusModelo("");
      await transcreverPendentes(session, transcriber, deposito, {
        onProgresso: setProgresso,
      });
      await storage.saveSession(session);
      setSessionAtual(session);
      setSegments(session.segments);
      await recarregarHistorico();
      setEstado("pronto");
    } catch (e) {
      setAviso(mensagemErro(e));
      setEstado("idle");
    } finally {
      setStatusModelo("");
      setProgresso(null);
      await transcriber.dispose();
    }
  }

  function exportar(fmt: "srt" | "txt" | "json") {
    const s = sessionAtual;
    if (!s) return;
    const base = `conversa-${new Date(s.criadoEm).toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
    if (fmt === "srt") baixar(`${base}.srt`, paraSrt(s), "text/plain");
    if (fmt === "txt") baixar(`${base}.txt`, paraTxt(s), "text/plain");
    if (fmt === "json") baixar(`${base}.json`, paraJson(s), "application/json");
  }

  async function abrirDoHistorico(id: string) {
    const s = await storage.getSession(id);
    if (!s) return;
    setSessionAtual(s);
    setSegments(s.segments);
    setEstado("pronto");
  }

  const gravando = estado === "gravando";
  const pausado = estado === "pausado";
  const ativo = gravando || pausado;
  const ocupado = estado === "transcrevendo";
  const pct = progresso?.total
    ? Math.round((progresso.feitas / progresso.total) * 100)
    : 0;

  return (
    <div className="app">
      <header>
        <h1>🎙️ Recorder</h1>
        <p className="sub">Grava e transcreve no próprio aparelho, sem internet.</p>
      </header>

      {!ativo && !ocupado && (
        <section className="config">
          <label>
            Idioma falado
            <select
              value={origem}
              onChange={(e) => setOrigem(e.target.value)}
            >
              {IDIOMAS_COMUNS.map((i) => (
                <option key={i.codigo} value={i.codigo}>
                  {i.nome}
                </option>
              ))}
            </select>
          </label>
          <label>
            Qualidade
            <select value={modelo} onChange={(e) => setModelo(e.target.value)}>
              {MODELOS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}

      <section className="controls">
        {!ativo && !ocupado && (
          <button className="rec" onClick={iniciar}>
            ● Gravar
          </button>
        )}
        {gravando && (
          <>
            <button
              onClick={() => {
                pipeRef.current?.pause();
                setEstado("pausado");
              }}
            >
              ⏸
            </button>
            <button className="stop" onClick={parar}>
              ⏹ Parar
            </button>
          </>
        )}
        {pausado && (
          <>
            <button
              onClick={() => {
                pipeRef.current?.resume();
                setEstado("gravando");
              }}
            >
              ▶
            </button>
            <button className="stop" onClick={parar}>
              ⏹ Parar
            </button>
          </>
        )}
      </section>

      {ativo && (
        <section className="gravando">
          <div className="tempo">{duracao(decorrido)}</div>
          <div className="meter">
            <div
              className="bar"
              style={{ width: `${Math.min(100, nivel * 300)}%` }}
            />
          </div>
          <p className="dica">
            {falas} trecho{falas === 1 ? "" : "s"} capturado{falas === 1 ? "" : "s"} ·
            a transcrição começa quando você parar
          </p>
        </section>
      )}

      {ocupado && (
        <section className="progresso">
          <strong>Transcrevendo…</strong>
          {statusModelo && <p className="status">{statusModelo}</p>}
          {progresso && (
            <>
              <div className="meter">
                <div className="bar azul" style={{ width: `${pct}%` }} />
              </div>
              <p className="dica">
                {progresso.feitas} de {progresso.total} trechos ({pct}%)
              </p>
            </>
          )}
          <p className="dica">
            Pode demorar alguns minutos. Mantenha o app aberto.
          </p>
        </section>
      )}

      {aviso && <p className="aviso">{aviso}</p>}

      {segments.length > 0 && (
        <section className="transcript">
          {segments.map((s) => (
            <div className="seg" key={s.id}>
              {s.textoOrig}
            </div>
          ))}
        </section>
      )}

      {sessionAtual && !ativo && !ocupado && (
        <section className="export">
          <span>Exportar:</span>
          <button onClick={() => exportar("txt")}>.txt</button>
          <button onClick={() => exportar("srt")}>.srt</button>
          <button onClick={() => exportar("json")}>.json</button>
        </section>
      )}

      {historico.length > 0 && !ativo && !ocupado && (
        <section className="historico">
          <h2>Gravações salvas</h2>
          <ul>
            {historico.map((h) => (
              <li key={h.id}>
                <button onClick={() => abrirDoHistorico(h.id)}>
                  {new Date(h.criadoEm).toLocaleString("pt-BR")} ·{" "}
                  {duracao(h.duracaoMs)} · {h.totalSegmentos} trechos
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

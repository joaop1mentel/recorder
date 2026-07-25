/// <reference lib="webworker" />
import { pipeline, env } from "@huggingface/transformers";

/**
 * Worker do Whisper (transformers.js), compartilhado pela extensão e pelo PWA.
 *
 * O caminho do runtime onnxruntime vem na mensagem `init` (`ortBase`): cada app
 * o serve de um lugar diferente, e derivar isso de `self.location` aqui dentro
 * quebraria assim que o layout de saída de um dos builds mudasse.
 */

type SaidaAsr = { text?: string } | Array<{ text?: string }>;
type AsrFn = (
  audio: Float32Array,
  opts?: { language?: string; task?: string },
) => Promise<SaidaAsr>;

let asr: Promise<AsrFn> | null = null;
let modelId = "Xenova/whisper-base";
let ortConfigurado = false;

function configurarOrt(ortBase: string): void {
  if (ortConfigurado) return;
  const wasm = env.backends?.onnx?.wasm as
    | { wasmPaths?: string; numThreads?: number; proxy?: boolean }
    | undefined;
  if (wasm) {
    wasm.wasmPaths = ortBase;
    // single-thread: dispensa SharedArrayBuffer/cross-origin isolation, o que
    // é obrigatório no GitHub Pages (não dá para configurar cabeçalhos lá).
    wasm.numThreads = 1;
  }
  // Modelos vêm do CDN do Hugging Face na 1ª vez e ficam no cache do navegador
  // (offline a partir daí). Não usamos arquivos locais.
  env.allowLocalModels = false;
  ortConfigurado = true;
}

function getAsr(): Promise<AsrFn> {
  if (!asr) {
    asr = pipeline(
      "automatic-speech-recognition",
      modelId,
    ) as unknown as Promise<AsrFn>;
  }
  return asr;
}

interface MsgIn {
  id: number;
  type: "init" | "transcribe";
  payload: {
    modelId?: string;
    ortBase?: string;
    pcm?: Float32Array;
    language?: string;
  };
}

self.onmessage = async (e: MessageEvent<MsgIn>) => {
  const { id, type, payload } = e.data;
  try {
    if (type === "init") {
      if (payload.ortBase) configurarOrt(payload.ortBase);
      if (payload.modelId && payload.modelId !== modelId) {
        modelId = payload.modelId;
        asr = null; // troca de modelo
      }
      await getAsr();
      (self as unknown as Worker).postMessage({ id, ok: true });
      return;
    }
    if (type === "transcribe") {
      const model = await getAsr();
      const out = await model(payload.pcm!, {
        language: payload.language,
        task: "transcribe",
      });
      const text = Array.isArray(out)
        ? out.map((o) => o.text ?? "").join(" ")
        : (out.text ?? "");
      (self as unknown as Worker).postMessage({ id, ok: true, text: text.trim() });
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      ok: false,
      error: String(err),
    });
  }
};

/// <reference lib="webworker" />
import { pipeline, env } from "@huggingface/transformers";
import { detectarWebGPU } from "./webgpu.js";

/**
 * Worker do Whisper (transformers.js), compartilhado pela extensão e pelo PWA.
 *
 * O caminho do runtime onnxruntime vem na mensagem `init` (`ortBase`): cada app
 * o serve de um lugar diferente, e derivar isso de `self.location` aqui dentro
 * quebraria assim que o layout de saída de um dos builds mudasse.
 */

/** Um trecho com tempo, como o Whisper devolve quando `return_timestamps` está ligado. */
export interface TrechoAsr {
  /** [início, fim] em SEGUNDOS, relativos ao áudio enviado; o fim pode vir nulo */
  timestamp: [number, number | null];
  text: string;
}
type SaidaAsr = { text?: string; chunks?: TrechoAsr[] };
type AsrFn = (
  audio: Float32Array,
  opts?: Record<string, unknown>,
) => Promise<SaidaAsr | SaidaAsr[]>;

let asr: Promise<AsrFn> | null = null;
let modelId = "Xenova/whisper-base";
let ortConfigurado = false;

/**
 * WebGPU dá de 5 a 10x sobre o WASM no Whisper, mas forçar `device: "webgpu"`
 * quando o adaptador não existe de verdade não falha alto: o transformers.js
 * tenta montar a sessão em WebGPU, não consegue, e só então cai para WASM —
 * mais lento que já pedir WASM de cara. `detectarWebGPU()` faz a checagem real
 * (não só `"gpu" in navigator`); cacheamos porque o resultado não muda durante
 * a vida do worker.
 */
let webgpuChecado: Promise<boolean> | null = null;
function temWebGPU(): Promise<boolean> {
  if (!webgpuChecado) webgpuChecado = detectarWebGPU();
  return webgpuChecado;
}

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

async function getAsr(): Promise<AsrFn> {
  if (!asr) {
    asr = pipeline("automatic-speech-recognition", modelId, {
      device: (await temWebGPU()) ? "webgpu" : "wasm",
      /**
       * Quantização híbrida: encoder em fp32, decoder em q4.
       *
       * O padrão do WASM é q8 em tudo, e é ruim aqui: o ruído de quantização no
       * encoder se propaga por todo o decoder e piora a transcrição. Esta é a
       * combinação usada pelo whisper-web (do autor do transformers.js) — mais
       * precisa E menor que o q8 completo.
       */
      dtype: {
        encoder_model: "fp32",
        decoder_model_merged: "q4",
      },
    } as Parameters<typeof pipeline>[2]) as unknown as Promise<AsrFn>;
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
      // devolve o device para a UI poder explicar a lentidão em vez de deixar
      // o usuário no escuro achando que o app é ruim
      (self as unknown as Worker).postMessage({
        id,
        ok: true,
        device: (await temWebGPU()) ? "webgpu" : "wasm",
      });
      return;
    }
    if (type === "transcribe") {
      const model = await getAsr();
      const out = await model(payload.pcm!, {
        language: payload.language,
        task: "transcribe",
        // Janela de 30s com 5s de sobreposição: é o formato em que o Whisper foi
        // treinado, e o stride evita perder palavras na emenda entre janelas.
        chunk_length_s: 30,
        stride_length_s: 5,
        // timestamps permitem quebrar a janela de volta em linhas curtas
        return_timestamps: true,
        force_full_sequences: false,
        // decodificação gulosa: determinística e mais rápida
        top_k: 0,
        do_sample: false,
        // O decodificador guloso às vezes trava num loop e repete a mesma
        // palavra/frase até o fim da janela (ex.: "tá, tá, tá, ..." dezenas de
        // vezes) — sintoma clássico do Whisper em trechos com pouco sinal.
        // Proibir repetir a mesma sequência de 3 tokens elimina o loop sem
        // atrapalhar fala normal (repetição idêntica de 3+ palavras seguidas
        // é rara em transcrição real).
        no_repeat_ngram_size: 3,
      });
      const saida = Array.isArray(out) ? out[0] : out;
      (self as unknown as Worker).postMessage({
        id,
        ok: true,
        text: (saida?.text ?? "").trim(),
        chunks: saida?.chunks ?? null,
      });
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      ok: false,
      error: String(err),
    });
  }
};

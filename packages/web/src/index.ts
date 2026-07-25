// Adapters de navegador compartilhados pela extensão (desktop) e pelo PWA (celular).
// O worker do Whisper NÃO é reexportado aqui: cada app precisa instanciá-lo com
// `new Worker(new URL("@rt/web/whisper.worker", import.meta.url), { type: "module" })`
// para o bundler conseguir resolvê-lo.
export { GetUserMediaCapture, SR_ALVO } from "./getUserMediaCapture.js";
export { WhisperTranscriber, type WhisperOpts } from "./whisperTranscriber.js";
export { IndexedDbStorage, IndexedDbDeposito } from "./indexedDbStorage.js";

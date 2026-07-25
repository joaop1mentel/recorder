// AudioWorklet de captura: encaminha cada quantum de áudio (Float32) para a
// thread principal, sem qualquer processamento.
//
// Precisa ser um ARQUIVO REAL servido pelo próprio app (origem 'self'): a CSP do
// Manifest V3 bloqueia carregar worklet via blob:. Por isso ele vive aqui e é
// copiado para o `public/` de cada app pelo script `copy-assets.mjs`.
//
// É agnóstico de taxa de amostragem de propósito — quem reamostra (por causa dos
// 48 kHz fixos do iPhone) é o GetUserMediaCapture, na thread principal.
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("capture-processor", CaptureProcessor);

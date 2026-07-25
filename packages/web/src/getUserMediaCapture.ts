import {
  SegmentadorVAD,
  reamostrar,
  rms,
  type AudioCapture,
  type AudioChunk,
  type FonteAudio,
} from "@rt/core";

/** Taxa que o Whisper espera. */
export const SR_ALVO = 16000;
/** 100 ms por frame para o VAD (a 16 kHz). */
const FRAME = 1600;

/**
 * Captura do microfone via getUserMedia + AudioWorklet.
 *
 * ⚠️ **Não force `sampleRate` no AudioContext.** O iPhone amostra a 48 kHz e o
 * Safari ignora o pedido de 16 kHz: o áudio viria em 48 kHz rotulado como 16 kHz
 * e o Whisper devolveria texto embaralhado. Em vez disso lemos a taxa real do
 * contexto e reamostramos aqui, entregando sempre 16 kHz ao VAD e ao Whisper.
 */
export class GetUserMediaCapture implements AudioCapture {
  readonly fonte: FonteAudio = "mic";

  protected ctx?: AudioContext;
  protected stream?: MediaStream;
  protected node?: AudioWorkletNode;
  protected source?: MediaStreamAudioSourceNode;
  private vad = new SegmentadorVAD({ sampleRate: SR_ALVO });
  private chunkCb: (c: AudioChunk) => void = () => {};
  private levelCb?: (rms: number) => void;
  private t0 = 0;
  private acc: number[] = [];
  /** taxa real do hardware, descoberta só depois de abrir o contexto */
  private srEntrada = SR_ALVO;

  /**
   * @param workletUrl URL do `capture-worklet.js`. Vem de fora porque cada app
   * o serve de um lugar (extensão: `chrome.runtime.getURL`; PWA: caminho público).
   */
  constructor(protected readonly workletUrl: string) {}

  onChunk(cb: (c: AudioChunk) => void): void {
    this.chunkCb = cb;
  }
  onLevel(cb: (rms: number) => void): void {
    this.levelCb = cb;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    await this.montarGrafo(this.stream);
  }

  /** Monta AudioContext + worklet sobre um stream já obtido. */
  protected async montarGrafo(stream: MediaStream): Promise<void> {
    this.ctx = new AudioContext();
    this.srEntrada = this.ctx.sampleRate;
    await this.ctx.audioWorklet.addModule(this.workletUrl);
    this.source = this.ctx.createMediaStreamSource(stream);
    this.node = new AudioWorkletNode(this.ctx, "capture-processor");
    this.node.port.onmessage = (e: MessageEvent) =>
      this.onFrame(e.data as Float32Array);
    this.source.connect(this.node);
    // não conectamos ao destino: é só captura, não queremos ecoar no alto-falante
    this.t0 = performance.now();
  }

  async stop(): Promise<void> {
    const tail = this.vad.flush();
    if (tail) this.chunkCb({ pcm: tail.pcm, sampleRate: SR_ALVO, t0: tail.t0 });
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node?.port.close();
    await this.ctx?.close();
    this.acc = [];
  }

  private onFrame(quantum: Float32Array): void {
    // reamostra logo na entrada: daqui para a frente tudo é 16 kHz
    const em16k = reamostrar(quantum, this.srEntrada, SR_ALVO);
    for (let i = 0; i < em16k.length; i++) this.acc.push(em16k[i]!);
    while (this.acc.length >= FRAME) {
      const frame = Float32Array.from(this.acc.splice(0, FRAME));
      const tMs = performance.now() - this.t0;
      this.levelCb?.(rms(frame));
      for (const u of this.vad.push(frame, tMs)) {
        this.chunkCb({ pcm: u.pcm, sampleRate: SR_ALVO, t0: u.t0 });
      }
    }
  }
}

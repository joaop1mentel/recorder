import { GetUserMediaCapture } from "@rt/web";
import type { FonteAudio } from "@rt/core";

/**
 * Captura o áudio DA ABA (as vozes dos outros participantes da reunião), a
 * partir de um streamId obtido com `chrome.tabCapture.getMediaStreamId()`.
 *
 * Reusa toda a montagem do grafo de áudio do `GetUserMediaCapture` (worklet,
 * reamostragem, VAD); só troca a origem do stream e reconecta a saída.
 */
export class TabCapture extends GetUserMediaCapture {
  override readonly fonte: FonteAudio = "aba";

  constructor(
    workletUrl: string,
    private readonly streamId: string,
  ) {
    super(workletUrl);
  }

  override async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: this.streamId,
        },
      },
      // getUserMedia com constraints do Chrome não é o tipo padrão do TS
    } as unknown as MediaStreamConstraints);

    await this.montarGrafo(this.stream);

    // ⚠️ Devolve o som para os alto-falantes. Ao contrário da captura de
    // microfone (onde conectar ao destino causaria eco), aqui é obrigatório: o
    // tabCapture ROUBA o áudio da aba, e sem esta linha o usuário fica sem
    // ouvir a própria reunião. É o erro nº 1 de quem usa essa API.
    if (this.ctx && this.source) this.source.connect(this.ctx.destination);
  }
}

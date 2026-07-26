/** Gera um id único. Usa a Web Crypto API, presente em navegadores e no Node 20+. */
export function novoId(): string {
  return globalThis.crypto.randomUUID();
}

/** Concatena vários blocos PCM mono num único Float32Array. */
export function concatPcm(blocos: Float32Array[]): Float32Array {
  let total = 0;
  for (const b of blocos) total += b.length;
  const out = new Float32Array(total);
  let off = 0;
  for (const b of blocos) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

/**
 * PCM float32 (-1..1) → int16. Metade do tamanho, com perda inaudível para voz.
 * Usado ao guardar áudio no disco durante a gravação: float32 a 16 kHz custa
 * ~3,8 MB por minuto, o que numa gravação longa de celular é proibitivo.
 */
export function paraInt16(pcm: Float32Array): Int16Array {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i]!));
    // assimétrico de propósito: int16 vai de -32768 a 32767
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

/** int16 → PCM float32 (-1..1), o inverso de `paraInt16`. */
export function paraFloat32(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i]!;
    out[i] = v < 0 ? v / 0x8000 : v / 0x7fff;
  }
  return out;
}

/**
 * Reamostra PCM mono por interpolação linear.
 *
 * Existe por causa do iPhone: o hardware amostra a 48 kHz e o Safari ignora
 * `new AudioContext({ sampleRate: 16000 })`. Sem converter, o Whisper receberia
 * o áudio 3x acelerado e devolveria texto embaralhado.
 */
export function reamostrar(
  pcm: Float32Array,
  deSampleRate: number,
  paraSampleRate: number,
): Float32Array {
  if (deSampleRate === paraSampleRate || pcm.length === 0) return pcm;
  const razao = deSampleRate / paraSampleRate;
  const tamanho = Math.floor(pcm.length / razao);
  const out = new Float32Array(tamanho);
  for (let i = 0; i < tamanho; i++) {
    const pos = i * razao;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = pcm[idx] ?? 0;
    const b = pcm[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/**
 * Reamostrador com estado, para uso em stream (um quantum do AudioWorklet por
 * vez, tipicamente 128 amostras).
 *
 * `reamostrar()` sozinha reseta a fase a zero a cada chamada: chamada quantum a
 * quantum, ela descarta a sobra fracionária no fim de cada bloco (até ~2 de
 * cada 3 amostras na conversão 48→16 kHz, repetido a cada ~2,7 ms). O efeito é
 * um leve "engasgo" contínuo no áudio, silencioso nos testes (que só reamostram
 * o buffer inteiro de uma vez) mas audível — e ruim para o Whisper — numa
 * gravação de verdade. Esta versão carrega a fração e as amostras não usadas
 * de uma chamada para a próxima, sem perder nada.
 */
export function criarReamostradorDeFluxo(
  deSampleRate: number,
  paraSampleRate: number,
): (quantum: Float32Array) => Float32Array {
  if (deSampleRate === paraSampleRate) return (q) => q;
  const razao = deSampleRate / paraSampleRate;
  let pendente = new Float32Array(0);
  let posicao = 0;
  return (quantum: Float32Array): Float32Array => {
    const buf = new Float32Array(pendente.length + quantum.length);
    buf.set(pendente, 0);
    buf.set(quantum, pendente.length);
    const out: number[] = [];
    while (true) {
      const idx = Math.floor(posicao);
      if (idx + 1 >= buf.length) break;
      const frac = posicao - idx;
      out.push(buf[idx]! + (buf[idx + 1]! - buf[idx]!) * frac);
      posicao += razao;
    }
    // `posicao` pode passar do fim do buffer atual (quantum não é múltiplo
    // exato da razão): só descontamos o que o buffer atual de fato tinha,
    // guardando o excesso em `posicao` para a próxima chamada em vez de
    // jogá-lo fora.
    const consumido = Math.min(Math.floor(posicao), buf.length);
    pendente = buf.slice(consumido);
    posicao -= consumido;
    return Float32Array.from(out);
  };
}

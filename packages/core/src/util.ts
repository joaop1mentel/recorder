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

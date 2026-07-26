/**
 * `"gpu" in navigator` só diz que a API existe — em vários Android o objeto
 * está presente e mesmo assim `requestAdapter()` devolve `null` (hardware ou
 * driver na denylist do Chrome). Usado tanto pela UI (escolher o modelo
 * padrão e a dica ⚡/🐢) quanto pelo worker do Whisper (escolher o `device` do
 * pipeline) — os dois precisam do mesmo veredito real, não só da presença da
 * API, senão a UI promete GPU que o worker não vai conseguir usar.
 */
export async function detectarWebGPU(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } })
    .gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

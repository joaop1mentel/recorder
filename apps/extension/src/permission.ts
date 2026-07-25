// Página aberta numa aba normal só para conceder a permissão de microfone à
// origem da extensão. Depois disso, o painel lateral usa o mic sem prompt.
const statusEl = document.getElementById("status")!;
const retry = document.getElementById("retry") as HTMLButtonElement;

async function pedir(): Promise<void> {
  statusEl.textContent = "Pedindo permissão do microfone…";
  retry.style.display = "none";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    statusEl.textContent =
      "✅ Microfone liberado! Feche esta aba e volte ao painel lateral — agora o botão Gravar vai funcionar.";
  } catch (e) {
    const nome = e instanceof Error ? e.name : "";
    statusEl.textContent =
      nome === "NotAllowedError"
        ? "❌ Permissão negada. Clique em “Tentar de novo” e escolha Permitir no aviso do Chrome. Se estiver bloqueado, use o ícone de câmera/cadeado na barra de endereço para liberar."
        : `Erro: ${String(e)}`;
    retry.style.display = "inline-block";
  }
}

retry.onclick = pedir;
void pedir();

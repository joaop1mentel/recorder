/** Dispara o download de um arquivo texto gerado no cliente. */
export function baixar(nome: string, conteudo: string, mime = "text/plain"): void {
  const blob = new Blob([conteudo], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

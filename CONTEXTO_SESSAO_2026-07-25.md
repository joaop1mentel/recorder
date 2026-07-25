# Contexto da sessão — 2026-07-25

Handoff desta conversa. O `CONTEXTO.md` tem a visão geral do projeto; este arquivo é o
estado de **hoje**, incluindo um bug em aberto.

---

## 🔴 BUG EM ABERTO — começar por aqui

**Sintoma:** no PWA, ao apertar Parar, dá **"failed to fetch"** na hora de transcrever.
Aconteceu no celular do dono, depois do deploy de hoje que mudou a quantização.

**Hipótese (NÃO confirmada — a verificação foi interrompida):** o `dtype` híbrido que
passei a usar em `packages/web/src/whisper.worker.ts` aponta para arquivos que podem **não
existir** nos repositórios `Xenova/*`:

```ts
dtype: { encoder_model: "fp32", decoder_model_merged: "q4" }
```

Isso faz o transformers.js buscar `onnx/encoder_model.onnx` e
`onnx/decoder_model_merged_q4.onnx`. Os repositórios `Xenova/whisper-*` são antigos e podem
ter só `model.onnx` / `model_quantized.onnx`. Um 404 nesse download aparece exatamente como
"failed to fetch". A referência (whisper-web) usa **`onnx-community/whisper-*`**, que tem a
matriz completa de dtypes — nós usamos `Xenova/*`.

**Como confirmar (5 min):**

1. Listar os arquivos ONNX dos dois repositórios e comparar:
   `https://huggingface.co/api/models/Xenova/whisper-base` (campo `siblings`)
   `https://huggingface.co/api/models/onnx-community/whisper-base`
2. Ou abrir o PWA no desktop, DevTools → aba Network, apertar Parar e ver **qual URL deu
   404**. Este é o caminho mais rápido e direto.

**Correções possíveis, em ordem de preferência:**

- Trocar os ids de modelo para `onnx-community/whisper-base` / `-tiny` (mantém o dtype
  híbrido, que é o que melhora a precisão);
- ou manter `Xenova/*` e remover o `dtype` (volta ao q8 padrão — perde parte do ganho de
  precisão, mas volta a funcionar);
- ou usar `dtype` só quando o device for `webgpu`.

> ⚠️ Não dá para afirmar que as melhorias de precisão desta sessão funcionaram: o dono não
> chegou a ver uma transcrição depois da mudança. **Tudo abaixo está entregue mas não
> validado em runtime.**

---

## O que foi feito nesta sessão

### 1. Fase Meet (extensão) — implementada, não validada

Gravar reuniões do Google Meet: áudio da aba (`chrome.tabCapture`) + microfone em paralelo,
detecção automática da reunião, separação de falantes com nome real e pontos principais ao
vivo (Gemini Nano). O áudio saiu do painel lateral e foi para um **offscreen document**,
para a gravação sobreviver ao fechamento do painel.

**Limite duro do Chrome:** `tabCapture` exige gesto do usuário. Não existe gravação
totalmente automática — a detecção é automática, o start é **um clique**.

**Bug já corrigido no meio da sessão:** a detecção exigia achar o botão de microfone no DOM
além de casar a URL. Numa reunião real o seletor não casou e o recurso não fez nada, sem
erro nem aviso. Agora a detecção é **só pela URL** da sala. Também passou a injetar o
content script em abas do Meet **já abertas** (`content_scripts` só roda em carregamento de
página).

**Estado:** o dono testou uma vez e não viu o selo REC. Depois disso vieram as duas
correções acima, mas **ele não retestou**. Suspeita adicional não descartada: o ícone da
extensão pode não estar **fixado** na barra — se não estiver, o selo fica escondido no menu
🧩 e não há como ver.

Diagnóstico: no console da aba do Meet aparece sempre uma linha
`[recorder] extensão ativa nesta aba · sala detectada: sim/não (/xxx-xxxx-xxx)`.

### 2. `packages/web/` — novo pacote compartilhado

Os adapters de navegador saíram de `apps/extension` e passaram a ser usados pelos dois apps:
captura de microfone, Whisper, IndexedDB, worklet. Dois acoplamentos cortados: a URL do
worklet vem no construtor, e o caminho do ORT vem na mensagem `init` do worker.

### 3. PWA (`apps/pwa/`) — no ar

**https://joaop1mentel.github.io/recorder/** · repo público
**https://github.com/joaop1mentel/recorder** · deploy automático a cada push
(`.github/workflows/deploy-pwa.yml`, roda os testes antes).

Grava e transcreve offline. **Sem tradução e sem IA** no celular — Gemini Nano e Translator
API são só desktop. Transcreve ao **parar**, não ao vivo (o Whisper em WASM não acompanha a
fala num telefone).

### 4. Correções de precisão e velocidade (o motivo do bug acima)

O dono relatou "lento e não entende direito". Comparando com o
[whisper-web](https://github.com/xenova/whisper-web) (do autor do transformers.js), quatro
causas — todas configuração nossa:

| Problema | Correção |
|---|---|
| Mandávamos fragmentos de 250 ms, um a um; o Whisper é treinado em janelas de 30 s e alucina com trechos soltos | `agruparEmJanelas` (`core/src/janelas.ts`) junta falas em janelas de até 30 s |
| Sem `dtype`, o WASM usava q8 em tudo; o ruído no encoder degrada todo o decoder | encoder `fp32` + decoder `q4` ← **suspeito do bug atual** |
| Sem `chunk_length_s`/`stride_length_s`, palavras nas emendas sumiam | 30 s de janela, 5 s de sobreposição |
| WASM de uma thread, ignorando a GPU | WebGPU quando existe (5–10x), queda para WASM |

**Detalhe que não pode ser desfeito por engano:** ao juntar falas numa janela, o **silêncio
entre elas é preservado** (preenchido com zeros). Colar as falas dessincronizaria os
timestamps e quebraria o `.srt`. Há teste cobrindo (`core/test/janelas.test.ts`).

Também: `return_timestamps` mantém o texto em linhas curtas mesmo mandando 30 s por vez; o
VAD parou de emitir fragmentos abaixo de 700 ms; a UI mostra ⚡/🐢 conforme haja GPU.

### 5. Armadilhas já resolvidas (não reintroduzir)

- **`tabCapture` rouba o áudio da aba.** `TabCapture` reconecta o stream em
  `ctx.destination` — sem isso o usuário fica **sem ouvir a reunião**.
- **Nunca forçar `sampleRate` no AudioContext.** O iPhone amostra a 48 kHz e o Safari ignora
  o pedido de 16 kHz; sem reamostrar, o texto sai embaralhado. `reamostrar()` em
  `core/util.ts`.
- **`BASE_URL` do Vite é caminho, não URL.** `new URL(rel, "/recorder/")` lança e derruba o
  app na **tela preta**, sem mensagem. Já custou um deploy. Usar `urlsDeAssets()`
  (`packages/web/src/assets.ts`).
- **O `.wasm` de 21 MB sai duplicado** do build (`ort/` é o usado; `assets/` nunca é
  buscado). O `globIgnores` do Workbox exclui o segundo — sem isso o celular baixa 43 MB.

---

## Estado dos testes

48 testes passando (44 em `@rt/core`, 4 em `@rt/web`), typecheck limpo nos 4 workspaces,
build dos dois apps OK.

**O que os testes NÃO cobrem** (e por que várias coisas quebraram em produção): nada exercita
o app dentro de um navegador. Erros de runtime — tela preta, "failed to fetch", seletor do
Meet — passam por todos os testes. Um smoke test com DOM (jsdom + stub de IndexedDB) seria o
próximo investimento com melhor retorno.

## Próximos passos

1. **Resolver o "failed to fetch"** (topo deste arquivo).
2. Validar a precisão de verdade: gravar o **mesmo** trecho de ~1 min e comparar com o
   resultado antigo. Sem isso não dá para afirmar que melhorou.
3. Retestar o Meet na extensão (recarregar em `chrome://extensions` + **fixar o ícone**).
4. Conferir no iPhone se o texto não sai acelerado (seria a reamostragem falhando).
5. Considerar o smoke test com DOM.

## Ambiente

- `gh` CLI instalado e autenticado como `joaop1mentel`.
- `npm install` na raiz; `npm test`; `npm run build --workspace @rt/pwa|@rt/extension`.
- Testar o PWA localmente: `npm run dev --workspace @rt/pwa -- --host`.

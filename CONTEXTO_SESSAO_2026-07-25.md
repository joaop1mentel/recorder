# Contexto da sessão — 2026-07-25

Handoff desta conversa. O `CONTEXTO.md` tem a visão geral do projeto; este arquivo é o
estado de **hoje**.

---

## ✅ BUG RESOLVIDO (era 🔴 em aberto) — "failed to fetch" ao transcrever no PWA

**Sintoma:** no PWA, ao apertar Parar, dava "failed to fetch" na hora de transcrever.

**Hipótese antiga (descartada nesta sessão):** achávamos que era o `dtype` híbrido
(`fp32`/`q4`) apontando para arquivos ONNX inexistentes em `Xenova/*`. **Verificado e
falso**: confirmei via `https://huggingface.co/api/models/Xenova/whisper-tiny` (e `-base`)
que `onnx/encoder_model.onnx` e `onnx/decoder_model_merged_q4.onnx` existem nos dois
repositórios, e via `curl -IL` que ambos respondem 200 com
`access-control-allow-origin: *`.

**Causa real:** os URLs `resolve/main/onnx/*.onnx` da Hugging Face respondem com **302**
para a CDN (`cdn-lfs.huggingface.co`). O `runtimeCaching` do Workbox em
`apps/pwa/vite.config.ts` (estratégia `CacheFirst` para `huggingface.co/.*`) tentava
`cache.put()` dessa resposta já seguida (`response.redirected === true`). O Cache API do
navegador **recusa** isso com `TypeError: Response served by service worker is
redirected` — que aparece na página como "failed to fetch". É um problema documentado do
Workbox (GoogleChrome/workbox#1481). Só apareceu agora porque os arquivos do dtype
híbrido são URLs novas, nunca cacheadas antes — primeira vez que esse caminho foi
exercitado.

**Fix aplicado:** plugin `cacheWillUpdate` na entrada `runtimeCaching` de
`modelos-whisper` (`apps/pwa/vite.config.ts`) que reconstrói a `Response` via
`response.blob()` + `new Response(...)` antes de deixar o Workbox cachear, removendo a
flag de redirect. Confirmado no `dist/sw.js` gerado: o `cacheWillUpdate` aparece
serializado na rota. `npm test` (48/48) e `npm run build --workspace @rt/pwa` passam.

> ⚠️ Ainda falta validação em runtime real (celular do dono). O tipo de bug que este
> projeto mais sofre é exatamente esse: passa por todos os testes automatizados e só
> quebra dentro de um navegador de verdade.

---

## ✅ SEGUNDO BUG RESOLVIDO — transcrição lenta e errada no celular

Depois do fix acima o "failed to fetch" sumiu (o dono conseguiu ver uma transcrição), mas
ela veio **lenta e errada** ("lê tudo errado"). Dois problemas encontrados no código, os
dois sem teste cobrindo o caminho real de uso:

**1) Reamostragem 48→16 kHz perdia amostra a cada quantum do AudioWorklet — causa mais
provável do texto errado.** `reamostrar()` (`packages/core/src/util.ts`) é stateless: cada
chamada zera a fase em `pos = 0`. Só que `GetUserMediaCapture.onFrame`
(`packages/web/src/getUserMediaCapture.ts`) chamava ela **quantum a quantum** (128 amostras
por vez, como o AudioWorklet entrega) em vez de no buffer inteiro. A cada quantum, a sobra
fracionária do fim do bloco (até ~1 amostra de 3 na conversão 48→16 kHz, repetido a cada
~2,7 ms) era descartada em vez de carregada para o próximo — um engasgo contínuo e
silencioso no áudio antes mesmo de chegar no Whisper. **Novo:**
`criarReamostradorDeFluxo()` em `util.ts`, com estado (carrega fração + amostras não usadas
entre chamadas), usado agora em `GetUserMediaCapture`. Teste novo em
`transcreverDepois.test.ts` prova que processar em quanta pequenos dá o mesmo resultado que
reamostrar o buffer inteiro de uma vez (o teste antigo só cobria o buffer inteiro, por isso
não pegou isso).

**2) Detecção de GPU só checava presença da API, não se ela funciona de verdade — causa
provável da lentidão.** `"gpu" in navigator` (em `App.tsx` e no `whisper.worker.ts`) é
`true` em vários Android mesmo quando `requestAdapter()` devolve `null` (hardware/driver na
denylist do Chrome). Isso fazia o app escolher o modelo `base` (mais pesado) e forçar
`device: "webgpu"`, que falha ao montar a sessão e só então cai para WASM — mais lento que
já pedir WASM/tiny de cara. **Novo:** `detectarWebGPU()` (`packages/web/src/webgpu.ts`) faz
a checagem real (`requestAdapter()`), usada nos dois lugares; o PWA agora baixa para
`whisper-tiny` automaticamente se a checagem real vier negativa mesmo com a API presente.

`npm test` (46+4), typecheck e build dos dois apps (`@rt/pwa`, `@rt/extension`) passam.

> ⚠️ Também não validado em runtime real ainda — mesmo aviso de sempre.

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

1. **Validar em runtime que o "failed to fetch" sumiu** (fix já aplicado, precisa
   deploy + teste real no celular ou DevTools).
2. Validar a precisão de verdade: gravar o **mesmo** trecho de ~1 min e comparar com o
   resultado antigo. Sem isso não dá para afirmar que melhorou.
3. Retestar o Meet na extensão (recarregar em `chrome://extensions` + **fixar o ícone**).
4. Conferir no iPhone se o texto não sai acelerado (seria a reamostragem falhando).
5. Considerar o smoke test com DOM.

## Ambiente

- `gh` CLI instalado e autenticado como `joaop1mentel`.
- `npm install` na raiz; `npm test`; `npm run build --workspace @rt/pwa|@rt/extension`.
- Testar o PWA localmente: `npm run dev --workspace @rt/pwa -- --host`.

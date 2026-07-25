# Contexto do projeto — Recorder + Translator

Handoff desta conversa (2026-07-23). Leia isto primeiro ao retomar.

## O que é

App para **gravar conversas presenciais** (microfone) e **transcrever + traduzir
offline no dispositivo** — inspirado no Tactiq, mas para **celular** e **extensão
de navegador**. Decisões do dono:

- Plataformas: extensão web **e** app de celular (em paralelo).
- Captura: conversas **presenciais** (microfone).
- Motor: transcrição e tradução **offline, on-device** (privado, grátis, sem internet).
- Timing: legenda **ao vivo** e transcrição completa **depois**.
- IA: **on-device** (Gemini Nano via Chrome), todas as funções.

## Arquitetura (monorepo npm workspaces)

`core` agnóstico de plataforma + apps que injetam adapters pelas "portas":

```
packages/core/src/
  ports.ts        AudioCapture · Transcriber · Translator · Storage (interfaces)
  ia.ts           AssistenteIA (resumir · itensDeAcao · perguntar · corrigir)
  session/estado.ts  máquina de estados (idle→recording→paused→finalizing→done)
  vad.ts          segmentador por voz (RMS) — corta falas entre silêncios
  pipeline.ts     orquestra captura→STT→tradução; modo ao vivo vs depois
  export.ts       .srt / .txt / .json + textoConversa()
  testing/fakes.ts adapters de mentira p/ testes
apps/extension/   Manifest V3, React + Vite (DESKTOP)
  src/adapters/   getUserMediaCapture · whisperTranscriber(+whisper.worker) ·
                  chromeTranslator · chromeAiAssistant · indexedDbStorage
  public/         manifest.json · capture-worklet.js · ort/ (gerado no build)
apps/mobile/      (Fase 2 — ainda não criado)
```

### Pilha offline por plataforma (são DIFERENTES)

| Camada     | Extensão (desktop)                         | Celular (Fase 2)             |
| ---------- | ------------------------------------------ | ---------------------------- |
| STT        | Whisper WASM (transformers.js, Web Worker) | whisper.rn (whisper.cpp)     |
| Tradução   | Chrome Translator API (Gemini Nano)        | Google ML Kit                |
| IA         | Chrome Summarizer + Prompt API             | Gemini Nano Android/MediaPipe|
| Storage    | IndexedDB                                  | SQLite                       |

> A Translator/Prompt API do Chrome é **só desktop**; por isso a extensão foca
> desktop e o mobile usará ML Kit / Gemini Nano nativo.

## Estado atual — FUNCIONANDO

- **Fase 0** (core): completa, **17 testes** passando + typecheck.
- **Fase 1** (extensão): completa e **validada em runtime** — a transcrição em
  português funcionou de ponta a ponta, 100% local.
- **IA on-device**: implementada (resumo, itens de ação, perguntar, corrigir).

### Verificar
```
npm install                                   # na raiz
npm test                                       # 17 testes do core
npm run build --workspace @rt/extension        # gera apps/extension/dist (prebuild copia o ort/)
```
Carregar: chrome://extensions → Modo desenvolvedor → Carregar sem compactação → apps/extension/dist

## Lições/decisões travadas nesta conversa (não repetir os erros)

1. **pnpm não instalado** → usamos **npm workspaces**.
2. **Microfone no painel lateral**: o prompt de permissão é dispensado se vier
   tarde. Solução: pedir o mic **no gesto do clique**, antes do tradutor
   (pipeline.start reordenado). Fallback: página `permiso.html` numa aba.
3. **onnxruntime do CDN bloqueado pela CSP** → servimos o runtime de dentro da
   extensão em `public/ort/` (copiado por `scripts/copy-ort.mjs` no prebuild),
   `numThreads=1` (dispensa cross-origin isolation).
4. **AudioWorklet via blob: bloqueado pela CSP** → worklet é arquivo real
   `public/capture-worklet.js` (origem 'self'). MV3 não deixa adicionar `blob:`.
5. **Tradução "ecoando" o original**: a direção importa. O usuário tinha o pacote
   `en→pt` instalado, mas o app pedia `pt→en` (o caso principal dele: falar PT →
   traduzir p/ inglês). Instalar o par em `chrome://on-device-translation-internals/`.
   Mesmo idioma = no-op; falha de par é memorizada p/ não repetir erro por trecho.
6. **IA (Gemini Nano)** pode exigir ativação única:
   `chrome://flags/#prompt-api-for-gemini-nano` = Enabled +
   `#optimization-guide-on-device-model` = Enabled BypassPerfRequirement →
   Relaunch → o modelo baixa (chrome://components ou automático ao clicar Resumir).
   Diagnóstico no console do painel: `await LanguageModel.availability()`.

## Fase Meet (2026-07-25) — IMPLEMENTADA, falta validar em runtime

Gravação de **reuniões do Google Meet**, além do modo presencial que já existia.

### O que mudou na arquitetura

- **O áudio saiu do painel lateral e foi para um `offscreen document`**
  (`src/offscreen.ts`). O painel virou cliente fino: manda comandos e recebe
  segmentos por mensagem (`src/mensagens.ts`). Motivo: o painel é destruído se o
  usuário o fechar — perder uma reunião de uma hora por isso era inaceitável.
- **Duas fontes de áudio simultâneas** numa reunião: microfone (você) +
  `chrome.tabCapture` (os outros). O `Pipeline` do core agora aceita `captures: []`.
- **Content script** (`src/content/meet.ts`) detecta entrada na chamada e observa
  quem está falando, para dar nomes reais às falas.

### Limites do Chrome que moldaram a solução (não tentar contornar)

1. **`tabCapture` exige gesto do usuário.** Não existe gravação 100% automática:
   a detecção da reunião é automática (badge "REC" no ícone + aviso no painel),
   mas o start final é **um clique**. Isso é do Chrome, não do código.
2. **⚠️ `tabCapture` rouba o áudio da aba.** `TabCapture` reconecta o stream em
   `ctx.destination` — sem isso o usuário fica **sem ouvir a reunião**. É o erro
   nº 1 de quem usa essa API; não remover essa linha.
3. **Gemini Nano / Translator são só desktop** (confirmado jul/2026). Definiu o
   escopo do PWA (abaixo).

### Separação de falantes (degradação suave, em 4 níveis)

`AtribuidorFalantes` (`packages/core/src/falantes.ts`):
mic → sempre **"Você"** · aba + nome lido do Meet → **nome real** ·
aba só com id → **"Participante N"** (numeração estável) · rotulador quebrado →
**"Participante"** genérico. Em nenhum caso se perde a transcrição.

> Os seletores do Meet em `content/meet.ts` **vão quebrar** quando o Google mexer
> no layout — é esperado. O content script falha em silêncio e avisa
> `meet:semLeitura`; o painel mostra o aviso e a gravação segue sem nomes.

`textoConversa()` agora emite **`Nome: fala`** quando há falantes — é isso que faz
o resumo da IA dizer *quem* combinou o quê.

## Fase PWA (2026-07-25) — IMPLEMENTADA, falta validar no celular

App instalável no celular (`apps/pwa/`), substituindo a Fase 2 React Native.

### Reorganização: `packages/web/`

Os adapters de navegador saíram de `apps/extension/src/adapters/` e viraram um
pacote compartilhado pelos dois apps: `GetUserMediaCapture`, `WhisperTranscriber`
(+ worker), `IndexedDbStorage`/`IndexedDbDeposito` e o `capture-worklet.js`.
Dois acoplamentos foram cortados no caminho:

- a URL do worklet vem no **construtor** (era `chrome.runtime.getURL`);
- o caminho do runtime ORT vem na mensagem **`init`** do worker (era derivado de
  `self.location`, que quebraria se o layout de saída mudasse).

`packages/web/scripts/copy-assets.mjs` substitui o antigo `copy-ort.mjs` e serve
os dois apps (`npm run setup:assets`).

### Modo "transcrever depois" (core)

`Pipeline` ganhou `modo: "aoVivo" | "depois"`. O padrão continua `"aoVivo"`
(extensão intocada). No `"depois"` a captura só **arquiva** o áudio e
`transcreverPendentes()` transcreve tudo ao final, com progresso.

> **Por que o celular não transcreve ao vivo:** o Whisper em WASM num telefone
> pode ser mais lento que a própria fala — ao vivo, a fila cresceria sem fim.
> As falas vão para o IndexedDB como **int16** (metade do tamanho): em float32,
> uma hora de gravação seriam ~230 MB só de RAM.

### ⚠️ iPhone: nunca force `sampleRate` no AudioContext

O hardware amostra a 48 kHz e o Safari **ignora** o pedido de 16 kHz — o áudio
viria acelerado e o Whisper devolveria texto embaralhado. `GetUserMediaCapture`
lê `ctx.sampleRate` real e reamostra (`reamostrar()` em `core/util.ts`). Se um
dia a transcrição sair embaralhada só no iPhone, é aqui que se olha.

### Pegadinha do build (já resolvida)

O `.wasm` de 21 MB sai **duas vezes**: em `ort/` (copiado por nós, o único que o
runtime busca) e em `assets/` (emitido pelo bundler, nunca usado). O
`globIgnores` do Workbox exclui a segunda — sem isso o celular baixaria 43 MB em
vez de 22 MB na instalação. A extensão tem a mesma duplicação, mas lá é local e
não custa download.

## Pendências / próximos passos

- **[falta validar]** Fase Meet numa reunião real (roteiro no README).
- **[falta validar]** PWA num celular Android e num iPhone (roteiro no README).
  Nada das duas fases foi exercitado em runtime — só testes de unidade e build.
- **[decisão pendente]** Publicar no GitHub Pages: o workflow
  `.github/workflows/deploy-pwa.yml` está pronto, mas exige criar o repositório
  e conferir que `PWA_BASE` casa com o nome dele. O dono ainda não confirmou.

- **[aberto no fim da conversa]** Confirmar se a IA (Gemini Nano) ativou na
  máquina do dono — ver `LanguageModel.availability()`. O componente
  "Optimization Guide On Device Model" só aparece em chrome://components DEPOIS
  de habilitar a flag e reiniciar.
- Considerar deixar **Whisper small** como padrão (mais preciso que o base).
- **Fase 2 — app de celular** (React Native), reusando o mesmo `core`:
  adapters whisper.rn + ML Kit + Gemini Nano nativo + SQLite.
- Fase 3: histórico melhor, separação por falante, UX de download de modelos.

## Observações

- Sem segredos no projeto (nada de chaves/credenciais) — seguro no OneDrive.
- `node_modules/`, `dist/` e `public/ort/` foram excluídos desta cópia
  (regeneráveis via `npm install` + `npm run build`).
- Plano original: `.claude/plans/splendid-nibbling-panda.md` (na instalação do Claude).

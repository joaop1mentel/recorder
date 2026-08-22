# Recorder + Translator
**Ainda em fase de teste**

Gravador de **conversas presenciais** com **transcrição e tradução offline** (no
dispositivo). Dois alvos, um só núcleo de lógica: **extensão de navegador**
(desktop) e **app de celular** (Android/iOS).

## Por que "offline no dispositivo"

Privacidade (o áudio nunca sai do aparelho), custo zero por minuto e funciona sem
internet. O motor é **diferente em cada plataforma** porque a mesma tecnologia não
existe nas duas:

| Camada          | Extensão (desktop)                         | Celular (Android/iOS)              |
| --------------- | ------------------------------------------ | ---------------------------------- |
| Captura         | `getUserMedia`                             | microfone nativo                   |
| Transcrição STT | Whisper via WASM/WebGPU (transformers.js)  | `whisper.rn` (whisper.cpp)         |
| Tradução        | Chrome Built-in Translator API (Chrome 138+) | Google ML Kit On-Device Translation |
| Armazenamento   | IndexedDB                                  | SQLite                             |

> A Translator API do Chrome é **só desktop** e pede ~22 GB livres — por isso a
> extensão foca desktop e o celular usa ML Kit.

## Estrutura (monorepo — npm workspaces)

```
packages/web/      ← adapters de navegador usados pelos DOIS apps
  src/
    getUserMediaCapture.ts  ← microfone + worklet + reamostragem (48k→16k do iPhone)
    whisperTranscriber.ts   ← Whisper em Web Worker
    whisper.worker.ts
    indexedDbStorage.ts     ← sessões + depósito de falas cruas
packages/core/     ← lógica compartilhada, TS puro, zero dependência de plataforma
  src/
    ports.ts       ← as 4 interfaces (AudioCapture, Transcriber, Translator, Storage)
    session/estado.ts  ← máquina de estados (idle→recording→paused→finalizing→done)
    vad.ts         ← segmentador por atividade de voz (energia RMS)
    pipeline.ts    ← orquestra captura→STT→tradução + modo "ao vivo" vs "depois"
    export.ts      ← .srt / .txt / .json
    segments.ts    ← modelo de segmento
    testing/fakes.ts ← adapters de mentira para testes
apps/extension/    ← Manifest V3 + React/Vite (desktop: presencial + Meet)
apps/pwa/          ← PWA instalável (celular: gravar + transcrever)
```

Cada app só implementa os 4 adapters de `ports.ts`; toda a máquina de estados,
o VAD, a montagem do transcrito e o export ficam escritos **uma vez** no `core`.

## Como rodar

```bash
npm install
npm test        # testes do core (vitest)
npm run typecheck
```

## Testar a extensão no Chrome (desktop, Chrome 138+)

```bash
npm install
npm run build --workspace @rt/extension   # gera apps/extension/dist
```

1. Abra `chrome://extensions`, ative o **Modo do desenvolvedor**.
2. **Carregar sem compactação** → selecione `apps/extension/dist`.
3. Clique no ícone da extensão → abre o **painel lateral**.
4. Idioma falado = Português; aperte **Gravar** e fale. Na 1ª vez o modelo
   Whisper é baixado (precisa de internet uma vez; depois roda offline).
5. A transcrição aparece ao vivo; ao **Parar**, exporte `.srt` / `.txt` / `.json`.

> Idioma principal: **Português** (padrão de origem). A tradução usa a Translator
> API nativa do Chrome; se indisponível, a gravação e a transcrição seguem
> funcionando e um aviso é exibido.

## Gravar uma reunião do Google Meet

1. Entre numa chamada em `meet.google.com`. O ícone da extensão ganha o selo
   **REC** e o painel mostra “📹 Reunião do Meet detectada”.
2. Clique em **● Gravar reunião**.

   > O clique é obrigatório: o Chrome **não permite** capturar o áudio de uma aba
   > sem um gesto do usuário. A detecção é automática; o start, não.

3. Durante a chamada o painel mostra a transcrição com **quem falou** (“Você” e o
   nome dos participantes) e, a cada ~90 s, os **✨ Pontos principais** gerados
   pela IA on-device.
4. Ao **Parar**, exporte `.srt`/`.txt`/`.json` — os nomes vão no arquivo — ou use
   Resumir / Itens de ação, que agora sabem quem disse o quê.

**Se os nomes não aparecerem** (“Participante 1, 2, 3…”): o Google mudou o layout
do Meet e os seletores do content script pararam de casar. A gravação e a
separação continuam funcionando; só o nome se perde.

## App de celular (PWA)

```bash
npm install
npm run dev --workspace @rt/pwa -- --host   # abra o IP mostrado, pelo celular
```

Para instalar na tela de início o celular precisa de **HTTPS** — em
desenvolvimento, o Chrome no Android aceita o IP local; o iPhone costuma exigir
a versão publicada. O workflow `.github/workflows/deploy-pwa.yml` publica no
GitHub Pages (conferir que `PWA_BASE` casa com o nome do repositório).

**Como funciona:** aperte Gravar, fale, aperte Parar — **a transcrição começa aí**,
com barra de progresso. Não há legenda ao vivo no celular de propósito: o Whisper
em WASM num telefone pode ser mais lento que a própria fala, e ao vivo a fila
cresceria sem fim. Na 1ª vez o modelo (~78 MB) é baixado; depois roda offline.

> No celular **não há tradução nem IA** — o Gemini Nano e a Translator API do
> Chrome só existem no desktop. Para essas funções, use a extensão.

## Status

- [x] **Fase 0** — scaffold + `core` com máquina de estados, VAD, pipeline e export;
      26 testes passando com adapters fake.
- [x] **Fase 1** — Extensão MVP (desktop): 4 adapters reais (`getUserMedia` +
      Whisper WASM em Web Worker + Translator API do Chrome + IndexedDB), UI de
      painel lateral com gravação, legenda ao vivo, histórico e export.
      Transcrição validada em runtime. Typecheck + build de produção OK.
- [x] **IA on-device** — port `AssistenteIA` no core + adapter `ChromeAiAssistant`
      (Summarizer + Prompt API / Gemini Nano): resumo, itens de ação, perguntar
      sobre a conversa e corrigir a transcrição. Tudo offline, sem chave.

  > **Ativar a IA:** se a seção "🤖 IA" disser "indisponível", habilite em
  > `chrome://flags` → `#prompt-api-for-gemini-nano` e
  > `#optimization-guide-on-device-model` (Enabled BypassPerfRequirement),
  > reinicie o Chrome, e baixe o modelo em `chrome://components` →
  > "Optimization Guide On Device Model" → Verificar atualização.
- [x] **Fase Meet** — captura do áudio da chamada (`tabCapture`) + microfone em
      paralelo, detecção automática da reunião, separação de falantes com nomes
      reais (com queda suave para “Participante N”) e pontos principais ao vivo.
      O áudio passou a rodar num *offscreen document*, para a gravação sobreviver
      ao fechamento do painel. **Ainda não validado em reunião real.**
- [x] **Fase PWA** — app de celular (`apps/pwa/`) reusando `core` + o novo
      `packages/web`. Grava e transcreve offline; **sem** tradução e **sem** IA
      (Gemini Nano e Translator não existem no Chrome mobile). Transcreve ao
      **parar**, não ao vivo — o Whisper em WASM não acompanha a fala num
      telefone. **Ainda não validado em celular.**
- [ ] **Fase 3** — histórico melhor, UX de download de modelos.

Plano completo em `../.claude/plans/splendid-nibbling-panda.md`.

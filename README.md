# Cloudy Desktop & Mobile

Il chatbot **Cloudy** ([cloudy.chat](https://cloudy.chat), pacchetto npm [`cloudy-cli`](https://www.npmjs.com/package/cloudy-cli)) trasformato da programma per terminale in un'app grafica: **installer EXE per Windows** e **APK per Android**, con la vera mascotte animata Cloudee, i loghi reali dei modelli, e in più un agente in stile Claude Code + Claude Cowork, il collegamento a Claude, provider personalizzati, plugin, skills, connettori e un computer Linux tutto per l'IA.

## Cosa contiene

| Funzione | Dettagli |
|---|---|
| **Chat Cloudy** | Gli stessi 8 modelli, account, quota e API della CLI originale (streaming, ragionamento, allegati e immagini per i modelli con visione, card sponsor che si apre solo con un clic). Login con abbinamento dal browser, Google/GitHub/… o email e password. Si può provare anche senza account. |
| **Modalità Code** | Agente di programmazione nella cartella che scegli: legge, cerca, modifica (con diff), esegue comandi e test. Livelli di accesso *Sola lettura / Chiedi / Completo* e modalità *Build / Piano*, come l'originale. |
| **Modalità Cowork** | Compiti completi: piano con lista di passi aggiornata dal vivo, file prodotti, artefatti, notifiche a fine lavoro. |
| **Collegamento Claude** | Tramite **Claude Code** (il tuo abbonamento Claude, CLI ufficiale in modalità headless con approvazione delle azioni) o tramite **chiave API Anthropic** (SDK ufficiale). |
| **Tabella modelli Claude auto-aggiornata** | Letta da Claude Code stesso (richiesta `initialize`, gratuita) e da `/v1/models`. Una riga per famiglia (Fable, Opus, Sonnet, Haiku): quando esce un modello nuovo, il vecchio sparisce e il nuovo compare al suo posto. Controllo ogni 30 minuti e a richiesta. |
| **Mai cambi di modello automatici** | Quando finisci la quota Cloudy compare la finestra con i modelli Claude attivi (e gli altri): scegli tu. Se un modello viene sostituito, la conversazione chiede prima di passare al successore. Anche il fallback lato server è spento di default. |
| **Cronologia completa** | Cambiando modello a metà conversazione, il nuovo modello riceve tutto: testo, risultati degli strumenti e tutti i file allegati (immagini e PDF inclusi). |
| **Provider personalizzati** | OpenAI, OpenRouter, Groq, Mistral, DeepSeek, Gemini, xAI, Together, Fireworks, Cerebras, Perplexity, Ollama e LM Studio in locale, o qualsiasi endpoint compatibile OpenAI o Anthropic. |
| **Computer Linux dell'IA** | Un vero Linux 6.8 (Buildroot) che gira dentro l'app con l'emulatore v86 — anche su Android. L'IA ci esegue comandi e script; `/mnt/home` è persistente. Su Windows si può usare WSL. |
| **Strumenti dell'agente** | I 7 originali (`read_file`, `write_file`, `list_dir`, `edit_file`, `self_test`, `use_skill`, `run_command`) + ricerca file e testo, Linux, ricerca e lettura web, HTTP, generazione immagini, artefatti, piano, memoria, calcolatrice, notifiche. |
| **Connettori (MCP)** | Context7, DeepWiki, Microsoft Learn, Cloudflare, AWS, Astro, GitMCP, Hugging Face, Exa (senza chiave); GitHub, Stripe, Notion, Linear, Sentry, Supabase (con token); server locali stdio (filesystem, memoria, Playwright, Git) e connettori personalizzati. |
| **Plugin** | 20 pacchetti pronti (Sviluppatore Pro, Web Studio, Data Lab, Scrittore, Marketing, Studente, Linux & DevOps, Sicurezza, Ricerca, Designer, …) con skill, comandi `/` e connettori; installazione anche da file o URL. |
| **Skills** | 32 skill integrate + le tue + quelle del progetto (`.cloudy/skills`, `.claude/skills`), import da Claude Code / Cursor / VS Code con il comando `import` originale. |
| **Applicazioni** | 19 app in finestre spostabili: terminale Linux, file, editor di codice, browser, note, calcolatrice, convertitore, lavagna, pomodoro, orologio mondiale, JSON, regex, confronto testi, strumenti testo, colori, password, Markdown Studio, galleria, traduttore. |
| **Design** | Cielo animato, vetro sfocato, tema scuro/chiaro, colori personalizzabili, Cloudee che reagisce (ascolta, pensa, cerca, lavora, festeggia, si addormenta), splash con il wordmark pixel della TUI originale, animazioni su ogni elemento (riducibili). |

## Dal terminale alla grafica: ogni file originale

Il pacchetto originale è incluso **senza modifiche** in `original/cloudy-cli/` e l'app lo usa direttamente:

| File originale | Nell'app |
|---|---|
| `src/client.js` | `app/src/providers/cloudy.js` (stesse API; trasporto nativo al posto di `fetch` per superare il CORS) |
| `src/agent.js` + `dist/serve.cjs` | usati **così come sono** dal desktop (`electron/ipc/engine.cjs`) come "Motore originale Cloudy Code" |
| `src/import.js` + `dist/import.cjs` + `src/import-plan.js` | Impostazioni → Skills → *Importa da Claude Code / Cursor / VS Code* (esegue `cloudy import --json`) |
| `src/history.js` | importato direttamente: ↑/↓ nel compositore |
| `src/session.js` | importato: limite di un'ora per turno agente |
| `src/base-url.js`, `src/tokens.js` | importati: server predefinito e colori dei modelli |
| `src/tui.js` | sostituito dall'interfaccia grafica; comandi `/`, scorciatoie (Ctrl+O/T/W/N/L/U), card sponsor, livelli di accesso e wordmark ripresi uguali |
| `src/main.js`, `src/ui.js`, `src/mouse.js` | comandi (`login`, `models`, `usage`, `whoami`, `ask`…) diventati finestre e comandi `/`; markdown e spinner diventati componenti grafici |
| `src/update.js` | Info → *Controlla aggiornamenti di cloudy-cli* (registro npm) |
| logo e animazioni | il motore della mascotte Cloudee estratto da cloudy.chat (`app/assets/vendor/cloudee-avatar.mjs`, 23 animazioni) |

## Struttura

```
app/          interfaccia (React) — identica su Windows, Android e browser
  src/platform  ponte verso il sistema (Electron IPC, plugin Android, web)
  src/providers Cloudy, Claude API (SDK ufficiale), Claude Code, OpenAI-compatibili, tabella modelli
  src/agent     loop dell'agente, strumenti, workspace, prompt e cronologia
  src/linux     computer Linux (v86)
  src/connectors, src/plugins, src/skills, src/state, src/ui
electron/     processo principale desktop (HTTP, file confinati, shell, Claude Code, motore originale, MCP, portachiavi)
android/      progetto Capacitor + plugin Java per l'HTTP in streaming
original/     cloudy-cli 1.0.0 originale, intatto
build/        icone e grafica dell'installer (generate dal vero Cloudee)
scripts/      build del web, icone, asset Android, v86
tests/        unit test e test end-to-end dell'app Electron
```

## Compilare

Requisiti: Node.js 20+. Per l'APK: JDK 21 e Android SDK 36.

```bash
npm install
npm test                    # unit test
npm run start               # avvia l'app desktop in sviluppo
npm run dist:win            # → dist/Cloudy-Setup-2.0.0.exe (da Linux serve Wine)
npm run cap:sync && cd android && ./gradlew assembleRelease   # → APK
xvfb-run -a npm run test:e2e   # test end-to-end dell'app desktop
```

Firma dell'APK: passa `-PcloudyKeystore=…  -PcloudyKeystorePassword=…  -PcloudyKeyAlias=…  -PcloudyKeyPassword=…` (o le variabili `CLOUDY_KEYSTORE*`); senza, la release viene firmata con la chiave di debug.

## Note oneste

- **Claude Code** funziona nell'app desktop (deve essere installato sul PC). Su Android si usa una chiave API Anthropic o un provider personalizzato.
- I modelli Claude via Claude Code consumano il tuo abbonamento Claude; via API il tuo credito Anthropic. Cloudy resta gratuito con i suoi limiti (25 messaggi e 70 crediti agente al giorno).
- I server MCP locali (stdio) richiedono Node.js o Python sul PC.
- Il computer Linux è un i686 emulato: ottimo per comandi, script lua/awk/sh e piccoli strumenti, non per programmi pesanti. La rete al suo interno è spenta di default.
- L'EXE e l'APK non sono firmati con un certificato di uno sviluppatore commerciale: Windows SmartScreen potrebbe chiedere conferma ("Ulteriori informazioni → Esegui comunque") e Android chiede di consentire l'installazione da origini sconosciute.

Licenza MIT. Cloudy e cloudy-cli © 2026 Cloudy (MIT). Claude è un marchio di Anthropic.

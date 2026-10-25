import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons.jsx";
import { Cloudee } from "./Cloudee.jsx";
import { useStore } from "../lib/store.js";
import { getSettings, store, toast, updateSettings } from "../state/store.js";
import { claudeRoute, refreshClaudeModels, refreshProviderModels } from "../state/models.js";
import { applyTheme, logoutCloudy, removeProvider, saveProvider, setAnthropicKey, setClaudeEnabled, loginClaudeCode } from "../state/init.js";
import { exportAll, importAll } from "../state/conversations.js";
import { connect, connectorList, isConnectorEnabled, setConnector } from "../state/connectors.js";
import { pluginList, setPlugin } from "../state/plugins.js";
import { validatePlugin } from "../plugins/catalog.js";
import { BUILTIN_SKILLS, parseSkill } from "../skills/index.js";
import { PROVIDER_PRESETS } from "../providers/openai.js";
import { CLAUDE_LOGO } from "../providers/logos.js";
import { usageLines } from "../providers/cloudy.js";
import { linux } from "../linux/vm.js";
import { appInfo, invoke, isAndroid, isDesktop, openExternal, osName, saveAs } from "../platform/native.js";
import { httpJson } from "../platform/http.js";
import { timeAgo, uid } from "../lib/util.js";

const SECTIONS = [
  ["account", "Account Cloudy", "user"],
  ["claude", "Claude", "sparkles"],
  ["providers", "Provider personalizzati", "globe"],
  ["agent", "Agente", "cpu"],
  ["linux", "Computer Linux", "terminal"],
  ["connectors", "Connettori", "plug"],
  ["plugins", "Plugin", "puzzle"],
  ["skills", "Skills", "wand"],
  ["appearance", "Aspetto", "sun"],
  ["data", "Dati", "download"],
  ["about", "Info", "info"],
];

const Switch = ({ on, onChange, claude }) => <button className={"switch" + (on ? " on" : "") + (claude ? " claude" : "")} onClick={() => onChange(!on)} aria-pressed={on} />;
const Seg = ({ value, options, onChange }) => (
  <div className="seg">
    {options.map(([v, l]) => (
      <button key={v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>
        {l}
      </button>
    ))}
  </div>
);
const Row = ({ t, d, children }) => (
  <div className="setting-row">
    <div className="grow">
      <div className="t">{t}</div>
      {d && <div className="d">{d}</div>}
    </div>
    {children}
  </div>
);

// ---------------------------------------------------------------- account
function Account() {
  const cloudy = useStore(store, (s) => s.cloudy);
  const base = useStore(store, (s) => s.settings.cloudyBase);
  return (
    <>
      <h2>Account Cloudy</h2>
      <p className="lead">L'account del sito cloudy.chat e della CLI: stessi modelli e stessa quota gratuita.</p>
      <div className="section">
        <div className="row">
          <Cloudee mood={cloudy.token ? "happy" : "curious"} size={64} />
          <div className="grow">
            <div style={{ fontWeight: 650 }}>{cloudy.user?.email || "Non hai effettuato l'accesso"}</div>
            <div className="hint">{cloudy.token ? "Piano gratuito · dispositivo abbinato" : "Senza account puoi provare con pochi messaggi al giorno."}</div>
          </div>
          {cloudy.token ? (
            <button className="btn danger" onClick={logoutCloudy}>
              <Icon name="logout" /> Esci
            </button>
          ) : (
            <button className="btn primary" onClick={() => store.set({ dialog: { type: "login" } })}>
              Accedi
            </button>
          )}
        </div>
        {cloudy.token && (
          <pre className="out-box" style={{ margin: 0 }}>
            {usageLines(cloudy.usage).join("\n")}
          </pre>
        )}
      </div>
      <div className="section">
        <h4>Server</h4>
        <label className="field">
          Indirizzo dell'API Cloudy
          <input className="input" defaultValue={base} onBlur={(e) => updateSettings({ cloudyBase: e.target.value.trim().replace(/\/+$/, "") || "https://cloudy.chat" })} />
        </label>
        <div className="hint">Come CLOUDY_API_URL nella CLI. Lascia https://cloudy.chat salvo esigenze di sviluppo.</div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- claude
function Claude() {
  const claude = useStore(store, (s) => s.claude);
  const settings = useStore(store, (s) => s.settings);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(new Set());
  const route = claudeRoute();
  const refresh = async () => {
    setBusy(true);
    const diff = await refreshClaudeModels();
    setFresh(new Set([...diff.replaced.map((r) => r.to.id), ...diff.added.map((m) => m.id)]));
    setBusy(false);
    if (!diff.changed) toast("La tabella dei modelli Claude è già aggiornata", "success");
  };
  return (
    <>
      <h2>
        <span style={{ color: "var(--claude)" }}>✳</span> Claude
      </h2>
      <p className="lead">Collega Claude Code o una chiave API: quando finisci la quota di Cloudy (o quando vuoi) scegli un modello Claude. La tabella si aggiorna da sola: se esce un nuovo Opus, il vecchio sparisce e compare il nuovo al suo posto. Non cambio mai modello senza chiedertelo.</p>

      <div className="section">
        <h4>
          Collegamento Claude Code {claude.code?.installed ? <span className="chip ok">v{claude.code.version}</span> : <span className="chip warn">{isDesktop ? "non trovato" : "solo desktop"}</span>}
          {claude.code?.installed && (claude.code.loggedIn === false ? <span className="chip err">non connesso</span> : <span className="chip ok">{claude.code.subscription || "connesso"}</span>)}
        </h4>
        <div className="hint">Usa il tuo abbonamento Claude (Pro/Max) attraverso la CLI ufficiale «claude». Cloudy la avvia in modalità headless, ne mostra gli strumenti e ti chiede l'approvazione delle azioni.</div>
        {isDesktop && (
          <>
            <label className="field">
              Percorso di claude (vuoto = automatico)
              <input className="input" placeholder={osName === "windows" ? "C:\\Users\\…\\AppData\\Roaming\\npm\\claude.cmd" : "/usr/local/bin/claude"} defaultValue={settings.claude.codePath} onBlur={(e) => updateSettings((s) => ({ claude: { ...s.claude, codePath: e.target.value.trim() } }))} />
            </label>
            <div className="row wrap">
              {claude.code?.installed && claude.code.loggedIn === false && (
                <button className="btn claude small" onClick={loginClaudeCode}>
                  Accedi a Claude
                </button>
              )}
              {!claude.code?.installed && (
                <button className="btn small" onClick={() => openExternal("https://docs.claude.com/en/docs/claude-code/setup")}>
                  <Icon name="external" size={14} /> Come installare Claude Code
                </button>
              )}
              <span className="hint">{claude.code?.path}</span>
            </div>
          </>
        )}
      </div>

      <div className="section">
        <h4>Chiave API Anthropic {claude.hasKey ? <span className="chip ok">salvata</span> : <span className="chip">nessuna</span>}</h4>
        <div className="row">
          <input className="input grow" type="password" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
          <button className="btn" onClick={async () => (await setAnthropicKey(key), setKey(""), toast("Chiave salvata in modo sicuro", "success"))} disabled={!key.trim()}>
            Salva
          </button>
          {claude.hasKey && (
            <button className="btn danger" onClick={() => setAnthropicKey("")}>
              Rimuovi
            </button>
          )}
        </div>
        <Row t="Usa per i modelli Claude" d={route ? `Ora: ${route === "code" ? "Claude Code" : "chiave API"}` : "Nessun collegamento attivo"}>
          <Seg value={settings.claude.via} options={[["auto", "Automatico"], ["code", "Claude Code"], ["api", "Chiave API"]]} onChange={(v) => updateSettings((s) => ({ claude: { ...s.claude, via: v } }))} />
        </Row>
        <Row t="Fallback automatico sui rifiuti" d="Se attivo, quando Claude rifiuta una richiesta il server la passa a un altro modello. Spento di default: Cloudy non cambia mai modello senza chiedertelo.">
          <Switch on={settings.claude.fallbacks} onChange={(v) => updateSettings((s) => ({ claude: { ...s.claude, fallbacks: v } }))} claude />
        </Row>
      </div>

      <div className="section">
        <div className="row">
          <h4 className="grow">Tabella dei modelli</h4>
          <span className="hint">{claude.updatedAt ? `aggiornata ${timeAgo(claude.updatedAt)}` : "elenco integrato"}</span>
          <button className="btn small" onClick={refresh} disabled={busy}>
            {busy ? <span className="spinner" /> : <Icon name="refresh" size={14} />} Aggiorna ora
          </button>
        </div>
        {claude.error && <div className="hint" style={{ color: "var(--warn)" }}>{claude.error}</div>}
        <div className="claude-table">
          {claude.table.map((m, i) => {
            const on = !!settings.claude.enabled[m.id];
            return (
              <div key={m.id} className={"claude-row" + (on ? " on" : "") + (fresh.has(m.id) ? " fresh" : "")} style={{ animationDelay: i * 60 + "ms" }}>
                <span className="logo">
                  <img src={CLAUDE_LOGO} alt="" />
                </span>
                <div>
                  <div className="n">
                    {m.name} {m.needsCredits && <span className="chip warn">crediti extra</span>}
                  </div>
                  <div className="hint">{m.blurb}</div>
                  <div className="id">{m.id}{m.sources ? ` · ${m.sources.join(" + ")}` : ""}</div>
                </div>
                <Switch on={on} onChange={(v) => setClaudeEnabled(m.id, v)} claude />
              </div>
            );
          })}
        </div>
        <div className="hint">I modelli attivi compaiono nel selettore modelli e nella finestra «quota esaurita». Le fonti sono Claude Code stesso e l'API /v1/models: si aggiornano ogni 30 minuti.</div>
        {!!claude.history?.length && (
          <details>
            <summary className="hint" style={{ cursor: "pointer" }}>
              Cronologia aggiornamenti ({claude.history.length})
            </summary>
            {claude.history.map((h, i) => (
              <div key={i} className="history-row">
                <span className="muted">{new Date(h.at).toLocaleString("it-IT")}</span> {h.fromLabel} <Icon name="chevronRight" size={12} /> <b>{h.toLabel}</b>
              </div>
            ))}
          </details>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- providers
function Providers() {
  const providers = useStore(store, (s) => s.settings.providers);
  const providerModels = useStore(store, (s) => s.providerModels);
  const [edit, setEdit] = useState(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const startNew = (presetId) => {
    const p = PROVIDER_PRESETS.find((x) => x.id === presetId) || PROVIDER_PRESETS.at(-1);
    setEdit({ id: null, preset: p.id, name: p.name, baseUrl: p.baseUrl, format: p.format, models: [], keyHint: p.keyHint });
    setKey("");
  };
  const fetchModels = async () => {
    setBusy(true);
    try {
      const saved = await saveProvider(edit, key || undefined);
      setEdit({ ...edit, id: saved.id });
      const list = await refreshProviderModels(saved);
      const enabled = new Set((edit.models || []).filter((m) => m.enabled).map((m) => m.id));
      const models = list.map((m) => ({ id: m.id, name: m.name, enabled: enabled.has(m.id) || (!enabled.size && list.length <= 6) }));
      setEdit((e) => ({ ...e, id: saved.id, models }));
      toast(`${list.length} modelli trovati`, "success");
    } catch (e) {
      toast("Impossibile leggere i modelli: " + e.message, "error");
    }
    setBusy(false);
  };
  const save = async () => {
    await saveProvider(edit, key || undefined);
    setEdit(null);
    toast("Provider salvato", "success");
  };
  return (
    <>
      <h2>Provider personalizzati</h2>
      <p className="lead">Aggiungi qualsiasi servizio compatibile OpenAI o Anthropic: OpenAI, OpenRouter, Groq, Gemini, Mistral, DeepSeek, xAI, Ollama e LM Studio in locale, o un tuo server.</p>
      {!edit && (
        <>
          <div className="card-grid">
            {PROVIDER_PRESETS.map((p, i) => (
              <button key={p.id} className="card" style={{ textAlign: "left", animationDelay: i * 25 + "ms", color: "var(--text)" }} onClick={() => startNew(p.id)}>
                <div className="c-head">
                  <span className="c-ico">{p.logo ? <img src={`assets/logos/${p.logo}`} style={{ width: 22, height: 22 }} alt="" /> : p.name.charAt(0)}</span>
                  <div>
                    <div className="c-name">{p.name}</div>
                    <div className="c-cat">{p.format === "anthropic" ? "formato Anthropic" : "formato OpenAI"}</div>
                  </div>
                </div>
                <div className="c-desc">{p.baseUrl}</div>
              </button>
            ))}
          </div>
          {!!providers.length && <h4 style={{ margin: "18px 0 8px" }}>I tuoi provider</h4>}
          {providers.map((p) => (
            <div key={p.id} className="section">
              <div className="row">
                <div className="grow">
                  <div style={{ fontWeight: 650 }}>{p.name}</div>
                  <div className="hint">
                    {p.baseUrl} · {(p.models || []).filter((m) => m.enabled).length} modelli attivi
                  </div>
                </div>
                <button className="btn small" onClick={() => (setEdit({ ...p, models: (providerModels[p.id] || p.models || []).map((m) => ({ ...m, enabled: !!(p.models || []).find((x) => x.id === m.id && x.enabled) })) }), setKey(""))}>
                  Modifica
                </button>
                <button className="btn small danger" onClick={() => removeProvider(p.id)}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
          ))}
        </>
      )}
      {edit && (
        <div className="section">
          <label className="field">
            Nome
            <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </label>
          <label className="field">
            Indirizzo base (Base URL)
            <input className="input" value={edit.baseUrl} onChange={(e) => setEdit({ ...edit, baseUrl: e.target.value })} />
          </label>
          <label className="field">
            Chiave API {edit.keyHint && <span className="muted">({edit.keyHint})</span>}
            <input className="input" type="password" placeholder={edit.id ? "lascia vuoto per non cambiarla" : ""} value={key} onChange={(e) => setKey(e.target.value)} />
          </label>
          <Row t="Formato API">
            <Seg value={edit.format} options={[["openai", "OpenAI"], ["anthropic", "Anthropic"]]} onChange={(v) => setEdit({ ...edit, format: v })} />
          </Row>
          <Row t="Disattiva gli strumenti" d="Per modelli che non supportano il function calling">
            <Switch on={!!edit.noTools} onChange={(v) => setEdit({ ...edit, noTools: v })} />
          </Row>
          <div className="row">
            <button className="btn" onClick={fetchModels} disabled={busy || !edit.baseUrl}>
              {busy ? <span className="spinner" /> : <Icon name="refresh" size={14} />} Leggi i modelli
            </button>
            <input
              className="input grow"
              placeholder="…oppure aggiungi un ID modello a mano e premi Invio"
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.target.value.trim()) {
                  setEdit({ ...edit, models: [...(edit.models || []), { id: e.target.value.trim(), name: e.target.value.trim(), enabled: true }] });
                  e.target.value = "";
                }
              }}
            />
          </div>
          <div style={{ maxHeight: 260, overflow: "auto", display: "grid", gap: 4 }}>
            {(edit.models || []).map((m) => (
              <label key={m.id} className="row" style={{ fontSize: 13 }}>
                <input type="checkbox" checked={!!m.enabled} onChange={(e) => setEdit({ ...edit, models: edit.models.map((x) => (x.id === m.id ? { ...x, enabled: e.target.checked } : x)) })} />
                <span className="mono">{m.id}</span>
              </label>
            ))}
          </div>
          <div className="dialog-actions">
            <button className="btn ghost" onClick={() => setEdit(null)}>
              Annulla
            </button>
            <button className="btn primary" onClick={save} disabled={!edit.name || !edit.baseUrl}>
              Salva provider
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- agent
function Agent() {
  const s = useStore(store, (x) => x.settings);
  return (
    <>
      <h2>Agente</h2>
      <p className="lead">Come lavora Cloudy in modalità Code e Cowork (e con gli strumenti in Chat).</p>
      <div className="section">
        <Row t="Accesso predefinito" d="Cosa può fare l'agente senza chiedere">
          <Seg value={s.access} options={[["readonly", "Sola lettura"], ["ask", "Chiedi"], ["full", "Completo"]]} onChange={(v) => updateSettings({ access: v })} />
        </Row>
        <Row t="Modalità predefinita">
          <Seg value={s.agentMode} options={[["build", "Build"], ["plan", "Piano"]]} onChange={(v) => updateSettings({ agentMode: v })} />
        </Row>
        <Row t="Sforzo di ragionamento">
          <Seg value={s.effort} options={[["low", "Basso"], ["medium", "Medio"], ["high", "Alto"], ["max", "Max"]]} onChange={(v) => updateSettings({ effort: v })} />
        </Row>
        <Row t="Passi massimi per turno" d="Come l'originale: all'ultimo passo gli strumenti vengono ritirati e l'agente riassume">
          <input className="input" type="number" min={3} max={200} style={{ width: 90 }} value={s.maxSteps} onChange={(e) => updateSettings({ maxSteps: Math.max(3, Math.min(200, Number(e.target.value) || 30)) })} />
        </Row>
        <Row t="Strumenti anche in Chat" d="Ricerca web, calcolatrice, artefatti, immagini e computer Linux nelle chat (non per i modelli Cloudy, che in chat restano a messaggi)">
          <Switch on={s.chatTools} onChange={(v) => updateSettings({ chatTools: v })} />
        </Row>
        {isDesktop && (
          <Row t="Motore originale Cloudy Code" d="Per i modelli Cloudy in modalità Code usa l'host originale di cloudy-cli (dist/serve.cjs) con i suoi 7 strumenti, invece del motore esteso">
            <Switch on={s.useOriginalEngine} onChange={(v) => updateSettings({ useOriginalEngine: v })} />
          </Row>
        )}
      </div>
      <div className="section">
        <h4>Istruzioni personalizzate</h4>
        <textarea className="textarea" placeholder="Es.: Rispondi in modo conciso. Sono uno sviluppatore Python. Chiamami Marco." defaultValue={s.customInstructions} onBlur={(e) => updateSettings({ customInstructions: e.target.value })} />
      </div>
      <div className="section">
        <h4>Memoria ({s.memories.length})</h4>
        <div className="hint">Le cose che l'IA ha deciso di ricordare su di te (tool memory_save).</div>
        {s.memories.map((m) => (
          <div key={m.id} className="row" style={{ fontSize: 13 }}>
            <span className="grow">• {m.text}</span>
            <button className="mini-btn" onClick={() => updateSettings((x) => ({ memories: x.memories.filter((y) => y.id !== m.id) }))}>
              <Icon name="trash" size={13} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- linux
function Linux() {
  const s = useStore(store, (x) => x.settings);
  const status = useStore(store, (x) => x.linuxStatus);
  return (
    <>
      <h2>Computer Linux di Cloudy</h2>
      <p className="lead">Un vero Linux 6.8 (Buildroot) che gira dentro l'app grazie all'emulatore v86: l'IA ci esegue comandi e script senza toccare il tuo computer. /mnt/home è la sua cartella persistente.</p>
      <div className="section">
        <Row t="Sistema usato dall'agente" d={osName === "windows" ? "WSL usa la tua distribuzione Linux di Windows (se installata)" : "«Host» esegue i comandi direttamente sul tuo Linux"}>
          <Seg
            value={s.linuxBackend}
            options={[["v86", "Integrato (v86)"], ...(isDesktop && osName === "windows" ? [["wsl", "WSL"]] : []), ...(isDesktop && osName !== "windows" ? [["host", "Host"]] : [])]}
            onChange={(v) => updateSettings({ linuxBackend: v })}
          />
        </Row>
        <Row t="Memoria RAM" d="Applicata al prossimo avvio">
          <Seg value={s.linuxMemory} options={[[64, "64 MB"], [128, "128 MB"], [256, "256 MB"], [512, "512 MB"]]} onChange={(v) => updateSettings({ linuxMemory: v })} />
        </Row>
        <Row t="Rete" d="fetch = HTTP tramite il browser (limitato dal CORS); relay = server WebSocket/WISP">
          <Seg value={s.linuxNetwork} options={[["none", "Spenta"], ["fetch", "fetch"], ["relay", "Relay"]]} onChange={(v) => updateSettings({ linuxNetwork: v })} />
        </Row>
        {s.linuxNetwork === "relay" && <input className="input" placeholder="wss://…" defaultValue={s.linuxRelayUrl} onBlur={(e) => updateSettings({ linuxRelayUrl: e.target.value.trim() })} />}
        <div className="row">
          <span className={"status-dot " + (status || "off")} />
          <span className="grow">{status === "ready" ? "Acceso" : status === "booting" ? "Avvio in corso…" : status === "error" ? "Errore" : "Spento"}</span>
          <button className="btn small" onClick={() => store.set({ panel: "linux", dialog: null })}>
            <Icon name="terminal" size={14} /> Apri terminale
          </button>
          <button className="btn small" onClick={() => linux.reset()}>
            <Icon name="refresh" size={14} /> Riavvia
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- connectors
function Connectors() {
  useStore(store, (x) => x.settings.connectors);
  useStore(store, (x) => x.settings.plugins);
  const state = useStore(store, (x) => x.connectorState);
  const [cat, setCat] = useState("Tutti");
  const [adding, setAdding] = useState(false);
  const list = connectorList();
  const cats = ["Tutti", ...new Set(list.map((c) => c.category || "Personalizzati"))];
  const test = async (id) => {
    try {
      const c = await connect(id);
      toast(`${c.serverInfo?.name || id}: ${c.tools.length} strumenti disponibili`, "success");
    } catch (e) {
      toast(`${id}: ${e.message}`, "error");
    }
  };
  return (
    <>
      <h2>Connettori</h2>
      <p className="lead">Server MCP (Model Context Protocol) che danno all'IA nuovi strumenti: documentazione, GitHub, Notion, Stripe, browser e altro. Quelli con «nessuna chiave» funzionano subito.</p>
      <div className="tabs-inline">
        {cats.map((c) => (
          <button key={c} className={"pill" + (c === cat ? " active" : "")} style={c === cat ? { borderColor: "var(--accent)", color: "var(--text)" } : undefined} onClick={() => setCat(c)}>
            {c}
          </button>
        ))}
        <button className="pill" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} /> Personalizzato
        </button>
      </div>
      {adding && <CustomConnector onDone={() => setAdding(false)} />}
      <div className="card-grid">
        {list
          .filter((c) => cat === "Tutti" || (c.category || "Personalizzati") === cat)
          .map((c, i) => {
            const on = isConnectorEnabled(c.id);
            const st = state[c.id] || {};
            const user = getSettings().connectors[c.id] || {};
            const unavailable = c.desktopOnly && !isDesktop;
            return (
              <div key={c.id} className={"card" + (on ? " on" : "")} style={{ animationDelay: i * 20 + "ms" }}>
                <div className="c-head">
                  <span className="c-ico">{c.icon || "🔌"}</span>
                  <div className="grow">
                    <div className="c-name">{c.name}</div>
                    <div className="c-cat">
                      {c.transport === "stdio" ? "locale" : "remoto"} · {c.auth === "token" ? "richiede token" : c.auth === "optional" ? "token facoltativo" : "nessuna chiave"}
                    </div>
                  </div>
                  <Switch on={on} onChange={(v) => setConnector(c.id, { enabled: v })} />
                </div>
                <div className="c-desc">{c.description}</div>
                {(c.auth === "token" || c.auth === "optional") && (
                  <input className="input" type="password" placeholder={c.tokenHint || "token"} defaultValue={user.token || ""} onBlur={(e) => e.target.value !== (user.token || "") && setConnector(c.id, { token: e.target.value.trim() })} />
                )}
                <div className="c-foot">
                  <span className={"chip " + (st.status === "connected" ? "ok" : st.status === "error" ? "err" : "")}>
                    {unavailable ? "solo desktop" : st.status === "connected" ? `${st.tools?.length || 0} strumenti` : st.status === "connecting" ? "connessione…" : st.status === "error" ? "errore" : "inattivo"}
                  </span>
                  {!unavailable && (
                    <button className="btn small" onClick={() => test(c.id)}>
                      Prova
                    </button>
                  )}
                  {c.custom && (
                    <button className="btn small danger" onClick={() => updateSettings((s) => ({ customConnectors: s.customConnectors.filter((x) => x.id !== c.id) }))}>
                      <Icon name="trash" size={13} />
                    </button>
                  )}
                </div>
                {st.error && <div className="hint" style={{ color: "var(--err)" }}>{st.error}</div>}
              </div>
            );
          })}
      </div>
    </>
  );
}

function CustomConnector({ onDone }) {
  const [c, setC] = useState({ name: "", transport: "http", url: "", command: "", args: "", token: "" });
  const save = () => {
    const id = "custom-" + uid();
    const conn = { id, name: c.name || c.url || c.command, icon: "🧩", category: "Personalizzati", transport: c.transport, url: c.url.trim(), command: c.command.trim(), args: c.args.trim() ? c.args.trim().split(/\s+/) : [], auth: c.token ? "token" : "none", description: c.transport === "stdio" ? `${c.command} ${c.args}` : c.url };
    updateSettings((s) => ({ customConnectors: [...s.customConnectors, conn], connectors: { ...s.connectors, [id]: { enabled: true, token: c.token || undefined } } }));
    onDone();
  };
  return (
    <div className="section">
      <h4>Nuovo connettore MCP</h4>
      <input className="input" placeholder="Nome" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
      <Seg value={c.transport} options={[["http", "HTTP (Streamable)"], ["sse", "SSE"], ...(isDesktop ? [["stdio", "Locale (stdio)"]] : [])]} onChange={(v) => setC({ ...c, transport: v })} />
      {c.transport === "stdio" ? (
        <>
          <input className="input" placeholder="Comando (es. npx)" value={c.command} onChange={(e) => setC({ ...c, command: e.target.value })} />
          <input className="input" placeholder="Argomenti (es. -y @modelcontextprotocol/server-everything)" value={c.args} onChange={(e) => setC({ ...c, args: e.target.value })} />
        </>
      ) : (
        <input className="input" placeholder="https://…/mcp" value={c.url} onChange={(e) => setC({ ...c, url: e.target.value })} />
      )}
      <input className="input" type="password" placeholder="Token Bearer (facoltativo)" value={c.token} onChange={(e) => setC({ ...c, token: e.target.value })} />
      <div className="dialog-actions">
        <button className="btn ghost" onClick={onDone}>
          Annulla
        </button>
        <button className="btn primary" onClick={save} disabled={c.transport === "stdio" ? !c.command : !c.url}>
          Aggiungi
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- plugins
function Plugins() {
  const on = useStore(store, (x) => x.settings.plugins);
  useStore(store, (x) => x.settings.customPlugins);
  const fileIn = useRef(null);
  const install = (p) => {
    const plugin = validatePlugin(p);
    updateSettings((s) => ({ customPlugins: [...s.customPlugins.filter((x) => x.id !== plugin.id), plugin], plugins: { ...s.plugins, [plugin.id]: true } }));
    toast(`Plugin «${plugin.name}» installato`, "success");
  };
  const fromUrl = async () => {
    const url = prompt("URL del manifesto JSON del plugin:");
    if (!url) return;
    try {
      const { ok, body } = await httpJson(url);
      if (!ok) throw new Error("download non riuscito");
      install(body);
    } catch (e) {
      toast("Plugin non valido: " + e.message, "error");
    }
  };
  return (
    <>
      <h2>Plugin</h2>
      <p className="lead">Pacchetti pronti che aggiungono skill, comandi slash e connettori. Installali con un clic; i comandi compaiono scrivendo / nel messaggio.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn small" onClick={() => fileIn.current?.click()}>
          <Icon name="upload" size={14} /> Installa da file
        </button>
        <button className="btn small" onClick={fromUrl}>
          <Icon name="globe" size={14} /> Installa da URL
        </button>
        <input
          ref={fileIn}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            try {
              install(JSON.parse(await e.target.files[0].text()));
            } catch (err) {
              toast("Plugin non valido: " + err.message, "error");
            }
            e.target.value = "";
          }}
        />
        <button
          className="btn small ghost"
          onClick={() => saveAs("plugin-esempio.json", JSON.stringify({ id: "mio-plugin", name: "Il mio plugin", icon: "🧩", description: "Un esempio", skills: [{ name: "mia-skill", description: "Cosa fa", content: "# Istruzioni\n..." }], commands: [{ name: "saluta", description: "Saluta", prompt: "Saluta {input} in modo creativo" }], connectors: ["context7"] }, null, 2), "application/json")}
        >
          Scarica un esempio
        </button>
      </div>
      <div className="card-grid">
        {pluginList().map((p, i) => (
          <div key={p.id} className={"card" + (on[p.id] ? " on" : "")} style={{ "--cc": p.color, animationDelay: i * 20 + "ms" }}>
            <div className="c-head">
              <span className="c-ico">{p.icon}</span>
              <div className="grow">
                <div className="c-name">{p.name}</div>
                <div className="c-cat">{p.category}</div>
              </div>
              <Switch on={!!on[p.id]} onChange={(v) => setPlugin(p.id, v)} />
            </div>
            <div className="c-desc">{p.description}</div>
            <div className="c-foot">
              <span className="hint">
                {(p.skills || []).length} skill · {(p.commands || []).length} comandi · {(p.connectors || []).length} connettori
              </span>
            </div>
            {on[p.id] && !!p.commands?.length && <div className="hint mono">{p.commands.map((c) => "/" + c.name).join("  ")}</div>}
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- skills
function Skills({ importNow }) {
  const s = useStore(store, (x) => x.settings);
  const [edit, setEdit] = useState(null);
  const [importRes, setImportRes] = useState(null);
  const fileIn = useRef(null);
  const all = [...BUILTIN_SKILLS, ...s.userSkills.map((x) => ({ ...x, user: true }))];
  const toggle = (name, enabled) => updateSettings((x) => ({ disabledSkills: enabled ? x.disabledSkills.filter((n) => n !== name) : [...x.disabledSkills, name] }));
  const saveSkill = () => {
    if (!edit.name?.trim()) return;
    const skill = { name: edit.name.trim().toLowerCase().replace(/\s+/g, "-"), description: edit.description || "", content: edit.content || "", icon: edit.icon || "✨" };
    updateSettings((x) => ({ userSkills: [...x.userSkills.filter((k) => k.name !== edit.orig && k.name !== skill.name), skill] }));
    setEdit(null);
  };
  const runImport = async (apply) => {
    const ws = store.get().current?.workspace || s.lastWorkspace;
    if (!isDesktop) return toast("L'importazione da Claude Code/Cursor/VS Code funziona nell'app desktop", "error");
    try {
      const res = await invoke("engine:import", { root: ws, apply });
      setImportRes(res);
      if (apply) toast("Importazione completata nella cartella di lavoro (.cloudy/)", "success");
    } catch (e) {
      toast("Importazione: " + e.message, "error");
    }
  };
  useEffect(() => {
    if (importNow) runImport(importNow === "apply");
  }, [importNow]);
  return (
    <>
      <h2>Skills</h2>
      <p className="lead">Istruzioni specializzate che l'IA carica quando il compito corrisponde (tool use_skill), come le .cloudy/skills della CLI e le skill di Claude Code.</p>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <button className="btn small primary" onClick={() => setEdit({ name: "", description: "", content: "", icon: "✨" })}>
          <Icon name="plus" size={14} /> Nuova skill
        </button>
        <button className="btn small" onClick={() => fileIn.current?.click()}>
          <Icon name="upload" size={14} /> Importa .md
        </button>
        {isDesktop && (
          <button className="btn small" onClick={() => runImport(false)}>
            <Icon name="download" size={14} /> Importa da Claude Code / Cursor / VS Code
          </button>
        )}
        <input
          ref={fileIn}
          type="file"
          accept=".md,text/markdown"
          multiple
          hidden
          onChange={async (e) => {
            for (const f of e.target.files) {
              const sk = parseSkill(await f.text(), f.name.replace(/\.md$/i, "").replace(/^SKILL$/i, "skill"));
              if (sk) updateSettings((x) => ({ userSkills: [...x.userSkills.filter((k) => k.name !== sk.name), { ...sk, icon: "📄" }] }));
            }
            toast("Skill importate", "success");
            e.target.value = "";
          }}
        />
      </div>
      {importRes && (
        <div className="section">
          <h4>Anteprima importazione</h4>
          <pre className="out-box">{JSON.stringify(importRes, null, 2).slice(0, 4000)}</pre>
          <button className="btn small primary" onClick={() => runImport(true)}>
            Applica importazione
          </button>
        </div>
      )}
      {edit && (
        <div className="section">
          <div className="row">
            <input className="input" style={{ width: 70 }} value={edit.icon} onChange={(e) => setEdit({ ...edit, icon: e.target.value })} />
            <input className="input grow" placeholder="nome-della-skill" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </div>
          <input className="input" placeholder="Descrizione: quando usarla" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
          <textarea className="textarea mono" style={{ minHeight: 200 }} placeholder="# Istruzioni dettagliate in markdown…" value={edit.content} onChange={(e) => setEdit({ ...edit, content: e.target.value })} />
          <div className="dialog-actions">
            <button className="btn ghost" onClick={() => setEdit(null)}>
              Annulla
            </button>
            <button className="btn primary" onClick={saveSkill}>
              Salva skill
            </button>
          </div>
        </div>
      )}
      <div className="card-grid">
        {all.map((k, i) => {
          const enabled = !s.disabledSkills.includes(k.name);
          return (
            <div key={k.name} className={"card" + (enabled ? " on" : "")} style={{ animationDelay: Math.min(i, 30) * 15 + "ms" }}>
              <div className="c-head">
                <span className="c-ico">{k.icon || "✨"}</span>
                <div className="grow">
                  <div className="c-name mono" style={{ fontSize: 13 }}>{k.name}</div>
                  <div className="c-cat">{k.user ? "tua" : k.category || "integrata"}</div>
                </div>
                <Switch on={enabled} onChange={(v) => toggle(k.name, v)} />
              </div>
              <div className="c-desc">{k.description}</div>
              {k.user && (
                <div className="c-foot">
                  <button className="btn small" onClick={() => setEdit({ ...k, orig: k.name })}>
                    Modifica
                  </button>
                  <button className="btn small danger" onClick={() => updateSettings((x) => ({ userSkills: x.userSkills.filter((y) => y.name !== k.name) }))}>
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- appearance / data / about
const ACCENTS = ["#7c9cff", "#b38cff", "#38bdf8", "#34d399", "#fbbf24", "#fb7185", "#d97757", "#f2f3f5"];
function Appearance() {
  const s = useStore(store, (x) => x.settings);
  const set = (patch) => applyTheme(updateSettings(patch));
  const [gpu, setGpu] = useState(null);
  useEffect(() => {
    if (isDesktop) invoke("app:gpu").then(setGpu, () => {});
  }, []);
  const switchGpu = async (on) => {
    toast(on ? "Riattivo l'accelerazione hardware: Cloudy si riavvia…" : "Passo al rendering software: Cloudy si riavvia…");
    setGpu(await invoke("app:gpu", on));
  };
  return (
    <>
      <h2>Aspetto</h2>
      <p className="lead">Il design prima di tutto: scegli tema, colore e animazioni.</p>
      <div className="section">
        <Row t="Tema">
          <Seg value={s.theme} options={[["dark", "Scuro"], ["light", "Chiaro"], ["auto", "Sistema"]]} onChange={(v) => set({ theme: v })} />
        </Row>
        <Row t="Colore principale">
          <div className="swatches">
            {ACCENTS.map((c) => (
              <span key={c} className={"swatch" + (s.accent === c ? " on" : "")} style={{ background: c }} onClick={() => set({ accent: c })} />
            ))}
          </div>
        </Row>
        <Row t="Animazioni">
          <Seg value={s.motion} options={[["full", "Tutte"], ["reduced", "Ridotte"]]} onChange={(v) => set({ motion: v })} />
        </Row>
        <Row t="Dimensione del testo">
          <Seg value={s.fontScale} options={[[0.92, "Piccolo"], [1, "Normale"], [1.1, "Grande"], [1.2, "Molto grande"]]} onChange={(v) => set({ fontScale: v })} />
        </Row>
        <Row t="Mascotte Cloudee" d="Cloudee reagisce a quello che succede: ascolta, pensa, lavora, festeggia">
          <Switch on={s.mascot} onChange={(v) => set({ mascot: v })} />
        </Row>
        <Row t="Card sponsor" d="Gli sponsor tengono Cloudy gratuito (si apre solo con un clic, come nella CLI)">
          <Switch on={s.sponsor} onChange={(v) => set({ sponsor: v })} />
        </Row>
        {isDesktop && gpu && (
          <Row
            t="Accelerazione hardware"
            d={gpu.enabled ? "Usa la scheda video per animazioni fluide. Spegnila se vedi schermate nere o sfarfallii." : gpu.forced ? "Spenta dall'opzione --disable-gpu con cui è stato avviato Cloudy." : "Spenta: Cloudy disegna tutto via software (riattivala se hai aggiornato i driver)."}
          >
            <Switch on={gpu.enabled} onChange={(v) => !gpu.forced && switchGpu(v)} />
          </Row>
        )}
      </div>
    </>
  );
}

function Data() {
  const fileIn = useRef(null);
  return (
    <>
      <h2>Dati</h2>
      <p className="lead">Le conversazioni restano su questo dispositivo. Esportale per backup o per spostarle su un altro dispositivo (anche dal PC al telefono).</p>
      <div className="section">
        <div className="row wrap">
          <button className="btn" onClick={async () => saveAs(`cloudy-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await exportAll()), "application/json")}>
            <Icon name="download" /> Esporta conversazioni
          </button>
          <button className="btn" onClick={() => fileIn.current?.click()}>
            <Icon name="upload" /> Importa backup
          </button>
          <input
            ref={fileIn}
            type="file"
            accept=".json"
            hidden
            onChange={async (e) => {
              try {
                const n = await importAll(JSON.parse(await e.target.files[0].text()));
                toast(`${n} conversazioni importate`, "success");
              } catch (err) {
                toast("Backup non valido: " + err.message, "error");
              }
            }}
          />
        </div>
      </div>
      <div className="section">
        <h4>Zona pericolosa</h4>
        <button
          className="btn danger"
          onClick={async () => {
            if (!confirm("Eliminare tutte le conversazioni e le impostazioni da questo dispositivo?")) return;
            indexedDB.deleteDatabase("cloudy");
            localStorage.clear();
            location.reload();
          }}
        >
          <Icon name="trash" /> Cancella tutti i dati locali
        </button>
      </div>
    </>
  );
}

function About() {
  const [upd, setUpd] = useState(null);
  const check = async () => {
    try {
      const { body } = await httpJson("https://registry.npmjs.org/cloudy-cli/latest");
      setUpd(body.version);
    } catch {
      setUpd("?");
    }
  };
  return (
    <>
      <h2>Info</h2>
      <div className="section" style={{ justifyItems: "center", textAlign: "center" }}>
        <Cloudee mood="proud" size={110} follow />
        <div style={{ fontSize: 22, fontWeight: 750 }}>Cloudy Desktop {appInfo.version}</div>
        <div className="hint">
          {isDesktop ? `Desktop · ${osName}` : isAndroid ? "Android" : "Web"} · motore cloudy-cli {appInfo.engineVersion}
        </div>
        <div className="row wrap" style={{ justifyContent: "center" }}>
          <button className="btn small" onClick={check}>
            <Icon name="refresh" size={14} /> Controlla aggiornamenti di cloudy-cli
          </button>
          <button className="btn small" onClick={() => openExternal("https://cloudy.chat")}>
            cloudy.chat
          </button>
          <button className="btn small" onClick={() => openExternal("https://www.npmjs.com/package/cloudy-cli")}>
            cloudy-cli su npm
          </button>
        </div>
        {upd && <div className="hint">Ultima versione su npm: {upd} {upd === appInfo.engineVersion ? "— sei aggiornato ✓" : "— è disponibile una versione più recente"}</div>}
      </div>
      <div className="section">
        <h4>Crediti e licenze</h4>
        <div className="hint" style={{ lineHeight: 1.7 }}>
          Basato su <b>cloudy-cli 1.0.0</b> (MIT, © 2026 Cloudy): client, agente, host stdio, import e mascotte Cloudee sono quelli originali.
          <br />
          Claude è un marchio di Anthropic; l'integrazione usa la CLI ufficiale Claude Code e l'SDK @anthropic-ai/sdk.
          <br />
          Computer Linux: v86 (BSD-2) con kernel Linux 6.8 Buildroot (GPL-2). Interfaccia: React, marked, DOMPurify, highlight.js, xterm.js, Inter, JetBrains Mono.
          <br />
          Loghi dei modelli: proprietà dei rispettivi titolari, mostrati per identificare i modelli.
        </div>
      </div>
    </>
  );
}

export function Settings({ initial, importNow }) {
  const [sec, setSec] = useState(initial || "account");
  const C = { account: Account, claude: Claude, providers: Providers, agent: Agent, linux: Linux, connectors: Connectors, plugins: Plugins, skills: Skills, appearance: Appearance, data: Data, about: About }[sec];
  useEffect(() => {
    if (initial) setSec(initial);
  }, [initial]);
  return (
    <div className="settings">
      <nav className="settings-nav">
        <h3>Impostazioni</h3>
        {SECTIONS.map(([id, label, icon]) => (
          <button key={id} className={sec === id ? "active" : ""} onClick={() => setSec(id)}>
            <Icon name={icon} size={16} /> {label}
          </button>
        ))}
      </nav>
      <div className="settings-body" key={sec}>
        <C importNow={importNow} />
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons.jsx";
import { Cloudee } from "./Cloudee.jsx";
import { ModelLogo } from "./ModelPicker.jsx";
import { Settings } from "./Settings.jsx";
import { AppsLauncher } from "./apps/Launcher.jsx";
import { useStore } from "../lib/store.js";
import { closeDialog, store } from "../state/store.js";
import { allModels, claudeRoute, modelInfo, refreshClaudeModels } from "../state/models.js";
import { loginClaudeCode, loginWithBrowser, loginWithPassword } from "../state/init.js";
import { providerName } from "../providers/cloudy.js";
import { isDesktop, openExternal } from "../platform/native.js";
import { copyText } from "../lib/util.js";

function Dialog({ children, wide, onClose, className = "" }) {
  useEffect(() => {
    const esc = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={"dialog " + (wide ? "wide " : "") + className}>
        {onClose && (
          <button className="icon-btn close" onClick={onClose} title="Chiudi">
            <Icon name="x" />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- login
const PROVIDER_ICON = { google: "G", github: "", apple: "", "microsoft-entra-id": "⊞" };
function LoginDialog({ d }) {
  const providers = useStore(store, (s) => s.cloudy.providers);
  const [mode, setMode] = useState("choose"); // choose | pairing | email
  const [pair, setPair] = useState(null);
  const [err, setErr] = useState(d.reason || "");
  const [busy, setBusy] = useState(false);
  const ctrl = useRef(null);
  const email = useRef(null);
  const pass = useRef(null);
  const close = () => {
    ctrl.current?.abort();
    closeDialog();
  };

  const browser = async (provider = null) => {
    setMode("pairing");
    setErr("");
    ctrl.current = new AbortController();
    try {
      await loginWithBrowser(
        (url, code) => {
          setPair({ url, code });
          openExternal(url);
        },
        provider,
        ctrl.current.signal
      );
      closeDialog();
    } catch (e) {
      if (!ctrl.current.signal.aborted) {
        setErr(e.message);
        setMode("choose");
      }
    }
  };

  const submitEmail = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await loginWithPassword(email.current.value.trim(), pass.current.value);
      closeDialog();
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  };

  return (
    <Dialog onClose={close}>
      <div className="dialog-hero">
        <Cloudee mood={mode === "pairing" ? "searching" : err ? "confused" : "happy"} size={110} follow />
      </div>
      <h2 style={{ textAlign: "center" }}>Accedi a Cloudy</h2>
      <p className="lead" style={{ textAlign: "center" }}>Stesso account, modelli e quota del sito e della CLI: 25 messaggi e 70 crediti agente al giorno, gratis.</p>
      {err && (
        <div className="msg-error" style={{ marginBottom: 12 }}>
          <Icon name="alert" /> {err}
        </div>
      )}
      {mode === "choose" && (
        <div style={{ display: "grid", gap: 10 }}>
          <button className="btn primary block" onClick={() => browser(null)}>
            <Icon name="globe" /> Accedi con il browser (codice di abbinamento)
          </button>
          {providers.map((p) => (
            <button key={p} className="btn block" onClick={() => browser(p)}>
              <b style={{ width: 18 }}>{PROVIDER_ICON[p] || "•"}</b> Continua con {providerName(p)}
            </button>
          ))}
          <button className="btn ghost block" onClick={() => setMode("email")}>
            <Icon name="key" /> Email e password
          </button>
          <div className="hint" style={{ textAlign: "center" }}>
            Non hai un account?{" "}
            <a href="#" onClick={(e) => (e.preventDefault(), openExternal("https://cloudy.chat/signup"))}>
              Registrati gratis
            </a>{" "}
            · Puoi anche provare senza account.
          </div>
        </div>
      )}
      {mode === "pairing" && (
        <div style={{ display: "grid", gap: 12, justifyItems: "center", textAlign: "center" }}>
          {pair ? (
            <>
              <div className="hint">Approva questo dispositivo nella pagina che si è aperta. Il tuo codice:</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 34, fontWeight: 700, letterSpacing: 4, padding: "10px 20px", borderRadius: 16, background: "var(--surface-2)", border: "1px solid var(--border-strong)" }}>{pair.code}</div>
              <div className="row">
                <button className="btn small" onClick={() => openExternal(pair.url)}>
                  <Icon name="external" size={14} /> Riapri la pagina
                </button>
                <button className="btn small" onClick={() => copyText(pair.url)}>
                  <Icon name="copy" size={14} /> Copia link
                </button>
              </div>
              <div className="row hint">
                <span className="spinner" /> In attesa dell'approvazione…
              </div>
            </>
          ) : (
            <div className="row hint">
              <span className="spinner" /> Creo il codice…
            </div>
          )}
          <button className="btn ghost small" onClick={() => (ctrl.current?.abort(), setMode("choose"))}>
            Annulla
          </button>
        </div>
      )}
      {mode === "email" && (
        <form onSubmit={submitEmail} style={{ display: "grid", gap: 12 }}>
          <label className="field">
            Email
            <input ref={email} className="input" type="email" required autoFocus autoComplete="email" />
          </label>
          <label className="field">
            Password
            <input ref={pass} className="input" type="password" required autoComplete="current-password" />
          </label>
          <div className="dialog-actions">
            <button type="button" className="btn ghost" onClick={() => setMode("choose")}>
              Indietro
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? <span className="spinner" /> : <Icon name="check" />} Accedi
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- limits / switch model
function ModelChoiceList({ exclude, onPick, onlyGroups }) {
  const models = allModels().filter((m) => m.ref !== exclude && m.available && (!onlyGroups || onlyGroups.includes(m.group === "Claude" ? "Claude" : m.group === "Cloudy" ? "Cloudy" : "custom")));
  const claude = models.filter((m) => m.group === "Claude");
  const others = models.filter((m) => m.group !== "Claude");
  return (
    <div>
      {claude.length > 0 && <div className="mp-group" style={{ color: "var(--claude)" }}>✳ Modelli Claude</div>}
      {claude.map((m, i) => (
        <button key={m.ref} className="model-choice" style={{ "--mc": m.accent, animationDelay: i * 50 + "ms" }} onClick={() => onPick(m.ref)}>
          <ModelLogo m={m} size={36} />
          <span className="grow">
            <div className="name">{m.name}</div>
            <div className="sub">
              {m.detail} · via {m.via === "code" ? "Claude Code" : "chiave API"}
            </div>
          </span>
          <Icon name="chevronRight" />
        </button>
      ))}
      {others.length > 0 && <div className="mp-group">Altri modelli</div>}
      {others.map((m, i) => (
        <button key={m.ref} className="model-choice" style={{ "--mc": m.accent, animationDelay: (claude.length + i) * 50 + "ms" }} onClick={() => onPick(m.ref)}>
          <ModelLogo m={m} size={36} />
          <span className="grow">
            <div className="name">{m.name}</div>
            <div className="sub">
              {m.group} · {m.detail}
            </div>
          </span>
          <Icon name="chevronRight" />
        </button>
      ))}
    </div>
  );
}

function LimitsDialog({ d }) {
  const claudeOk = !!claudeRoute();
  const from = modelInfo(d.fromRef);
  const quota = d.type === "limits";
  return (
    <Dialog onClose={() => d.resolve(null)}>
      <div className="dialog-hero">
        <Cloudee mood={quota ? "drowsy" : "confused"} size={110} />
      </div>
      <h2 style={{ textAlign: "center" }}>{quota ? (d.route === "claude-code" ? "Limite di Claude raggiunto" : "Hai finito i messaggi gratuiti di Cloudy") : "Vuoi provare con un altro modello?"}</h2>
      <p className="lead" style={{ textAlign: "center" }}>
        {d.message}
        <br />
        <span className="hint">Non cambio mai modello da solo: scegli tu con cosa continuare. La conversazione (testo e file) viene passata per intero al nuovo modello.</span>
      </p>
      <ModelChoiceList exclude={d.fromRef} onPick={(ref) => d.resolve(ref)} />
      {!claudeOk && (
        <div className="section" style={{ marginTop: 6 }}>
          <h4>
            <span style={{ color: "var(--claude)" }}>✳</span> Collega Claude per continuare con Opus, Sonnet, Haiku e Fable
          </h4>
          <div className="hint">Usa il tuo abbonamento Claude tramite Claude Code oppure una chiave API Anthropic.</div>
          <button className="btn claude" onClick={() => (d.resolve(null), store.set({ dialog: { type: "settings", section: "claude" } }))}>
            Collega Claude
          </button>
        </div>
      )}
      <div className="dialog-actions">
        <button className="btn ghost" onClick={() => d.resolve(null)}>
          Resta su {from.name}
        </button>
      </div>
    </Dialog>
  );
}

function ModelReplacedDialog({ d }) {
  return (
    <Dialog onClose={() => d.resolve(null)}>
      <div className="dialog-hero">
        <Cloudee mood="surprised" size={100} />
      </div>
      <h2 style={{ textAlign: "center" }}>{d.from.name} non è più disponibile</h2>
      <p className="lead" style={{ textAlign: "center" }}>
        {d.to ? (
          <>
            È stato sostituito da <b style={{ color: "var(--claude)" }}>{d.to.name}</b>. Vuoi continuare questa conversazione con il nuovo modello?
          </>
        ) : (
          "Scegli con quale modello continuare."
        )}
      </p>
      {d.to && (
        <button className="model-choice" style={{ "--mc": "var(--claude)" }} onClick={() => d.resolve(d.to.ref)}>
          <ModelLogo m={d.to} size={40} />
          <span className="grow">
            <div className="name">Passa a {d.to.name}</div>
            <div className="sub">{d.to.detail}</div>
          </span>
          <Icon name="chevronRight" />
        </button>
      )}
      <details>
        <summary className="hint" style={{ cursor: "pointer", margin: "8px 0" }}>
          Oppure scegli un altro modello
        </summary>
        <ModelChoiceList exclude={d.from.ref} onPick={(ref) => d.resolve(ref)} />
      </details>
      <div className="dialog-actions">
        <button className="btn ghost" onClick={() => d.resolve(null)}>
          Annulla
        </button>
      </div>
    </Dialog>
  );
}

function ClaudeConnectDialog({ d }) {
  const claude = useStore(store, (s) => s.claude);
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    await refreshClaudeModels({ silent: true });
    setBusy(false);
    if (claudeRoute()) d.resolve("retry");
  };
  return (
    <Dialog onClose={() => d.resolve(null)}>
      <h2>
        <span style={{ color: "var(--claude)" }}>✳</span> Collega Claude
      </h2>
      <p className="lead">{d.reason || "Per usare i modelli Claude collega Claude Code (il tuo abbonamento Claude Pro/Max) oppure una chiave API Anthropic."}</p>
      <div className="section">
        <h4>Claude Code {claude.code?.installed ? <span className="chip ok">trovato {claude.code.version}</span> : <span className="chip warn">non trovato</span>}</h4>
        {!isDesktop ? (
          <div className="hint">Claude Code funziona nell'app desktop. Su Android usa una chiave API Anthropic.</div>
        ) : claude.code?.installed ? (
          <div className="row wrap">
            <span className="hint grow">{claude.code.loggedIn === false ? "Non hai effettuato l'accesso a Claude Code." : "Pronto all'uso."}</span>
            {claude.code.loggedIn === false && (
              <button className="btn claude small" onClick={loginClaudeCode}>
                Accedi a Claude
              </button>
            )}
          </div>
        ) : (
          <div className="hint">
            Installa Claude Code (richiede Node.js): <code>npm install -g @anthropic-ai/claude-code</code>, poi accedi con <code>claude</code>. Oppure indica il percorso in Impostazioni → Claude.
          </div>
        )}
      </div>
      <div className="dialog-actions">
        <button className="btn" onClick={() => (d.resolve(null), store.set({ dialog: { type: "settings", section: "claude" } }))}>
          <Icon name="key" /> Usa una chiave API
        </button>
        <button className="btn claude" onClick={retry} disabled={busy}>
          {busy ? <span className="spinner" /> : <Icon name="refresh" />} Ho collegato, riprova
        </button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- small dialogs
function OutputDialog({ d }) {
  const done = () => (d.resolve ? d.resolve(true) : closeDialog());
  return (
    <Dialog onClose={done}>
      <h2>{d.title}</h2>
      <pre className="out-box" style={{ maxHeight: "60vh" }}>{d.text}</pre>
      {d.code !== undefined && d.code !== null && <div className="hint">Codice di uscita: {d.code}</div>}
      <div className="dialog-actions">
        <button className="btn" onClick={() => copyText(d.text)}>
          <Icon name="copy" /> Copia
        </button>
        <button className="btn primary" onClick={done}>
          OK
        </button>
      </div>
    </Dialog>
  );
}

function PromptDialog({ d }) {
  const ref = useRef(null);
  return (
    <Dialog onClose={() => d.resolve(null)}>
      <h2>{d.title}</h2>
      <form onSubmit={(e) => (e.preventDefault(), d.resolve(ref.current.value.trim() || null))} style={{ display: "grid", gap: 12, marginTop: 12 }}>
        <label className="field">
          {d.label}
          <input ref={ref} className="input" defaultValue={d.value || ""} autoFocus />
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={() => d.resolve(null)}>
            Annulla
          </button>
          <button className="btn primary">OK</button>
        </div>
      </form>
    </Dialog>
  );
}

const KEYS = [
  ["Invio", "invia"],
  ["Shift + Invio", "a capo"],
  ["↑ / ↓", "richiama i messaggi inviati"],
  ["Ctrl + O", "scegli il modello"],
  ["Ctrl + N", "nuova conversazione"],
  ["Ctrl + K", "palette dei comandi"],
  ["Ctrl + T", "quota"],
  ["Ctrl + W", "account"],
  ["Ctrl + L", "accedi"],
  ["Ctrl + U", "svuota il messaggio"],
  ["Ctrl + ,", "impostazioni"],
  ["Tab", "Build ↔ Piano (Code/Cowork)"],
  ["Esc", "interrompi la risposta"],
];
function HelpDialog({ d }) {
  return (
    <Dialog onClose={() => d.resolve(true)} wide>
      <h2>Aiuto rapido</h2>
      <p className="lead">Tutti i comandi della CLI originale sono qui, più quelli dell'app. Scrivi / nel messaggio per vederli.</p>
      <div className="card-grid">
        {KEYS.map(([k, v]) => (
          <div key={k} className="row">
            <span className="kbd">{k}</span> <span className="muted">{v}</span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

function ApprovalDialog({ a }) {
  const isCmd = a.args?.command;
  return (
    <Dialog>
      <div className="row" style={{ marginBottom: 8 }}>
        <Cloudee mood="suspicious" size={64} />
        <div>
          <h2 style={{ margin: 0 }}>Posso procedere?</h2>
          <div className="hint">L'agente vuole usare lo strumento {a.tool}</div>
        </div>
      </div>
      <pre className="out-box">{isCmd ? `$ ${a.args.command}` : JSON.stringify(a.args, null, 2).slice(0, 3000)}</pre>
      {a.description && <div className="hint" style={{ marginTop: 8 }}>{String(a.description).slice(0, 300)}</div>}
      <div className="dialog-actions">
        <button className="btn danger" onClick={() => a.resolve(false)}>
          <Icon name="x" /> Rifiuta
        </button>
        <button className="btn" onClick={() => a.resolve("always")}>
          Consenti sempre in questa chat
        </button>
        <button className="btn primary" autoFocus onClick={() => a.resolve(true)}>
          <Icon name="check" /> Consenti
        </button>
      </div>
    </Dialog>
  );
}

export function Dialogs() {
  const d = useStore(store, (s) => s.dialog);
  const approvals = useStore(store, (s) => s.approvals);
  if (approvals.length) return <ApprovalDialog a={approvals[0]} />;
  if (!d) return null;
  switch (d.type) {
    case "login":
      return <LoginDialog d={d} />;
    case "limits":
    case "switch-model":
      return <LimitsDialog d={d} />;
    case "model-replaced":
      return <ModelReplacedDialog d={d} />;
    case "claude-connect":
      return <ClaudeConnectDialog d={{ resolve: closeDialog, ...d }} />;
    case "output":
      return <OutputDialog d={d} />;
    case "prompt":
      return <PromptDialog d={d} />;
    case "help":
      return <HelpDialog d={{ resolve: closeDialog, ...d }} />;
    case "settings":
      return (
        <Dialog wide onClose={closeDialog} className="settings-dialog">
          <Settings initial={d.section} importNow={d.importNow} />
        </Dialog>
      );
    case "apps":
      return (
        <Dialog wide onClose={closeDialog}>
          <AppsLauncher />
        </Dialog>
      );
    default:
      return null;
  }
}

export function Toasts() {
  const toasts = useStore(store, (s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={"toast " + t.kind}>
          <Icon name={t.kind === "success" ? "check" : t.kind === "error" ? "alert" : "info"} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

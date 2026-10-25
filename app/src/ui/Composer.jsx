import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icons.jsx";
import { ModelPicker } from "./ModelPicker.jsx";
import { useStore } from "../lib/store.js";
import { askDialog, getSettings, store, toast, updateSettings } from "../state/store.js";
import { composerHistory, sendMessage, setComposerHistory, stopTurn } from "../state/send.js";
import { recall, stopBrowsing } from "../../../original/cloudy-cli/src/history.js";
import { modelInfo, refreshUsage } from "../state/models.js";
import { newConversation, setCurrentField } from "../state/conversations.js";
import { pluginCommands } from "../state/plugins.js";
import { adTargetUrl, usageLines } from "../providers/cloudy.js";
import { fmtBytes, readFileAsAttachment } from "../lib/util.js";
import { isDesktop, openExternal, pickFolder } from "../platform/native.js";
import { switchMode } from "./Titlebar.jsx";

// The original TUI's command table (src/tui.js COMMANDS), plus the GUI's own.
const COMMANDS = [
  ["help", "mostra l'aiuto e le scorciatoie"],
  ["login", "accedi a Cloudy"],
  ["mode", "build modifica, plan legge soltanto (Tab alterna)"],
  ["access", "readonly | ask | full — cosa può fare l'agente senza chiedere"],
  ["model", "scegli un modello"],
  ["effort", "sforzo di ragionamento: low | medium | high | max"],
  ["skills", "le skill che l'agente conosce"],
  ["mcps", "connettori MCP e il loro stato"],
  ["sponsor", "on | off — mostra/nascondi la card sponsor"],
  ["import", "importa skill e server da Claude Code, Cursor, VS Code"],
  ["usage", "mostra la quota"],
  ["settings", "account, modelli e server"],
  ["whoami", "account connesso"],
  ["new", "nuova conversazione"],
  ["claude", "modelli Claude e collegamento Claude Code"],
  ["plugins", "marketplace dei plugin"],
  ["apps", "applicazioni"],
  ["linux", "apri il computer Linux di Cloudy"],
  ["code", "passa alla modalità Code"],
  ["cowork", "passa alla modalità Cowork"],
  ["chat", "passa alla modalità Chat"],
  ["quit", "chiudi l'app"],
];

const EFFORTS = ["low", "medium", "high", "max"];
const EFFORT_LABEL = { low: "Rapido", medium: "Medio", high: "Alto", max: "Massimo" };
const ACCESS = [
  ["readonly", "Sola lettura", "legge e cerca — non modifica file né esegue comandi"],
  ["ask", "Chiedi", "legge liberamente, chiede prima di scrivere ed eseguire"],
  ["full", "Accesso completo", "legge, scrive ed esegue comandi senza chiedere"],
];

export function Composer({ onTyping }) {
  const conv = useStore(store, (s) => s.current);
  useStore(store, (s) => s.rev);
  const streaming = useStore(store, (s) => !!(s.current && s.streaming[s.current.id]));
  const ad = useStore(store, (s) => s.cloudy.ad);
  const cloudyBase = useStore(store, (s) => s.settings.cloudyBase);
  const sponsorOn = useStore(store, (s) => s.settings.sponsor && !s.sponsorHidden);
  const [text, setText] = useState("");
  const [atts, setAtts] = useState([]);
  const [focus, setFocus] = useState(false);
  const [drag, setDrag] = useState(false);
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState(null); // effort | access
  const [hl, setHl] = useState(0);
  const ta = useRef(null);
  const fileIn = useRef(null);
  const mode = conv?.mode || "chat";
  const info = modelInfo(conv?.model);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 260) + "px";
  }, [text]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        setPicker(true);
      }
    };
    const onFocus = () => ta.current?.focus();
    window.addEventListener("keydown", onKey);
    window.addEventListener("cloudy:focus-composer", onFocus);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("cloudy:focus-composer", onFocus);
    };
  }, []);

  useEffect(() => ta.current?.focus(), [conv?.id]);

  const slash = text.startsWith("/") && !text.includes("\n") ? text.slice(1).split(" ")[0].toLowerCase() : null;
  const allCommands = useMemo(() => [...COMMANDS.map(([name, desc]) => ({ name, desc })), ...pluginCommands().map((c) => ({ name: c.name, desc: c.description, plugin: c }))], [slash !== null]);
  const matches = slash !== null ? allCommands.filter((c) => c.name.startsWith(slash)).slice(0, 12) : [];

  const addFiles = async (files) => {
    const list = [];
    for (const f of files) {
      if (f.size > 25 * 1024 * 1024) {
        toast(`${f.name} è troppo grande (max 25 MB)`, "error");
        continue;
      }
      list.push(await readFileAsAttachment(f));
    }
    setAtts((a) => [...a, ...list]);
  };

  const runCommand = async (raw) => {
    const [cmd, ...restArr] = raw.slice(1).split(" ");
    const arg = restArr.join(" ").trim();
    const c = cmd.toLowerCase();
    const plugin = allCommands.find((x) => x.name === c && x.plugin);
    if (plugin) return sendMessage(plugin.plugin.prompt.replace("{input}", arg || "(vedi contesto)"), atts);
    switch (c) {
      case "help":
        return askDialog({ type: "help" });
      case "login":
        return store.set({ dialog: { type: "login" } });
      case "model":
        return setPicker(true);
      case "new":
        return newConversation(mode);
      case "mode": {
        const next = arg === "plan" || arg === "build" ? arg : conv.agentMode === "plan" ? "build" : "plan";
        setCurrentField("agentMode", next);
        return toast(next === "plan" ? "Modalità Piano: l'agente legge e propone, non modifica nulla" : "Modalità Build: l'agente modifica file ed esegue comandi");
      }
      case "access":
        if (ACCESS.some(([id]) => id === arg)) return setCurrentField("access", arg);
        return setMenu("access");
      case "effort":
        if (EFFORTS.includes(arg)) return setCurrentField("effort", arg);
        return setMenu("effort");
      case "skills":
        return store.set({ dialog: { type: "settings", section: "skills" } });
      case "mcps":
        return store.set({ dialog: { type: "settings", section: "connectors" } });
      case "plugins":
        return store.set({ dialog: { type: "settings", section: "plugins" } });
      case "claude":
        return store.set({ dialog: { type: "settings", section: "claude" } });
      case "import":
        return store.set({ dialog: { type: "settings", section: "skills", importNow: arg === "apply" ? "apply" : "preview" } });
      case "sponsor":
        if (arg === "off") store.set({ sponsorHidden: true });
        else if (arg === "on") store.set({ sponsorHidden: false });
        else store.set((s) => ({ sponsorHidden: !s.sponsorHidden }));
        return;
      case "usage":
        await refreshUsage();
        return askDialog({ type: "output", title: "Quota Cloudy", text: usageLines(store.get().cloudy.usage).join("\n") });
      case "whoami": {
        const u = store.get().cloudy.user;
        return askDialog({ type: "output", title: "Account", text: u ? `${u.email} — piano gratuito` : "non hai effettuato l'accesso — usa /login" });
      }
      case "settings":
        return store.set({ dialog: { type: "settings" } });
      case "apps":
        return store.set({ dialog: { type: "apps" } });
      case "linux":
        return store.set({ panel: "linux" });
      case "chat":
      case "code":
      case "cowork":
        return switchMode(c);
      case "quit":
        return isDesktop ? window.cloudyNative.invoke("win:close") : null;
      default:
        toast(`Comando sconosciuto: /${c} — scrivi /help`, "error");
    }
  };

  const submit = async () => {
    if (streaming) return;
    const t = text;
    if (t.startsWith("/") && !t.includes("\n")) {
      setText("");
      await runCommand(t.trim());
      return;
    }
    if (!t.trim() && !atts.length) return;
    const files = atts;
    setText("");
    setAtts([]);
    setComposerHistory(stopBrowsing(composerHistory));
    await sendMessage(t, files);
  };

  const onKeyDown = (e) => {
    if (matches.length) {
      if (e.key === "ArrowDown") return e.preventDefault(), setHl((h) => (h + 1) % matches.length);
      if (e.key === "ArrowUp") return e.preventDefault(), setHl((h) => (h - 1 + matches.length) % matches.length);
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && matches[hl] && slash !== matches[hl].name)) {
        e.preventDefault();
        setText("/" + matches[hl].name + " ");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      return submit();
    }
    if (e.key === "Escape" && streaming) return stopTurn();
    if (e.key === "Tab" && !text && mode !== "chat") {
      e.preventDefault();
      return runCommand("/mode");
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "u") {
      e.preventDefault();
      return setText("");
    }
    // ↑ / ↓ walk what was sent — original/cloudy-cli/src/history.js rules.
    const el = e.currentTarget;
    if ((e.key === "ArrowUp" && el.selectionStart === 0 && el.selectionEnd === 0) || (e.key === "ArrowDown" && el.selectionStart === text.length && composerHistory.index !== null)) {
      // The first ↑ stashes what is being typed (recall saves `draft`).
      const h = composerHistory.index === null ? { ...composerHistory, draft: text } : composerHistory;
      const next = recall(h, e.key === "ArrowUp" ? "up" : "down");
      if (next !== h) {
        e.preventDefault();
        setComposerHistory(next);
        setText(next.draft ?? "");
      }
    }
  };

  const pickWorkspace = async () => {
    if (isDesktop) {
      const dir = await pickFolder();
      if (dir) setCurrentField("workspace", dir);
    } else {
      const name = await askDialog({ type: "prompt", title: "Cartella di progetto", label: "Nome del progetto (verrà creato nella memoria dell'app)", value: conv.workspace || "Progetto" });
      if (name) setCurrentField("workspace", name.replace(/[\\/:*?"<>|]/g, "_"));
    }
  };

  const showAd = sponsorOn && ad && String(conv?.model || "").startsWith("cloudy:");

  return (
    <div className="composer-wrap">
      <div className="composer-col">
        {showAd && (
          <div className="sponsor" onClick={() => openExternal(adTargetUrl(cloudyBase, ad.link))} title="Apri lo sponsor (clic)">
            <span className="label">Sponsor</span>
            <span className="grow">
              <span className="hl">{ad.headline || ad.content}</span> {ad.body && <span className="muted">— {ad.body}</span>}
            </span>
            <span className="cta">{ad.ctaLabel || "apri"}</span>
            <button className="mini-btn" title="Nascondi per questa sessione" onClick={(e) => (e.stopPropagation(), store.set({ sponsorHidden: true }))}>
              <Icon name="x" size={14} />
            </button>
          </div>
        )}
        {matches.length > 0 && (
          <div className="popover slash-menu">
            {matches.map((c, i) => (
              <button key={c.name + i} className={"menu-item" + (i === hl ? " hl" : "")} onMouseEnter={() => setHl(i)} onClick={() => (setText("/" + c.name + " "), ta.current?.focus())}>
                <span className="cmd">/{c.name}</span>
                <span className="sub grow">{c.desc}</span>
                {c.plugin && <span className="badge">{c.plugin.icon} {c.plugin.plugin}</span>}
              </button>
            ))}
          </div>
        )}
        <div
          className={"composer" + (focus ? " focus" : "") + (drag ? " dragging" : "")}
          onDragOver={(e) => (e.preventDefault(), setDrag(true))}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            addFiles([...e.dataTransfer.files]);
          }}
        >
          <div className="composer-inner">
            {!!atts.length && (
              <div className="attach-row" style={{ justifyContent: "flex-start" }}>
                {atts.map((a) => (
                  <div className="attach-thumb" key={a.id}>
                    {a.kind === "image" ? (
                      <img src={`data:${a.mime};base64,${a.data}`} alt={a.name} />
                    ) : (
                      <div className="attach-file">
                        <Icon name="file" size={16} />
                        <span className="name">{a.name}</span>
                        <span className="muted">{fmtBytes(a.size)}</span>
                      </div>
                    )}
                    <button className="rm" onClick={() => setAtts((x) => x.filter((y) => y.id !== a.id))}>
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={ta}
              rows={1}
              value={text}
              placeholder={mode === "code" ? "Descrivi cosa costruire o correggere…  (/ per i comandi)" : mode === "cowork" ? "Affida un compito a Cloudy…  (/ per i comandi)" : "Chiedi qualsiasi cosa…  (/ per i comandi)"}
              onChange={(e) => {
                setText(e.target.value);
                setHl(0);
                onTyping?.();
              }}
              onKeyDown={onKeyDown}
              onFocus={() => setFocus(true)}
              onBlur={() => setFocus(false)}
              onPaste={(e) => {
                const files = [...(e.clipboardData?.files || [])];
                if (files.length) {
                  e.preventDefault();
                  addFiles(files);
                }
              }}
            />
            <div className="composer-bar">
              <button className="icon-btn" title="Allega file o immagini" onClick={() => fileIn.current?.click()}>
                <Icon name="paperclip" />
              </button>
              <input ref={fileIn} type="file" multiple hidden onChange={(e) => (addFiles([...e.target.files]), (e.target.value = ""))} />
              <div style={{ position: "relative" }}>
                <button className={"pill" + (info.missing ? " warn" : "")} onClick={() => setPicker((p) => !p)} title="Scegli il modello (Ctrl+O)">
                  {info.logo?.src ? <img src={info.logo.src} className={info.logo.invertOnLight ? "inv" : ""} alt="" /> : <b>{info.logo?.monogram}</b>}
                  <span className="name">{info.name}</span>
                  <Icon name="chevron" size={13} />
                </button>
                {picker && <ModelPicker onClose={() => setPicker(false)} />}
              </div>
              <div style={{ position: "relative" }}>
                <button className="pill" onClick={() => setMenu(menu === "effort" ? null : "effort")} title="Sforzo di ragionamento">
                  <Icon name="zap" size={13} /> <span className="hide-mobile">{EFFORT_LABEL[conv?.effort || getSettings().effort]}</span>
                </button>
                {menu === "effort" && (
                  <Menu onClose={() => setMenu(null)}>
                    {EFFORTS.map((e) => (
                      <button key={e} className={"menu-item" + ((conv?.effort || getSettings().effort) === e ? " hl" : "")} onClick={() => (setCurrentField("effort", e), updateSettings({ effort: e }), setMenu(null))}>
                        <Icon name="zap" size={14} /> {EFFORT_LABEL[e]} <span className="sub">({e})</span>
                      </button>
                    ))}
                  </Menu>
                )}
              </div>
              {mode !== "chat" && (
                <>
                  <button className="pill" onClick={pickWorkspace} title="Cartella di lavoro">
                    <Icon name="folder" size={13} /> <span className="name">{conv?.workspace ? conv.workspace.split(/[\\/]/).filter(Boolean).pop() : "Scegli cartella"}</span>
                  </button>
                  <button className="pill" onClick={() => runCommand("/mode")} title="Tab: alterna Build / Piano">
                    <Icon name={conv?.agentMode === "plan" ? "eye" : "wand"} size={13} /> {conv?.agentMode === "plan" ? "Piano" : "Build"}
                  </button>
                  <div style={{ position: "relative" }}>
                    <button className="pill" onClick={() => setMenu(menu === "access" ? null : "access")} title="Livello di accesso">
                      <Icon name={conv?.access === "full" ? "zap" : conv?.access === "readonly" ? "eye" : "shield"} size={13} /> <span className="hide-mobile">{ACCESS.find(([id]) => id === (conv?.access || "ask"))?.[1]}</span>
                    </button>
                    {menu === "access" && (
                      <Menu onClose={() => setMenu(null)}>
                        {ACCESS.map(([id, label, hint]) => (
                          <button key={id} className={"menu-item" + (conv?.access === id ? " hl" : "")} onClick={() => (setCurrentField("access", id), setMenu(null))}>
                            <Icon name={id === "full" ? "zap" : id === "readonly" ? "eye" : "shield"} size={14} />
                            <span className="grow">
                              {label}
                              <div className="sub">{hint}</div>
                            </span>
                          </button>
                        ))}
                      </Menu>
                    )}
                  </div>
                </>
              )}
              <span className="grow" />
              {streaming ? (
                <button className="send-btn stop" onClick={() => stopTurn()} title="Interrompi (Esc)">
                  <Icon name="stop" size={16} />
                </button>
              ) : (
                <button className="send-btn" disabled={!text.trim() && !atts.length} onClick={submit} title="Invia (Invio)">
                  <Icon name="send" size={18} stroke={2.2} />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="composer-foot hide-mobile">
          <span>
            <span className="kbd">Invio</span> invia · <span className="kbd">Shift+Invio</span> a capo · <span className="kbd">/</span> comandi · <span className="kbd">↑</span> cronologia · <span className="kbd">Ctrl+O</span> modello
          </span>
          <span>Cloudy può sbagliare: verifica le risposte importanti.</span>
        </div>
      </div>
    </div>
  );
}

function Menu({ children, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const off = (e) => !ref.current?.contains(e.target) && onClose();
    setTimeout(() => window.addEventListener("pointerdown", off), 0);
    return () => window.removeEventListener("pointerdown", off);
  }, [onClose]);
  return (
    <div ref={ref} className="popover" style={{ bottom: "calc(100% + 8px)", left: 0, minWidth: 260 }}>
      {children}
    </div>
  );
}

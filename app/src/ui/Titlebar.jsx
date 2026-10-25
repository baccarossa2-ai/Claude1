import { useLayoutEffect, useRef, useState } from "react";
import { Cloudee } from "./Cloudee.jsx";
import { Icon } from "./Icons.jsx";
import { store, getSettings, updateSettings } from "../state/store.js";
import { useStore } from "../lib/store.js";
import { newConversation, setCurrentField } from "../state/conversations.js";
import { isDesktop, osName } from "../platform/native.js";

const MODES = [
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "code", label: "Code", icon: "code" },
  { id: "cowork", label: "Cowork", icon: "cowork" },
];

export function switchMode(mode) {
  const cur = store.get().current;
  if (cur && !cur.messages.length) {
    setCurrentField("mode", mode);
    if (mode !== "chat" && !cur.workspace) setCurrentField("workspace", getSettings().lastWorkspace || (isDesktop ? null : "Progetto"));
    if (mode === "cowork") store.set({ panel: "tasks" });
  } else newConversation(mode);
}

export function Titlebar({ mood, onMascot, onMenu }) {
  const current = useStore(store, (s) => s.current);
  useStore(store, (s) => s.rev);
  const panel = useStore(store, (s) => s.panel);
  const linuxOn = useStore(store, (s) => s.linuxStatus === "ready");
  const mode = current?.mode || "chat";
  const tabs = useRef(null);
  const [ind, setInd] = useState({ left: 3, width: 60 });

  useLayoutEffect(() => {
    const el = tabs.current?.querySelector(`[data-mode="${mode}"]`);
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth });
  }, [mode]);

  const toggle = (p) => store.set((s) => ({ panel: s.panel === p ? null : p }));

  return (
    <header className="titlebar">
      <button className="icon-btn show-mobile" onClick={onMenu} title="Menu">
        <Icon name="menu" />
      </button>
      <button className="icon-btn hide-mobile" onClick={() => updateSettings((s) => ({ sidebarOpen: !s.sidebarOpen }))} title="Mostra/nascondi barra laterale">
        <Icon name="sidebar" />
      </button>
      <div className="brand">
        <Cloudee mood={mood} size={30} follow onClick={onMascot} title="Cloudee" />
        <span className="brand-name">Cloudy</span>
        <span className="brand-badge hide-mobile">DESKTOP</span>
      </div>
      <div className="spacer" />
      <nav className="mode-tabs" ref={tabs}>
        <span className="mode-indicator" style={{ left: ind.left, width: ind.width }} />
        {MODES.map((m) => (
          <button key={m.id} data-mode={m.id} className={"mode-tab" + (mode === m.id ? " active" : "")} onClick={() => switchMode(m.id)} title={m.label}>
            <Icon name={m.icon} size={15} />
            <span>{m.label}</span>
          </button>
        ))}
      </nav>
      <div className="spacer" />
      <button className={"icon-btn" + (panel === "linux" ? " active" : "")} onClick={() => toggle("linux")} title="Computer Linux di Cloudy">
        <Icon name="terminal" />
        {linuxOn && <span className="dot" />}
      </button>
      <button className={"icon-btn hide-mobile" + (panel === "artifacts" ? " active" : "")} onClick={() => toggle("artifacts")} title="Artefatti">
        <Icon name="layers" />
      </button>
      {mode !== "chat" && (
        <button className={"icon-btn hide-mobile" + (panel === "files" ? " active" : "")} onClick={() => toggle("files")} title="File della cartella di lavoro">
          <Icon name="folder" />
        </button>
      )}
      <button className="icon-btn" onClick={() => store.set({ dialog: { type: "apps" } })} title="Applicazioni">
        <Icon name="apps" />
      </button>
      <button className="icon-btn" onClick={() => store.set({ dialog: { type: "settings" } })} title="Impostazioni">
        <Icon name="settings" />
      </button>
      {osName === "linux" && isDesktop && <WindowButtons />}
    </header>
  );
}

function WindowButtons() {
  const ctl = (ch) => window.cloudyNative.invoke(ch);
  return (
    <span className="row" style={{ gap: 2, marginLeft: 6 }}>
      <button className="icon-btn" onClick={() => ctl("win:minimize")} title="Riduci">
        <Icon name="minus" size={16} />
      </button>
      <button className="icon-btn" onClick={() => ctl("win:toggleMaximize")} title="Ingrandisci">
        <Icon name="maximize" size={14} />
      </button>
      <button className="icon-btn" onClick={() => ctl("win:close")} title="Chiudi">
        <Icon name="x" size={16} />
      </button>
    </span>
  );
}

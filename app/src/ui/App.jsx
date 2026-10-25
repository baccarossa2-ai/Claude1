import { useEffect, useMemo, useRef, useState } from "react";
import { Titlebar } from "./Titlebar.jsx";
import { Sidebar } from "./Sidebar.jsx";
import { Chat } from "./Chat.jsx";
import { Composer } from "./Composer.jsx";
import { SidePanel } from "./SidePanel.jsx";
import { Dialogs, Toasts } from "./Dialogs.jsx";
import { Splash } from "./Splash.jsx";
import { WindowLayer, openApp } from "./apps/Windows.jsx";
import { APPS } from "./apps/registry.jsx";
import { Icon } from "./Icons.jsx";
import { useStore } from "../lib/store.js";
import { askDialog, store, updateSettings } from "../state/store.js";
import { newConversation, openConversation } from "../state/conversations.js";
import { refreshUsage } from "../state/models.js";
import { usageLines } from "../providers/cloudy.js";
import { linux } from "../linux/vm.js";
import { osName } from "../platform/native.js";
import { switchMode } from "./Titlebar.jsx";

const PLAYFUL = ["happy", "laughing", "playful", "excited", "proud", "shy", "surprised", "celebrate", "curious"];

/** Cloudee's mood follows what the app is doing. */
function useMood() {
  const streaming = useStore(store, (s) => !!(s.current && s.streaming[s.current.id]));
  useStore(store, (s) => s.rev);
  const conv = store.get().current;
  const last = conv?.messages[conv.messages.length - 1];
  const [typing, setTyping] = useState(false);
  const [flash, setFlash] = useState(null);
  const [idle, setIdle] = useState(false);
  const wasStreaming = useRef(false);
  const typingTimer = useRef(null);
  const idleTimer = useRef(null);

  useEffect(() => {
    if (wasStreaming.current && !streaming) {
      const m = last?.status === "error" ? "sad" : last?.status === "stopped" ? "confused" : last?.parts?.some((p) => p.type === "artifact" || p.type === "image") ? "celebrate" : "happy";
      setFlash(m);
      const t = setTimeout(() => setFlash(null), 3200);
      wasStreaming.current = streaming;
      return () => clearTimeout(t);
    }
    wasStreaming.current = streaming;
  }, [streaming]);

  useEffect(() => {
    const reset = () => {
      setIdle(false);
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setIdle(true), 120000);
    };
    reset();
    window.addEventListener("pointermove", reset);
    window.addEventListener("keydown", reset);
    return () => {
      window.removeEventListener("pointermove", reset);
      window.removeEventListener("keydown", reset);
    };
  }, []);

  const onTyping = () => {
    setTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 1500);
  };

  let mood = "idle";
  if (streaming) {
    const tools = last?.parts?.filter((p) => p.type === "tool") || [];
    const running = tools.find((p) => p.status === "running" || p.status === "waiting");
    if (running) mood = /search|fetch|glob|grep|Web/.test(running.name) ? "searching" : running.status === "waiting" ? "suspicious" : "working";
    else if (!last?.parts?.length) mood = "thinking";
    else mood = "listening";
  } else if (flash) mood = flash;
  else if (typing) mood = "listening";
  else if (idle) mood = "sleeping";
  return { mood, onTyping, poke: () => setFlash(PLAYFUL[Math.floor(Math.random() * PLAYFUL.length)]) };
}

function Palette({ onClose }) {
  const conversations = useStore(store, (s) => s.conversations);
  const [q, setQ] = useState("");
  const [hl, setHl] = useState(0);
  const items = useMemo(() => {
    const actions = [
      { label: "Nuova chat", icon: "plus", run: () => newConversation("chat") },
      { label: "Nuova sessione Code", icon: "code", run: () => switchMode("code") },
      { label: "Nuovo compito Cowork", icon: "cowork", run: () => switchMode("cowork") },
      { label: "Impostazioni", icon: "settings", run: () => store.set({ dialog: { type: "settings" } }) },
      { label: "Modelli Claude", icon: "sparkles", run: () => store.set({ dialog: { type: "settings", section: "claude" } }) },
      { label: "Plugin", icon: "puzzle", run: () => store.set({ dialog: { type: "settings", section: "plugins" } }) },
      { label: "Connettori", icon: "plug", run: () => store.set({ dialog: { type: "settings", section: "connectors" } }) },
      { label: "Skills", icon: "wand", run: () => store.set({ dialog: { type: "settings", section: "skills" } }) },
      { label: "Computer Linux", icon: "terminal", run: () => store.set({ panel: "linux" }) },
      { label: "Artefatti", icon: "layers", run: () => store.set({ panel: "artifacts" }) },
      { label: "Accedi a Cloudy", icon: "user", run: () => store.set({ dialog: { type: "login" } }) },
      ...APPS.map((a) => ({ label: `App: ${a.name}`, emoji: a.icon, run: () => openApp(a.id) })),
      ...conversations.map((c) => ({ label: c.title, icon: c.mode === "code" ? "code" : c.mode === "cowork" ? "cowork" : "chat", sub: "conversazione", run: () => openConversation(c.id) })),
    ];
    return actions.filter((a) => !q || a.label.toLowerCase().includes(q.toLowerCase())).slice(0, 14);
  }, [q, conversations]);
  const run = (a) => {
    onClose();
    a?.run();
  };
  return (
    <div className="overlay" style={{ alignItems: "start", paddingTop: "12vh" }} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="popover" style={{ position: "relative", width: "min(560px, 100%)", padding: 8 }}>
        <div className="search" style={{ marginBottom: 6 }}>
          <Icon name="search" size={15} />
          <input
            className="input"
            autoFocus
            placeholder="Cerca azioni, app e conversazioni…"
            value={q}
            onChange={(e) => (setQ(e.target.value), setHl(0))}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setHl((h) => Math.min(h + 1, items.length - 1));
              if (e.key === "ArrowUp") setHl((h) => Math.max(h - 1, 0));
              if (e.key === "Enter") run(items[hl]);
              if (e.key === "Escape") onClose();
            }}
          />
        </div>
        {items.map((a, i) => (
          <button key={a.label + i} className={"menu-item" + (i === hl ? " hl" : "")} onMouseEnter={() => setHl(i)} onClick={() => run(a)}>
            {a.emoji ? <span style={{ width: 18 }}>{a.emoji}</span> : <Icon name={a.icon} size={16} />}
            <span className="grow">{a.label}</span>
            {a.sub && <span className="sub">{a.sub}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function App() {
  const ready = useStore(store, (s) => s.ready);
  const sidebarOpen = useStore(store, (s) => s.settings.sidebarOpen);
  const mascot = useStore(store, (s) => s.settings.mascot);
  const palette = useStore(store, (s) => s.palette);
  const [mobileNav, setMobileNav] = useState(false);
  const { mood, onTyping, poke } = useMood();

  useEffect(() => linux.onStatus((linuxStatus, linuxError) => store.set({ linuxStatus, linuxError })), []);

  useEffect(() => {
    const onKey = async (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      // The original TUI's key bindings: ctrl+o model (in Composer), ctrl+t
      // usage, ctrl+w account, ctrl+n new, ctrl+l login, ctrl+u clear.
      if (k === "n") (e.preventDefault(), newConversation(store.get().current?.mode || "chat"));
      else if (k === "k") (e.preventDefault(), store.set({ palette: true }));
      else if (k === "t") {
        e.preventDefault();
        await refreshUsage();
        askDialog({ type: "output", title: "Quota Cloudy", text: usageLines(store.get().cloudy.usage).join("\n") });
      } else if (k === "w") (e.preventDefault(), store.set({ dialog: { type: "settings", section: "account" } }));
      else if (k === "l") (e.preventDefault(), store.set({ dialog: { type: "login" } }));
      else if (k === ",") (e.preventDefault(), store.set({ dialog: { type: "settings" } }));
      else if (k === "b") (e.preventDefault(), updateSettings((s) => ({ sidebarOpen: !s.sidebarOpen })));
    };
    window.addEventListener("keydown", onKey);
    const onMenu = (e) => {
      const a = e.detail;
      if (a === "new") newConversation("chat");
      else if (a === "settings") store.set({ dialog: { type: "settings" } });
      else if (a === "palette") store.set({ palette: true });
    };
    window.addEventListener("cloudy:menu", onMenu);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("cloudy:menu", onMenu);
    };
  }, []);

  return (
    <div className={`shell platform-${osName}`}>
      <div className="sky" aria-hidden="true">
        <div className="blob b1" />
        <div className="blob b2" />
        <div className="blob b3" />
        <div className="stars" />
        <div className="cloudlet" style={{ top: "18%", animationDelay: "-10s" }} />
        <div className="cloudlet" style={{ top: "62%", animationDelay: "-42s", transform: "scale(.7)" }} />
      </div>
      <Titlebar mood={mascot ? mood : "idle"} onMascot={poke} onMenu={() => setMobileNav(true)} />
      <div className="body">
        <Sidebar open={sidebarOpen} mobileOpen={mobileNav} onClose={() => setMobileNav(false)} />
        <main className="main">
          {ready && <Chat mood={mascot ? mood : "idle"} />}
          <Composer onTyping={onTyping} />
        </main>
        <SidePanel />
      </div>
      <WindowLayer />
      <Dialogs />
      {palette && <Palette onClose={() => store.set({ palette: false })} />}
      <Toasts />
      <Splash done={ready} />
    </div>
  );
}

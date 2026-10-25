import { useMemo, useState } from "react";
import { Icon } from "./Icons.jsx";
import { useStore } from "../lib/store.js";
import { store } from "../state/store.js";
import { deleteConversation, newConversation, openConversation, renameConversation, togglePin } from "../state/conversations.js";
import { claudeRoute } from "../state/models.js";
import { dayGroup } from "../lib/util.js";

const MODE_ICON = { chat: "chat", code: "code", cowork: "cowork" };

function UsageMini({ usage }) {
  if (!usage) return null;
  if (usage.trial) {
    const pct = (1 - usage.trial.remaining / Math.max(1, usage.trial.limit)) * 100;
    return (
      <div style={{ display: "grid", gap: 4 }}>
        <div className="hint">Prova: {usage.trial.remaining} di {usage.trial.limit} messaggi oggi</div>
        <div className={"usage-bar" + (pct > 80 ? " hot" : "")}>
          <i style={{ width: pct + "%" }} />
        </div>
      </div>
    );
  }
  const m = usage.messages?.daily;
  const c = usage.credits?.daily;
  if (!m || !c) return null;
  const pm = (m.used / Math.max(1, m.limit)) * 100;
  const pc = (c.used / Math.max(1, c.limit)) * 100;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div className="hint row">
        <span className="grow">Messaggi oggi</span>
        <span>
          {m.used}/{m.limit}
        </span>
      </div>
      <div className={"usage-bar" + (pm > 80 ? " hot" : "")}>
        <i style={{ width: pm + "%" }} />
      </div>
      <div className="hint row">
        <span className="grow">Crediti agente</span>
        <span>
          {c.used}/{c.limit}
        </span>
      </div>
      <div className={"usage-bar" + (pc > 80 ? " hot" : "")}>
        <i style={{ width: pc + "%" }} />
      </div>
    </div>
  );
}

export function Sidebar({ open, mobileOpen, onClose }) {
  const conversations = useStore(store, (s) => s.conversations);
  const currentId = useStore(store, (s) => s.current?.id);
  const streaming = useStore(store, (s) => s.streaming);
  const cloudy = useStore(store, (s) => s.cloudy);
  useStore(store, (s) => s.claude);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);

  const groups = useMemo(() => {
    const list = conversations.filter((c) => !q || c.title.toLowerCase().includes(q.toLowerCase()));
    const out = [];
    const pinned = list.filter((c) => c.pinned);
    if (pinned.length) out.push(["Fissate", pinned]);
    const map = new Map();
    for (const c of list.filter((x) => !x.pinned)) {
      const g = dayGroup(c.updatedAt);
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(c);
    }
    return [...out, ...map.entries()];
  }, [conversations, q]);

  const pick = (id) => {
    openConversation(id);
    onClose?.();
  };
  const route = claudeRoute();

  return (
    <>
      {mobileOpen && <div className="scrim show-mobile" onClick={onClose} />}
      <aside className={"sidebar" + (open ? "" : " closed") + (mobileOpen ? " open-mobile" : "")}>
        <div className="sidebar-top">
          <button
            className="new-chat"
            onClick={() => {
              newConversation(store.get().current?.mode || "chat");
              onClose?.();
            }}
          >
            <Icon name="plus" />
            Nuova chat
            <span className="kbd hide-mobile">Ctrl N</span>
          </button>
          <div className="search">
            <Icon name="search" size={15} />
            <input className="input" placeholder="Cerca nelle chat…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="conv-list">
          {!conversations.length && <div className="hint" style={{ padding: "20px 10px", textAlign: "center" }}>Le tue conversazioni appariranno qui.</div>}
          {groups.map(([label, items]) => (
            <div key={label}>
              <div className="conv-group">{label}</div>
              {items.map((c, i) => (
                <div key={c.id} className={"conv-item" + (c.id === currentId ? " active" : "")} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }} onClick={() => editing !== c.id && pick(c.id)} onDoubleClick={() => setEditing(c.id)}>
                  <Icon name={MODE_ICON[c.mode] || "chat"} size={15} className="mode-ico" />
                  {editing === c.id ? (
                    <input
                      autoFocus
                      defaultValue={c.title}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        renameConversation(c.id, e.target.value);
                        setEditing(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.target.blur();
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    <span className="title">{c.title}</span>
                  )}
                  {streaming[c.id] && <span className="live" />}
                  <span className="actions">
                    <button title={c.pinned ? "Sblocca" : "Fissa"} onClick={(e) => (e.stopPropagation(), togglePin(c.id))}>
                      <Icon name="pin" size={14} />
                    </button>
                    <button title="Rinomina" onClick={(e) => (e.stopPropagation(), setEditing(c.id))}>
                      <Icon name="edit" size={14} />
                    </button>
                    <button
                      title="Elimina"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Eliminare "${c.title}"?`)) deleteConversation(c.id);
                      }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="sidebar-foot">
          <UsageMini usage={cloudy.usage} />
          <div className="account" onClick={() => store.set({ dialog: cloudy.token ? { type: "settings", section: "account" } : { type: "login" } })}>
            <div className="avatar">{(cloudy.user?.email || "?").charAt(0).toUpperCase()}</div>
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 620, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cloudy.user?.email || "Accedi a Cloudy"}</div>
              <div className="hint">{cloudy.token ? "Piano gratuito" : "Prova gratis senza account"}</div>
            </div>
            <span className={"chip " + (route ? "claude" : "")} title={route ? `Claude collegato via ${route === "code" ? "Claude Code" : "API"}` : "Claude non collegato"}>
              ✳ {route ? (route === "code" ? "Code" : "API") : "off"}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}

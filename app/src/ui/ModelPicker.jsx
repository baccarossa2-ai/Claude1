import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icons.jsx";
import { useStore } from "../lib/store.js";
import { askDialog, store, updateSettings } from "../state/store.js";
import { allModels } from "../state/models.js";
import { setClaudeEnabled } from "../state/init.js";
import { setCurrentField } from "../state/conversations.js";

export function ModelLogo({ m, size = 28 }) {
  return (
    <span className="mp-logo" style={{ width: size, height: size }}>
      {m.logo?.src ? <img src={m.logo.src} className={m.logo.invertOnLight ? "inv" : ""} alt="" style={{ width: size * 0.64, height: size * 0.64 }} /> : <b>{m.logo?.monogram || "?"}</b>}
    </span>
  );
}

export function chooseModel(ref) {
  setCurrentField("model", ref);
  updateSettings({ defaultModel: ref });
}

export function ModelPicker({ onClose }) {
  useStore(store, (s) => s.cloudy.models);
  useStore(store, (s) => s.claude);
  useStore(store, (s) => s.settings);
  const current = useStore(store, (s) => s.current?.model);
  const [q, setQ] = useState("");
  const [showAllClaude, setShowAllClaude] = useState(false);
  const ref = useRef(null);
  const models = allModels();

  useEffect(() => {
    const off = (e) => !ref.current?.contains(e.target) && onClose();
    const esc = (e) => e.key === "Escape" && onClose();
    setTimeout(() => window.addEventListener("pointerdown", off), 0);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", off);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  const groups = useMemo(() => {
    const f = models.filter((m) => !q || `${m.name} ${m.detail} ${m.group}`.toLowerCase().includes(q.toLowerCase()));
    const map = new Map();
    for (const m of f) {
      if (m.group === "Claude" && !m.enabled && !showAllClaude && !q) continue;
      if (!map.has(m.group)) map.set(m.group, []);
      map.get(m.group).push(m);
    }
    if (!map.has("Claude") && !q) map.set("Claude", []);
    return [...map.entries()];
  }, [models, q, showAllClaude]);

  const pick = async (m) => {
    if (m.group === "Claude" && !m.available) {
      onClose();
      const r = await askDialog({ type: "claude-connect" });
      if (r !== "retry") return;
    }
    if (m.group === "Claude" && !m.enabled) setClaudeEnabled(m.claude.id, true);
    chooseModel(m.ref);
    onClose();
  };

  const hiddenClaude = models.filter((m) => m.group === "Claude" && !m.enabled).length;

  return (
    <div ref={ref} className="popover model-picker" style={{ bottom: "calc(100% + 10px)", left: 0 }}>
      <div className="mp-search">
        <div className="search">
          <Icon name="search" size={15} />
          <input className="input" autoFocus placeholder="Cerca un modello…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="mp-list">
        {groups.map(([group, items]) => (
          <div key={group}>
            <div className="mp-group">
              {group === "Claude" ? <span style={{ color: "var(--claude)" }}>✳</span> : group === "Cloudy" ? "☁" : "◆"} {group}
              {group === "Claude" && (
                <button className="mini-btn" style={{ marginLeft: "auto" }} onClick={() => (onClose(), store.set({ dialog: { type: "settings", section: "claude" } }))}>
                  Gestisci
                </button>
              )}
            </div>
            {items.map((m) => (
              <button key={m.ref} className={"mp-item" + (m.ref === current ? " sel" : "") + (m.available ? "" : " off")} style={{ "--mc": m.accent }} onClick={() => pick(m)}>
                <ModelLogo m={m} />
                <span className="info">
                  <div className="n">{m.name}</div>
                  <div className="d">{m.available ? m.detail : m.reason}</div>
                </span>
                <span className="badges">
                  {m.vision && <span className="badge" title="Legge immagini">👁</span>}
                  {m.credits ? <span className="badge" title="Crediti per turno agente">{m.credits}cr</span> : null}
                  {m.via && <span className="badge" style={{ color: "var(--claude)" }}>{m.via === "code" ? "Code" : "API"}</span>}
                  {m.ref === current && <Icon name="check" size={15} />}
                </span>
              </button>
            ))}
            {group === "Claude" && !items.length && (
              <div className="hint" style={{ padding: "4px 12px 8px" }}>
                Nessun modello Claude attivo. <a href="#" onClick={(e) => (e.preventDefault(), setShowAllClaude(true))}>Mostra tutti</a>
              </div>
            )}
            {group === "Claude" && hiddenClaude > 0 && !showAllClaude && items.length > 0 && (
              <button className="mini-btn" style={{ margin: "2px 8px 6px" }} onClick={() => setShowAllClaude(true)}>
                + {hiddenClaude} modelli Claude non attivi
              </button>
            )}
          </div>
        ))}
        <div className="menu-sep" />
        <button className="menu-item" onClick={() => (onClose(), store.set({ dialog: { type: "settings", section: "providers" } }))}>
          <Icon name="plus" size={15} /> Aggiungi un provider personalizzato
        </button>
      </div>
    </div>
  );
}

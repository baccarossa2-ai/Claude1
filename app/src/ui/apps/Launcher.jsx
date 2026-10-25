import { useState } from "react";
import { APPS } from "./registry.jsx";
import { openApp } from "./Windows.jsx";
import { Icon } from "../Icons.jsx";

export function AppsLauncher() {
  const [q, setQ] = useState("");
  const list = APPS.filter((a) => !q || `${a.name} ${a.desc}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <h2>Applicazioni</h2>
      <p className="lead">Strumenti integrati che funzionano anche offline. Si aprono in finestre che puoi spostare, ridimensionare e tenere accanto alla chat.</p>
      <div className="search" style={{ marginBottom: 14 }}>
        <Icon name="search" size={15} />
        <input className="input" placeholder="Cerca un'app…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <div className="launcher">
        {list.map((a, i) => (
          <button key={a.id} className="launch-tile" style={{ "--tc": a.color, animationDelay: i * 22 + "ms" }} onClick={() => openApp(a.id)} title={a.desc}>
            <span className="t-ico">{a.icon}</span>
            <span className="t-name">{a.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}

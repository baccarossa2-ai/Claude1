// A small window manager: draggable, resizable, minimisable app windows on
// desktop; full-screen sheets on phones.
import { useRef, useState } from "react";
import { useStore } from "../../lib/store.js";
import { store } from "../../state/store.js";
import { uid } from "../../lib/util.js";
import { APPS } from "./registry.jsx";

let z = 10;
export function openApp(appId, props = {}) {
  const app = APPS.find((a) => a.id === appId);
  if (!app) return;
  const existing = store.get().windows.find((w) => w.appId === appId && !app.multi);
  if (existing) return focusWindow(existing.id, { min: false });
  const n = store.get().windows.length;
  const w = Math.min(app.w || 560, window.innerWidth - 40);
  const h = Math.min(app.h || 460, window.innerHeight - 120);
  const win = { id: uid("w"), appId, props, x: Math.max(20, (window.innerWidth - w) / 2 + n * 24 - 60), y: Math.max(60, (window.innerHeight - h) / 2 + n * 24 - 40), w, h, z: ++z, min: false };
  store.set((s) => ({ windows: [...s.windows, win], dialog: null }));
}

export function focusWindow(id, patch = {}) {
  store.set((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, z: ++z, ...patch } : w)) }));
}

export function closeWindow(id) {
  store.set((s) => ({ windows: s.windows.filter((w) => w.id !== id) }));
}

function Win({ win }) {
  const app = APPS.find((a) => a.id === win.appId);
  const [closing, setClosing] = useState(false);
  const ref = useRef(null);
  const drag = (e, mode) => {
    if (window.innerWidth <= 820) return;
    e.preventDefault();
    focusWindow(win.id);
    const x0 = e.clientX;
    const y0 = e.clientY;
    const start = { ...win };
    const move = (ev) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      const el = ref.current;
      if (!el) return;
      if (mode === "move") {
        el.style.left = Math.max(-start.w + 80, Math.min(window.innerWidth - 80, start.x + dx)) + "px";
        el.style.top = Math.max(0, Math.min(window.innerHeight - 40, start.y + dy)) + "px";
      } else {
        el.style.width = Math.max(280, start.w + dx) + "px";
        el.style.height = Math.max(200, start.h + dy) + "px";
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const el = ref.current;
      if (el) focusWindow(win.id, { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const close = () => {
    setClosing(true);
    setTimeout(() => closeWindow(win.id), 180);
  };
  const C = app.component;
  return (
    <div ref={ref} className={"window" + (closing ? " closing" : "") + (win.min ? " min" : "")} style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z }} onPointerDown={() => win.z !== z && focusWindow(win.id)}>
      <div className="win-head" onPointerDown={(e) => drag(e, "move")} onDoubleClick={() => focusWindow(win.id, { x: 10, y: 50, w: window.innerWidth - 20, h: window.innerHeight - 70 })}>
        <span className="win-dots" onPointerDown={(e) => e.stopPropagation()}>
          <button className="c" title="Chiudi" onClick={close} />
          <button className="m" title="Riduci" onClick={() => focusWindow(win.id, { min: true })} />
          <button className="x" title="Ingrandisci" onClick={() => focusWindow(win.id, { x: 10, y: 50, w: window.innerWidth - 20, h: window.innerHeight - 70 })} />
        </span>
        <span className="w-title">
          <span>{app.icon}</span> {app.name}
        </span>
      </div>
      <div className="win-body">
        <C {...win.props} winId={win.id} />
      </div>
      <div className="win-resize" onPointerDown={(e) => drag(e, "resize")} />
    </div>
  );
}

export function WindowLayer() {
  const windows = useStore(store, (s) => s.windows);
  if (!windows.length) return null;
  return (
    <>
      <div className="win-layer">
        {windows.map((w) => (
          <Win key={w.id} win={w} />
        ))}
      </div>
      <div className="taskbar">
        {windows.map((w) => {
          const app = APPS.find((a) => a.id === w.appId);
          return (
            <button key={w.id} className={w.min ? "" : "on"} title={app.name} onClick={() => focusWindow(w.id, { min: !w.min && w.z === z ? true : false })}>
              {app.icon}
            </button>
          );
        })}
      </div>
    </>
  );
}

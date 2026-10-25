import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Icon } from "./Icons.jsx";
import { Cloudee } from "./Cloudee.jsx";
import { useStore } from "../lib/store.js";
import { store, toast } from "../state/store.js";
import { renderMarkdown, highlight } from "../lib/markdown.js";
import { linux } from "../linux/vm.js";
import { openWorkspace } from "../agent/workspace.js";
import { fmtBytes, copyText } from "../lib/util.js";
import { saveAs, isDesktop } from "../platform/native.js";

const TABS = [
  ["artifacts", "Artefatti", "layers"],
  ["linux", "Linux", "terminal"],
  ["files", "File", "folder"],
  ["tasks", "Attività", "list"],
];

/**
 * HTML artifacts load assets/artifact-host.html (its own permissive CSP) in an
 * iframe sandboxed WITHOUT allow-same-origin, then receive their markup by
 * postMessage — inline scripts run, the app's bridge stays out of reach.
 */
function ArtifactFrame({ art }) {
  const ref = useRef(null);
  useEffect(() => {
    const onMsg = (e) => {
      if (e.source === ref.current?.contentWindow && e.data?.type === "cloudy-artifact-ready") {
        ref.current.contentWindow.postMessage({ type: "cloudy-artifact", kind: art.kind, content: art.content }, "*");
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [art.id, art.content]);
  return <iframe ref={ref} key={art.id + art.content.length} className="artifact-frame" title={art.title} sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock allow-downloads" src="assets/artifact-host.html" />;
}

/** Artifacts render in a sandboxed iframe — scripts run, but never with the app's privileges. */
function ArtifactsView() {
  const conv = useStore(store, (s) => s.current);
  useStore(store, (s) => s.rev);
  const sel = useStore(store, (s) => s.panelArtifact);
  const list = conv?.artifacts || [];
  const art = list.find((a) => a.id === sel) || list[list.length - 1];
  const [showCode, setShowCode] = useState(false);
  if (!art)
    return (
      <div className="linux-off" style={{ color: "var(--text-2)" }}>
        <Cloudee mood="curious" size={100} />
        <div>
          <b>Nessun artefatto per ora</b>
          <div className="hint">Chiedi a Cloudy di creare una pagina web, un gioco, un grafico o un documento: apparirà qui.</div>
        </div>
      </div>
    );
  const ext = { html: "html", markdown: "md", svg: "svg", code: art.language || "txt" }[art.kind] || "txt";
  return (
    <div className="artifact-view">
      {list.length > 1 && (
        <div className="artifact-list">
          {list.map((a) => (
            <button key={a.id} className={"artifact-tab" + (a.id === art.id ? " active" : "")} onClick={() => store.set({ panelArtifact: a.id })}>
              {a.title}
            </button>
          ))}
        </div>
      )}
      <div className="artifact-toolbar">
        <b className="grow" style={{ fontSize: 13 }}>{art.title}</b>
        {(art.kind === "html" || art.kind === "svg") && (
          <button className="btn small" onClick={() => setShowCode((v) => !v)}>
            <Icon name={showCode ? "eye" : "code"} size={14} /> {showCode ? "Anteprima" : "Codice"}
          </button>
        )}
        <button className="btn small" onClick={() => copyText(art.content).then(() => toast("Copiato", "success", 1200))}>
          <Icon name="copy" size={14} />
        </button>
        <button className="btn small" onClick={() => saveAs(`${art.title.replace(/[^\w\- ]+/g, "").trim() || "artefatto"}.${ext}`, art.content, "text/plain")}>
          <Icon name="download" size={14} />
        </button>
      </div>
      {showCode || art.kind === "code" ? (
        <div className="codeblock" style={{ margin: 0, borderRadius: 0, flex: 1, overflow: "auto", border: 0 }}>
          <pre>
            <code className="hljs" dangerouslySetInnerHTML={{ __html: highlight(art.content, art.kind === "code" ? art.language : art.kind === "svg" ? "xml" : "xml") }} />
          </pre>
        </div>
      ) : art.kind === "html" ? (
        <ArtifactFrame art={art} />
      ) : art.kind === "svg" ? (
        <div className="artifact-svg" style={{ flex: 1, overflow: "auto" }}>
          <img alt={art.title} src={"data:image/svg+xml;charset=utf-8," + encodeURIComponent(art.content)} />
        </div>
      ) : (
        <div className="artifact-md md" style={{ flex: 1, overflow: "auto" }} dangerouslySetInnerHTML={{ __html: renderMarkdown(art.content) }} />
      )}
    </div>
  );
}

function LinuxView() {
  const status = useStore(store, (s) => s.linuxStatus || "off");
  const err = useStore(store, (s) => s.linuxError);
  const host = useRef(null);
  const term = useRef(null);

  useEffect(() => {
    if (status !== "ready" && status !== "booting") return;
    const t = new Terminal({
      fontFamily: "JetBrains Mono, Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      convertEol: false,
      theme: { background: "#05060b", foreground: "#d8deef", cursor: "#7c9cff", selectionBackground: "#7c9cff55", green: "#34d399", blue: "#7c9cff", magenta: "#b38cff", cyan: "#38bdf8", yellow: "#fbbf24", red: "#f87171" },
    });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(host.current);
    fit.fit();
    t.write(linux.display.slice(-60000));
    const off = linux.onOutput((txt) => t.write(txt.replace(/\r?\n/g, "\r\n")));
    const dataSub = t.onData((d) => linux.input(d));
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* detached */
      }
    });
    ro.observe(host.current);
    term.current = t;
    return () => {
      off();
      dataSub.dispose();
      ro.disconnect();
      t.dispose();
    };
  }, [status === "off" || status === "error"]);

  return (
    <div className="linux">
      <div className="linux-bar">
        <span className={"status-dot " + status} />
        <b>cloudy@linux</b>
        <span className="muted grow">Linux 6.8 · Buildroot · i686</span>
        {status === "ready" && (
          <>
            <button className="btn small ghost" style={{ color: "#c9cfe1" }} onClick={() => linux.saveShared().then(() => toast("Cartella /mnt salvata", "success"))} title="Salva /mnt">
              <Icon name="download" size={14} />
            </button>
            <button className="btn small ghost" style={{ color: "#c9cfe1" }} onClick={() => linux.reset()} title="Riavvia">
              <Icon name="refresh" size={14} />
            </button>
            <button className="btn small ghost" style={{ color: "#c9cfe1" }} onClick={() => linux.shutdown()} title="Spegni">
              <Icon name="power" size={14} />
            </button>
          </>
        )}
      </div>
      {status === "off" || status === "error" ? (
        <div className="linux-off">
          <div className="tux">🐧</div>
          <div>
            <b style={{ fontSize: 16 }}>Il computer Linux di Cloudy</b>
            <div className="muted" style={{ maxWidth: 340, margin: "6px auto 0" }}>
              Un vero Linux che gira dentro l'app. L'IA lo usa per eseguire comandi e script; tu puoi usarlo come terminale. Si avvia in pochi secondi.
            </div>
          </div>
          {err && <div style={{ color: "var(--err)", fontSize: 12.5 }}>{err}</div>}
          <button className="btn primary" onClick={() => linux.boot().catch(() => {})}>
            <Icon name="power" /> Accendi
          </button>
        </div>
      ) : (
        <div className="linux-term" ref={host} />
      )}
    </div>
  );
}

function FilesView() {
  const conv = useStore(store, (s) => s.current);
  useStore(store, (s) => s.rev);
  const [ws, setWs] = useState(null);
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState([]);
  const [open, setOpen] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setDir("");
    setOpen(null);
    if (conv?.workspace) openWorkspace(conv.workspace).then(setWs, (e) => setErr(e.message));
    else setWs(null);
  }, [conv?.workspace]);

  useEffect(() => {
    if (!ws) return;
    ws.list(dir)
      .then((list) => {
        setErr(null);
        setEntries(list.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1)));
      })
      .catch((e) => setErr(e.message));
  }, [ws, dir, conv?.messages.length]);

  if (!conv?.workspace)
    return (
      <div className="linux-off" style={{ color: "var(--text-2)" }}>
        <Icon name="folder" size={40} />
        <div className="hint">Nessuna cartella di lavoro. Passa a Code o Cowork e scegline una dal compositore.</div>
      </div>
    );
  if (open)
    return (
      <div className="file-viewer">
        <div className="crumbs">
          <button onClick={() => setOpen(null)}>
            <Icon name="chevronRight" size={12} style={{ transform: "rotate(180deg)" }} /> indietro
          </button>
          <b className="mono">{open.path}</b>
        </div>
        <div className="codeblock" style={{ margin: 0, borderRadius: 0, border: 0 }}>
          <pre>
            <code className="hljs" dangerouslySetInnerHTML={{ __html: highlight(open.text.slice(0, 200000), open.path.split(".").pop()) }} />
          </pre>
        </div>
      </div>
    );
  const parts = dir ? dir.split("/") : [];
  return (
    <div className="files">
      <div className="crumbs">
        <button onClick={() => setDir("")}>{ws?.label || conv.workspace}</button>
        {parts.map((p, i) => (
          <span key={i}>
            / <button onClick={() => setDir(parts.slice(0, i + 1).join("/"))}>{p}</button>
          </span>
        ))}
        <span className="grow" />
        {isDesktop && (
          <button onClick={() => ws?.reveal?.(dir)} title="Apri in Esplora risorse">
            <Icon name="external" size={13} />
          </button>
        )}
      </div>
      {err && <div className="hint" style={{ color: "var(--err)", padding: 8 }}>{err}</div>}
      {entries.map((e) => (
        <div
          key={e.name}
          className="file-row"
          onClick={async () => {
            const p = dir ? `${dir}/${e.name}` : e.name;
            if (e.type === "dir") setDir(p);
            else {
              try {
                setOpen({ path: p, text: await ws.read(p) });
              } catch (ex) {
                toast(ex.message, "error");
              }
            }
          }}
        >
          <Icon name={e.type === "dir" ? "folder" : "file"} size={15} />
          <span>{e.name}</span>
          {e.type === "file" && <span className="sz">{fmtBytes(e.size)}</span>}
        </div>
      ))}
      {!entries.length && !err && <div className="hint" style={{ padding: 10 }}>Cartella vuota</div>}
    </div>
  );
}

function TasksView() {
  const conv = useStore(store, (s) => s.current);
  useStore(store, (s) => s.rev);
  const todos = conv?.todos || [];
  const done = todos.filter((t) => t.status === "completed").length;
  const pct = todos.length ? Math.round((done / todos.length) * 100) : 0;
  const files = [];
  for (const m of conv?.messages || []) for (const p of m.parts || []) if (p.type === "file" && p.after != null && !files.includes(p.path)) files.push(p.path);
  return (
    <div className="tasks">
      <div className="task-progress">
        <div className="row">
          <span className="big">{pct}%</span>
          <span className="muted grow">
            {done} di {todos.length} passi completati
          </span>
          <Cloudee mood={todos.length && done === todos.length ? "celebrate" : todos.some((t) => t.status === "in_progress") ? "working" : "idle"} size={56} />
        </div>
        <div className="usage-bar" style={{ height: 8 }}>
          <i style={{ width: pct + "%" }} />
        </div>
      </div>
      {!todos.length && <div className="hint">Quando affidi un compito in modalità Cowork, Cloudy crea qui il piano e lo spunta passo dopo passo.</div>}
      {todos.map((t, i) => (
        <div key={i} className={"todo " + t.status} style={{ animationDelay: i * 50 + "ms" }}>
          <span className="box">{t.status === "completed" && <Icon name="check" size={11} stroke={3} />}</span>
          <span className="txt">{t.content}</span>
        </div>
      ))}
      {!!files.length && (
        <div className="section">
          <h4>
            <Icon name="file" size={15} /> File prodotti
          </h4>
          {files.map((f) => (
            <div key={f} className="mono">
              {f}
            </div>
          ))}
        </div>
      )}
      {!!conv?.artifacts?.length && (
        <div className="section">
          <h4>
            <Icon name="layers" size={15} /> Artefatti
          </h4>
          {conv.artifacts.map((a) => (
            <button key={a.id} className="artifact-chip" onClick={() => store.set({ panel: "artifacts", panelArtifact: a.id })}>
              {a.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SidePanel() {
  const panel = useStore(store, (s) => s.panel);
  const [w, setW] = useState(() => Number(localStorage.getItem("cloudy.panelW")) || 440);
  if (!panel) return null;
  const startResize = (e) => {
    const x0 = e.clientX;
    const w0 = w;
    const move = (ev) => setW(Math.max(320, Math.min(window.innerWidth * 0.7, w0 + (x0 - ev.clientX))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      localStorage.setItem("cloudy.panelW", String(w));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const View = { artifacts: ArtifactsView, linux: LinuxView, files: FilesView, tasks: TasksView }[panel] || ArtifactsView;
  return (
    <aside className="side-panel" style={{ width: w }}>
      <div className="resizer" onPointerDown={startResize} />
      <div className="panel-head">
        <div className="panel-tabs">
          {TABS.map(([id, label, icon]) => (
            <button key={id} className={"panel-tab" + (panel === id ? " active" : "")} onClick={() => store.set({ panel: id })}>
              <Icon name={icon} size={14} /> {label}
            </button>
          ))}
        </div>
        <button className="icon-btn" onClick={() => store.set({ panel: null })} title="Chiudi pannello">
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="panel-body">
        <View />
      </div>
    </aside>
  );
}

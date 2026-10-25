// The built-in apps. Each is a small, self-contained component; several can
// hand their result to the chat ("Invia alla chat").
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icons.jsx";
import { calculate } from "../../agent/tools.js";
import { lineDiff } from "../Message.jsx";
import { highlight, renderMarkdown } from "../../lib/markdown.js";
import { copyText, uid } from "../../lib/util.js";
import { dbGet, dbSet } from "../../lib/db.js";
import { store, toast } from "../../state/store.js";
import { sendMessage } from "../../state/send.js";
import { isDesktop, openExternal, saveAs } from "../../platform/native.js";
import { openWorkspace } from "../../agent/workspace.js";
import { useStore } from "../../lib/store.js";

function LinuxTerminal() {
  useEffect(() => {
    store.set({ panel: "linux" });
  }, []);
  return (
    <div className="app-pad">
      <div>Il terminale del computer Linux si apre nel pannello laterale, così puoi vedere l'IA che lavora mentre chatti.</div>
      <button className="btn primary" onClick={() => store.set({ panel: "linux" })}>
        <Icon name="terminal" /> Mostra il terminale
      </button>
    </div>
  );
}

// ---------------- calculator ----------------
function Calculator() {
  const [expr, setExpr] = useState("");
  const [res, setRes] = useState("0");
  const keys = ["sin(", "cos(", "tan(", "sqrt(", "^", "ln(", "log(", "(", ")", "!", "7", "8", "9", "/", "C", "4", "5", "6", "*", "⌫", "1", "2", "3", "-", "pi", "0", ".", "%", "+", "="];
  const press = (k) => {
    if (k === "C") return setExpr(""), setRes("0");
    if (k === "⌫") return setExpr((e) => e.slice(0, -1));
    if (k === "=") {
      try {
        const v = calculate(expr);
        setRes(String(+v.toPrecision(14)));
        setExpr(String(+v.toPrecision(14)));
      } catch {
        setRes("Errore");
      }
      return;
    }
    setExpr((e) => e + k);
  };
  useEffect(() => {
    try {
      if (expr) setRes(String(+calculate(expr).toPrecision(12)));
    } catch {
      /* partial expression */
    }
  }, [expr]);
  return (
    <div className="calc">
      <div className="calc-screen">
        <div className="expr">{expr || " "}</div>
        <div className="res">{res}</div>
      </div>
      <div className="calc-keys">
        {keys.map((k) => (
          <button key={k} className={"=+-*/^%".includes(k) && k !== "" ? (k === "=" ? "eq" : "op") : ""} onClick={() => press(k)}>
            {k === "sqrt(" ? "√" : k === "pi" ? "π" : k.replace("(", "")}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- code editor ----------------
function Editor({ path: initialPath }) {
  const conv = useStore(store, (s) => s.current);
  const [path, setPath] = useState(initialPath || "nuovo.txt");
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const pre = useRef(null);
  const lang = path.split(".").pop();
  const html = useMemo(() => highlight(text + "\n", lang), [text, lang]);
  const ws = async () => (conv?.workspace ? openWorkspace(conv.workspace) : null);
  const load = async () => {
    const w = await ws();
    if (!w) return toast("Apri una cartella di lavoro (Code/Cowork) per usare i file del progetto", "error");
    try {
      setText(await w.read(path));
      setDirty(false);
    } catch (e) {
      toast(e.message, "error");
    }
  };
  const save = async () => {
    const w = await ws();
    if (w) {
      await w.write(path, text);
      toast(`Salvato ${path}`, "success");
    } else await saveAs(path.split("/").pop(), text);
    setDirty(false);
  };
  return (
    <div className="editor">
      <div className="editor-bar">
        <input className="input mono" style={{ width: 220 }} value={path} onChange={(e) => setPath(e.target.value)} />
        <button className="btn small" onClick={load}>
          Apri
        </button>
        <button className="btn small primary" onClick={save}>
          Salva{dirty ? " •" : ""}
        </button>
        <button className="btn small" onClick={() => sendMessage(`Ecco il file ${path}:\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\nRevisionalo e suggerisci miglioramenti.`)}>
          Chiedi a Cloudy
        </button>
      </div>
      <div className="code-edit" onScroll={(e) => pre.current && ((pre.current.style.transform = `translate(${-e.currentTarget.scrollLeft}px, 0)`), 0)}>
        <pre ref={pre} aria-hidden="true">
          <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
        <textarea
          spellCheck={false}
          value={text}
          onChange={(e) => (setText(e.target.value), setDirty(true))}
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              e.preventDefault();
              const t = e.currentTarget;
              const s = t.selectionStart;
              setText(text.slice(0, s) + "  " + text.slice(t.selectionEnd));
              requestAnimationFrame(() => (t.selectionStart = t.selectionEnd = s + 2));
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
              e.preventDefault();
              save();
            }
          }}
          style={{ height: Math.max(400, text.split("\n").length * 20.5 + 40) }}
        />
      </div>
    </div>
  );
}

// ---------------- notes ----------------
function Notes() {
  const [notes, setNotes] = useState([]);
  const [sel, setSel] = useState(null);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    dbGet("app:notes").then((n) => {
      setNotes(n || []);
      setSel(n?.[0]?.id || null);
    });
  }, []);
  const persist = (list) => {
    setNotes(list);
    dbSet("app:notes", list);
  };
  const cur = notes.find((n) => n.id === sel);
  const add = () => {
    const n = { id: uid("n"), title: "Nuova nota", body: "", at: Date.now() };
    persist([n, ...notes]);
    setSel(n.id);
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "170px 1fr", height: "100%" }}>
      <div className="app-pad" style={{ borderRight: "1px solid var(--border)", overflow: "auto" }}>
        <button className="btn small primary" onClick={add}>
          <Icon name="plus" size={14} /> Nota
        </button>
        <div className="note-list">
          {notes.map((n) => (
            <div key={n.id} className={"note-item" + (n.id === sel ? " on" : "")} onClick={() => setSel(n.id)}>
              {n.title || "Senza titolo"}
            </div>
          ))}
        </div>
      </div>
      {cur ? (
        <div className="app-pad" style={{ overflow: "auto" }}>
          <div className="row">
            <input className="input grow" value={cur.title} onChange={(e) => persist(notes.map((n) => (n.id === cur.id ? { ...n, title: e.target.value } : n)))} />
            <button className="btn small" onClick={() => setPreview((p) => !p)}>
              {preview ? "Modifica" : "Anteprima"}
            </button>
            <button className="btn small" onClick={() => sendMessage(`Ecco una mia nota «${cur.title}»:\n\n${cur.body}`)}>
              → Chat
            </button>
            <button className="btn small danger" onClick={() => (persist(notes.filter((n) => n.id !== cur.id)), setSel(null))}>
              <Icon name="trash" size={13} />
            </button>
          </div>
          {preview ? (
            <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(cur.body) }} />
          ) : (
            <textarea className="textarea" style={{ minHeight: 300 }} placeholder="Scrivi in markdown…" value={cur.body} onChange={(e) => persist(notes.map((n) => (n.id === cur.id ? { ...n, body: e.target.value, at: Date.now() } : n)))} />
          )}
        </div>
      ) : (
        <div className="app-pad muted">Crea una nota per iniziare.</div>
      )}
    </div>
  );
}

// ---------------- whiteboard ----------------
function Whiteboard() {
  const canvas = useRef(null);
  const [color, setColor] = useState("#1f2937");
  const [size, setSize] = useState(4);
  const [eraser, setEraser] = useState(false);
  useEffect(() => {
    const c = canvas.current;
    const r = c.getBoundingClientRect();
    c.width = r.width * devicePixelRatio;
    c.height = r.height * devicePixelRatio;
    const ctx = c.getContext("2d");
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, r.width, r.height);
  }, []);
  const draw = (e) => {
    const c = canvas.current;
    const ctx = c.getContext("2d");
    const r = c.getBoundingClientRect();
    let last = { x: e.clientX - r.left, y: e.clientY - r.top };
    c.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const p = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      ctx.strokeStyle = eraser ? "#fff" : color;
      ctx.lineWidth = eraser ? size * 4 : size * (ev.pressure ? 0.5 + ev.pressure : 1);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    };
    const up = () => {
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
    };
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
  };
  const toChat = () => {
    const data = canvas.current.toDataURL("image/png").split(",")[1];
    sendMessage("Ecco un mio disegno: descrivilo e dimmi cosa ne pensi.", [{ id: uid("f_"), name: "disegno.png", mime: "image/png", size: data.length * 0.75, kind: "image", data }]);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="editor-bar">
        {["#1f2937", "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"].map((c) => (
          <span key={c} className={"swatch" + (c === color && !eraser ? " on" : "")} style={{ background: c, width: 22, height: 22 }} onClick={() => (setColor(c), setEraser(false))} />
        ))}
        <input type="range" min={1} max={20} value={size} onChange={(e) => setSize(+e.target.value)} />
        <button className={"btn small" + (eraser ? " primary" : "")} onClick={() => setEraser((x) => !x)}>
          Gomma
        </button>
        <button className="btn small" onClick={() => saveAs("disegno.png", dataUrlToBlob(canvas.current.toDataURL("image/png")))}>
          <Icon name="download" size={14} />
        </button>
        <button className="btn small primary" onClick={toChat}>
          → Chat
        </button>
      </div>
      <canvas ref={canvas} className="draw-canvas" style={{ flex: 1 }} onPointerDown={draw} />
    </div>
  );
}
function dataUrlToBlob(url) {
  const [h, b] = url.split(",");
  const bin = atob(b);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: h.match(/:(.*?);/)[1] });
}

// ---------------- timer / pomodoro ----------------
function Timer() {
  const [total, setTotal] = useState(25 * 60);
  const [left, setLeft] = useState(25 * 60);
  const [run, setRun] = useState(false);
  useEffect(() => {
    if (!run) return;
    const t = setInterval(
      () =>
        setLeft((l) => {
          if (l <= 1) {
            setRun(false);
            toast("⏰ Tempo scaduto!", "success", 8000);
            try {
              new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=").play();
            } catch {
              /* no audio */
            }
            return 0;
          }
          return l - 1;
        }),
      1000
    );
    return () => clearInterval(t);
  }, [run]);
  const set = (m) => (setTotal(m * 60), setLeft(m * 60), setRun(false));
  const pct = left / total;
  const R = 90;
  const C = 2 * Math.PI * R;
  return (
    <div className="app-pad" style={{ justifyItems: "center" }}>
      <div className="ring">
        <svg width="200" height="200">
          <circle cx="100" cy="100" r={R} stroke="var(--surface-3)" strokeWidth="10" fill="none" />
          <circle cx="100" cy="100" r={R} stroke="url(#tg)" strokeWidth="10" fill="none" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} style={{ transition: "stroke-dashoffset 1s linear" }} />
          <defs>
            <linearGradient id="tg">
              <stop offset="0" stopColor="var(--accent)" />
              <stop offset="1" stopColor="var(--accent-2)" />
            </linearGradient>
          </defs>
        </svg>
        <div className="timer-face">
          {String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}
        </div>
      </div>
      <div className="row">
        {[5, 15, 25, 50].map((m) => (
          <button key={m} className="btn small" onClick={() => set(m)}>
            {m} min
          </button>
        ))}
      </div>
      <div className="row">
        <button className="btn primary" onClick={() => setRun((r) => !r)}>
          {run ? "Pausa" : "Avvia"}
        </button>
        <button className="btn" onClick={() => (setLeft(total), setRun(false))}>
          Azzera
        </button>
      </div>
    </div>
  );
}

// ---------------- world clock ----------------
const ZONES = [["Roma", "Europe/Rome"], ["Londra", "Europe/London"], ["New York", "America/New_York"], ["Los Angeles", "America/Los_Angeles"], ["Tokyo", "Asia/Tokyo"], ["Sydney", "Australia/Sydney"], ["Dubai", "Asia/Dubai"], ["San Paolo", "America/Sao_Paulo"], ["Pechino", "Asia/Shanghai"], ["Mosca", "Europe/Moscow"]];
function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="app-pad">
      <div className="timer-face">{now.toLocaleTimeString("it-IT")}</div>
      <div className="hint" style={{ textAlign: "center" }}>{now.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
      <div className="clock-grid">
        {ZONES.map(([n, z]) => (
          <div key={z} className="clock-card">
            <div className="hint">{n}</div>
            <div className="tm">{now.toLocaleTimeString("it-IT", { timeZone: z, hour: "2-digit", minute: "2-digit" })}</div>
            <div className="hint">{now.toLocaleDateString("it-IT", { timeZone: z, weekday: "short" })}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- JSON ----------------
function JsonTool() {
  const [src, setSrc] = useState('{"nome":"Cloudy","versione":2,"modalita":["chat","code","cowork"]}');
  const [out, setOut] = useState("");
  const [err, setErr] = useState(null);
  const run = (fn) => {
    try {
      setOut(fn(JSON.parse(src)));
      setErr(null);
    } catch (e) {
      setErr(e.message);
    }
  };
  return (
    <div className="app-pad">
      <textarea className="textarea mono" style={{ minHeight: 140 }} value={src} onChange={(e) => setSrc(e.target.value)} />
      <div className="row wrap">
        <button className="btn small primary" onClick={() => run((j) => JSON.stringify(j, null, 2))}>
          Formatta
        </button>
        <button className="btn small" onClick={() => run((j) => JSON.stringify(j))}>
          Minimizza
        </button>
        <button className="btn small" onClick={() => run((j) => `✓ JSON valido · ${Array.isArray(j) ? "array di " + j.length : typeof j === "object" && j ? Object.keys(j).length + " chiavi" : typeof j}`)}>
          Valida
        </button>
        <button className="btn small" onClick={() => copyText(out)}>
          Copia
        </button>
      </div>
      {err && <div className="msg-error">{err}</div>}
      {out && <pre className="out-box" dangerouslySetInnerHTML={{ __html: highlight(out, "json") }} />}
    </div>
  );
}

// ---------------- regex ----------------
function RegexTool() {
  const [re, setRe] = useState("\\b\\w+@\\w+\\.\\w+\\b");
  const [flags, setFlags] = useState("g");
  const [text, setText] = useState("Scrivi a ciao@cloudy.chat oppure info@esempio.it per informazioni.");
  let html = "";
  let count = 0;
  let err = null;
  try {
    const r = new RegExp(re, flags.includes("g") ? flags : flags + "g");
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
    let last = 0;
    for (const m of text.matchAll(r)) {
      if (m[0] === "") break;
      html += esc(text.slice(last, m.index)) + `<span class="match">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
      count++;
    }
    html += esc(text.slice(last));
  } catch (e) {
    err = e.message;
  }
  return (
    <div className="app-pad">
      <div className="row">
        <input className="input mono grow" value={re} onChange={(e) => setRe(e.target.value)} />
        <input className="input mono" style={{ width: 70 }} value={flags} onChange={(e) => setFlags(e.target.value)} />
      </div>
      <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} />
      {err ? <div className="msg-error">{err}</div> : <div className="hint">{count} corrispondenze</div>}
      <div className="out-box" style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font)" }} dangerouslySetInnerHTML={{ __html: html }} />
      <button className="btn small" onClick={() => sendMessage(`Spiegami questa espressione regolare pezzo per pezzo: \`${re}\``)}>
        Spiegamela con Cloudy
      </button>
    </div>
  );
}

// ---------------- diff ----------------
function DiffTool() {
  const [a, setA] = useState("riga uno\nriga due\nriga tre");
  const [b, setB] = useState("riga uno\nriga 2\nriga tre\nriga quattro");
  const d = useMemo(() => lineDiff(a, b), [a, b]);
  return (
    <div className="app-pad">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <textarea className="textarea mono" value={a} onChange={(e) => setA(e.target.value)} />
        <textarea className="textarea mono" value={b} onChange={(e) => setB(e.target.value)} />
      </div>
      <div className="diff" style={{ borderRadius: 12 }}>
        {d.map((l, i) => (
          <div key={i} className={l.k === "add" ? "add" : l.k === "del" ? "del" : ""}>
            {l.k === "add" ? "+ " : l.k === "del" ? "- " : "  "}
            {l.t}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- text tools ----------------
async function sha(algo, text) {
  const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function TextTools() {
  const [t, setT] = useState("Ciao da Cloudy!");
  const [out, setOut] = useState("");
  const words = t.trim() ? t.trim().split(/\s+/).length : 0;
  const ops = [
    ["Base64 ↑", () => btoa(unescape(encodeURIComponent(t)))],
    ["Base64 ↓", () => decodeURIComponent(escape(atob(t.trim())))],
    ["URL ↑", () => encodeURIComponent(t)],
    ["URL ↓", () => decodeURIComponent(t)],
    ["SHA-256", () => sha("SHA-256", t)],
    ["SHA-1", () => sha("SHA-1", t)],
    ["MAIUSCOLO", () => t.toUpperCase()],
    ["minuscolo", () => t.toLowerCase()],
    ["Titolo", () => t.replace(/\b\p{L}/gu, (c) => c.toUpperCase())],
    ["slug", () => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")],
    ["Inverti", () => [...t].reverse().join("")],
    ["UUID", () => crypto.randomUUID()],
  ];
  return (
    <div className="app-pad">
      <textarea className="textarea" value={t} onChange={(e) => setT(e.target.value)} />
      <div className="hint">
        {t.length} caratteri · {words} parole · {t.split("\n").length} righe
      </div>
      <div className="row wrap">
        {ops.map(([n, fn]) => (
          <button
            key={n}
            className="btn small"
            onClick={async () => {
              try {
                setOut(await fn());
              } catch (e) {
                setOut("Errore: " + e.message);
              }
            }}
          >
            {n}
          </button>
        ))}
      </div>
      {out && (
        <div className="out-box" onClick={() => copyText(out).then(() => toast("Copiato", "success", 1200))} title="Clic per copiare">
          {out}
        </div>
      )}
    </div>
  );
}

// ---------------- colours ----------------
function hexToHsl(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}
const hsl = (h, s, l) => {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return "#" + [f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, "0")).join("");
};
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function Colors() {
  const [base, setBase] = useState("#7c9cff");
  const [h, s, l] = hexToHsl(base);
  const sets = {
    Analoghi: [-40, -20, 0, 20, 40].map((d) => hsl((h + d + 360) % 360, s, l)),
    Complementari: [hsl(h, s, l), hsl(h, s, Math.max(10, l - 20)), hsl((h + 180) % 360, s, l), hsl((h + 180) % 360, s, Math.min(90, l + 20)), hsl(h, Math.max(10, s - 40), 92)],
    Triadici: [0, 120, 240, 60, 300].map((d) => hsl((h + d) % 360, s, l)),
    Tonalità: [92, 75, 58, 40, 22].map((L) => hsl(h, s, L)),
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return ((x + 0.05) / (y + 0.05)).toFixed(2);
  };
  return (
    <div className="app-pad">
      <div className="row">
        <input type="color" value={base} onChange={(e) => setBase(e.target.value)} style={{ width: 56, height: 40, border: 0, background: "none" }} />
        <input className="input mono" value={base} onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && setBase(e.target.value)} />
        <span className="chip">contrasto su bianco {ratio(base, "#ffffff")} · su nero {ratio(base, "#000000")}</span>
      </div>
      {Object.entries(sets).map(([n, cols]) => (
        <div key={n}>
          <div className="hint" style={{ marginBottom: 4 }}>{n}</div>
          <div className="palette-row">
            {cols.map((c, i) => (
              <div key={i} style={{ background: c, color: lum(c) > 0.4 ? "#000" : "#fff" }} onClick={() => copyText(c).then(() => toast(`${c} copiato`, "success", 1200))}>
                {c}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------- password ----------------
function Password() {
  const [len, setLen] = useState(20);
  const [opts, setOpts] = useState({ upper: true, lower: true, digits: true, symbols: true });
  const [pw, setPw] = useState("");
  const gen = () => {
    const sets = [opts.lower && "abcdefghijkmnopqrstuvwxyz", opts.upper && "ABCDEFGHJKLMNPQRSTUVWXYZ", opts.digits && "23456789", opts.symbols && "!@#$%^&*()-_=+[]{};:,.?"].filter(Boolean).join("");
    if (!sets) return setPw("");
    const rnd = crypto.getRandomValues(new Uint32Array(len));
    setPw([...rnd].map((r) => sets[r % sets.length]).join(""));
  };
  useEffect(gen, [len, opts]);
  const bits = Math.round(len * Math.log2(Math.max(2, (opts.lower ? 25 : 0) + (opts.upper ? 24 : 0) + (opts.digits ? 8 : 0) + (opts.symbols ? 23 : 0))));
  return (
    <div className="app-pad">
      <div className="out-box" style={{ fontSize: 18, textAlign: "center" }}>{pw}</div>
      <div className="usage-bar" style={{ height: 8 }}>
        <i style={{ width: Math.min(100, bits / 1.28) + "%" }} />
      </div>
      <div className="hint">Entropia ≈ {bits} bit — {bits > 100 ? "fortissima" : bits > 70 ? "forte" : bits > 45 ? "media" : "debole"}</div>
      <input type="range" min={8} max={64} value={len} onChange={(e) => setLen(+e.target.value)} />
      <div className="row wrap">
        {Object.entries({ upper: "A-Z", lower: "a-z", digits: "0-9", symbols: "!@#" }).map(([k, n]) => (
          <label key={k} className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} /> {n}
          </label>
        ))}
        <span className="grow" />
        <button className="btn small" onClick={gen}>
          <Icon name="refresh" size={14} />
        </button>
        <button className="btn small primary" onClick={() => copyText(pw).then(() => toast("Password copiata", "success", 1200))}>
          Copia
        </button>
      </div>
    </div>
  );
}

// ---------------- unit converter ----------------
const UNITS = {
  Lunghezza: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254 },
  Peso: { kg: 1, g: 0.001, mg: 1e-6, t: 1000, lb: 0.45359237, oz: 0.028349523 },
  Volume: { l: 1, ml: 0.001, "m³": 1000, gal: 3.785411784, "cup (US)": 0.2365882365 },
  Velocità: { "km/h": 1, "m/s": 3.6, mph: 1.609344, nodi: 1.852 },
  Dati: { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 },
  Tempo: { s: 1, min: 60, h: 3600, giorni: 86400, settimane: 604800, anni: 31557600 },
  Area: { "m²": 1, "km²": 1e6, ettari: 1e4, "ft²": 0.09290304, acri: 4046.8564224 },
};
function Converter() {
  const [cat, setCat] = useState("Lunghezza");
  const [v, setV] = useState(1);
  const [from, setFrom] = useState("km");
  const isTemp = cat === "Temperatura";
  const units = isTemp ? { "°C": 1, "°F": 1, K: 1 } : UNITS[cat];
  const toC = (x, u) => (u === "°C" ? x : u === "°F" ? ((x - 32) * 5) / 9 : x - 273.15);
  const fromC = (c, u) => (u === "°C" ? c : u === "°F" ? (c * 9) / 5 + 32 : c + 273.15);
  return (
    <div className="app-pad">
      <div className="row wrap">
        {[...Object.keys(UNITS), "Temperatura"].map((c) => (
          <button key={c} className={"btn small" + (c === cat ? " primary" : "")} onClick={() => (setCat(c), setFrom(Object.keys(c === "Temperatura" ? { "°C": 1 } : UNITS[c])[0]))}>
            {c}
          </button>
        ))}
      </div>
      <div className="row">
        <input className="input" type="number" value={v} onChange={(e) => setV(+e.target.value)} />
        <select className="select" style={{ width: 130 }} value={from} onChange={(e) => setFrom(e.target.value)}>
          {Object.keys(units).map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      </div>
      {Object.keys(units).map((u) => (
        <div key={u} className="row" style={{ justifyContent: "space-between", padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>
          <span className="muted">{u}</span>
          <b className="mono">{(isTemp ? fromC(toC(v, from), u) : (v * units[from]) / units[u]).toLocaleString("it-IT", { maximumSignificantDigits: 10 })}</b>
        </div>
      ))}
    </div>
  );
}

// ---------------- browser ----------------
function Browser() {
  const [url, setUrl] = useState("https://cloudy.chat");
  const [cur, setCur] = useState("https://cloudy.chat");
  const go = (e) => {
    e?.preventDefault();
    const u = /^https?:\/\//.test(url) ? url : /\.\w{2,}/.test(url) && !url.includes(" ") ? "https://" + url : `https://www.bing.com/search?q=${encodeURIComponent(url)}`;
    setCur(u);
    setUrl(u);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <form className="editor-bar" onSubmit={go}>
        <input className="input grow" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn small primary">Vai</button>
        <button type="button" className="btn small" onClick={() => openExternal(cur)}>
          <Icon name="external" size={14} />
        </button>
        <button type="button" className="btn small" onClick={() => sendMessage(`Leggi questa pagina con web_fetch e riassumila: ${cur}`)}>
          Riassumi
        </button>
      </form>
      {isDesktop ? <webview src={cur} style={{ flex: 1 }} allowpopups="true" /> : <iframe className="browser-frame" style={{ flex: 1 }} src={cur} title="browser" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />}
    </div>
  );
}

// ---------------- markdown studio ----------------
function MarkdownStudio() {
  const [md, setMd] = useState("# Titolo\n\nScrivi **markdown** qui: _anteprima_ in tempo reale.\n\n- elenco\n- puntato\n\n```js\nconsole.log('ciao');\n```");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", height: "100%" }}>
      <textarea className="textarea mono" style={{ borderRadius: 0, border: 0, borderRight: "1px solid var(--border)", height: "100%", resize: "none" }} value={md} onChange={(e) => setMd(e.target.value)} />
      <div style={{ overflow: "auto" }}>
        <div className="editor-bar">
          <button className="btn small" onClick={() => saveAs("documento.md", md, "text/markdown")}>
            .md
          </button>
          <button className="btn small" onClick={() => saveAs("documento.html", `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;max-width:760px;margin:40px auto;line-height:1.6">${renderMarkdown(md)}</body>`, "text/html")}>
            .html
          </button>
        </div>
        <div className="md app-pad" dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }} />
      </div>
    </div>
  );
}

// ---------------- gallery ----------------
function Gallery() {
  const conv = useStore(store, (s) => s.current);
  const imgs = [];
  for (const m of conv?.messages || []) {
    for (const a of m.attachments || []) if (a.kind === "image") imgs.push({ src: `data:${a.mime};base64,${a.data}`, cap: a.name });
    for (const p of m.parts || []) if (p.type === "image") imgs.push({ src: `data:${p.mime};base64,${p.data}`, cap: p.prompt });
  }
  return (
    <div className="app-pad">
      {!imgs.length && <div className="muted">Nessuna immagine in questa conversazione. Chiedi a Cloudy di generarne una!</div>}
      <div className="card-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
        {imgs.map((im, i) => (
          <div key={i} className="gen-image" style={{ margin: 0 }}>
            <img src={im.src} alt={im.cap} onClick={() => saveAs(`immagine-${i + 1}.png`, dataUrlToBlob(im.src))} style={{ cursor: "pointer" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- translator (AI) ----------------
function Translator() {
  const [t, setT] = useState("");
  const [lang, setLang] = useState("inglese");
  return (
    <div className="app-pad">
      <textarea className="textarea" placeholder="Testo da tradurre…" value={t} onChange={(e) => setT(e.target.value)} />
      <div className="row">
        <select className="select" value={lang} onChange={(e) => setLang(e.target.value)}>
          {["inglese", "italiano", "spagnolo", "francese", "tedesco", "portoghese", "cinese", "giapponese", "arabo", "russo"].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <button className="btn primary" disabled={!t.trim()} onClick={() => sendMessage(`Usa la skill translator e traduci in ${lang}, mantenendo tono e formattazione:\n\n${t}`)}>
          Traduci con Cloudy
        </button>
      </div>
    </div>
  );
}

function FileManager() {
  const conv = useStore(store, (s) => s.current);
  useEffect(() => {
    store.set({ panel: "files" });
  }, []);
  return (
    <div className="app-pad">
      <div>I file della cartella di lavoro {conv?.workspace ? <b className="mono">{conv.workspace}</b> : "(nessuna aperta)"} si sfogliano nel pannello laterale.</div>
      <button className="btn primary" onClick={() => store.set({ panel: "files" })}>
        <Icon name="folder" /> Mostra i file
      </button>
    </div>
  );
}

export const APPS = [
  { id: "terminal", name: "Terminale Linux", icon: "🐧", color: "#fbbf24", desc: "Il computer Linux di Cloudy", component: LinuxTerminal, w: 420, h: 220 },
  { id: "files", name: "File", icon: "🗂️", color: "#60a5fa", desc: "Esplora la cartella di lavoro", component: FileManager, w: 420, h: 220 },
  { id: "editor", name: "Editor di codice", icon: "📝", color: "#a78bfa", desc: "Modifica file con evidenziazione", component: Editor, w: 760, h: 520, multi: true },
  { id: "browser", name: "Browser", icon: "🌐", color: "#38bdf8", desc: "Naviga e fai riassumere le pagine", component: Browser, w: 900, h: 620 },
  { id: "notes", name: "Note", icon: "🗒️", color: "#fcd34d", desc: "Note in markdown salvate sul dispositivo", component: Notes, w: 680, h: 480 },
  { id: "calculator", name: "Calcolatrice", icon: "🧮", color: "#34d399", desc: "Scientifica", component: Calculator, w: 340, h: 520 },
  { id: "converter", name: "Convertitore", icon: "📏", color: "#f472b6", desc: "Unità di misura e temperature", component: Converter, w: 460, h: 520 },
  { id: "whiteboard", name: "Lavagna", icon: "🎨", color: "#ec4899", desc: "Disegna e mostra a Cloudy", component: Whiteboard, w: 720, h: 520 },
  { id: "timer", name: "Pomodoro", icon: "⏱️", color: "#f97316", desc: "Timer di concentrazione", component: Timer, w: 380, h: 440 },
  { id: "clock", name: "Orologio mondiale", icon: "🕐", color: "#22d3ee", desc: "Ora nelle città del mondo", component: Clock, w: 560, h: 480 },
  { id: "json", name: "JSON", icon: "🧾", color: "#84cc16", desc: "Formatta e valida JSON", component: JsonTool, w: 560, h: 520 },
  { id: "regex", name: "Regex", icon: "🔣", color: "#eab308", desc: "Prova espressioni regolari", component: RegexTool, w: 560, h: 480 },
  { id: "diff", name: "Confronta testi", icon: "🔀", color: "#14b8a6", desc: "Differenze riga per riga", component: DiffTool, w: 720, h: 520 },
  { id: "text", name: "Strumenti testo", icon: "🔤", color: "#8b5cf6", desc: "Base64, hash, URL, maiuscole, UUID", component: TextTools, w: 560, h: 480 },
  { id: "colors", name: "Colori", icon: "🌈", color: "#f43f5e", desc: "Palette e contrasto", component: Colors, w: 560, h: 520 },
  { id: "password", name: "Password", icon: "🔐", color: "#10b981", desc: "Generatore sicuro", component: Password, w: 460, h: 360 },
  { id: "markdown", name: "Markdown Studio", icon: "📄", color: "#6366f1", desc: "Scrivi e esporta documenti", component: MarkdownStudio, w: 860, h: 560 },
  { id: "gallery", name: "Galleria", icon: "🖼️", color: "#f59e0b", desc: "Immagini della conversazione", component: Gallery, w: 640, h: 480 },
  { id: "translator", name: "Traduttore", icon: "🌍", color: "#06b6d4", desc: "Traduzioni con l'IA", component: Translator, w: 480, h: 360 },
];

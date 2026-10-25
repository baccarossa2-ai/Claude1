import { memo, useMemo, useRef, useState } from "react";
import { Icon } from "./Icons.jsx";
import { renderMarkdown } from "../lib/markdown.js";
import { copyText, fmtBytes, truncate, uid } from "../lib/util.js";
import { modelInfo } from "../state/models.js";
import { askDialog, bump, store, toast } from "../state/store.js";
import { editAndResend, regenerate } from "../state/send.js";
import { saveConversation } from "../state/conversations.js";
import { linux } from "../linux/vm.js";
import { saveAs } from "../platform/native.js";

/** Line diff (LCS) for the "file changed" cards; falls back for huge files. */
export function lineDiff(before = "", after = "") {
  const a = String(before ?? "").split("\n");
  const b = String(after ?? "").split("\n");
  if (a.length * b.length > 4e6) return [...a.map((t) => ({ t, k: "del" })), ...b.map((t) => ({ t, k: "add" }))];
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ t: a[i], k: "ctx" });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: a[i++], k: "del" });
    else out.push({ t: b[j++], k: "add" });
  }
  while (i < n) out.push({ t: a[i++], k: "del" });
  while (j < m) out.push({ t: b[j++], k: "add" });
  // Keep 3 lines of context around changes.
  const keep = new Set();
  out.forEach((l, idx) => {
    if (l.k !== "ctx") for (let d = -3; d <= 3; d++) keep.add(idx + d);
  });
  const res = [];
  let skipped = 0;
  out.forEach((l, idx) => {
    if (keep.has(idx)) {
      if (skipped) res.push({ t: `… ${skipped} righe invariate`, k: "skip" });
      skipped = 0;
      res.push(l);
    } else skipped++;
  });
  return res;
}

const TOOL_LABEL = {
  read_file: "Lettura", write_file: "Scrittura", edit_file: "Modifica", list_dir: "Cartella", run_command: "Comando", self_test: "Test", use_skill: "Skill",
  glob_files: "Ricerca file", search_files: "Cerca nel codice", delete_path: "Eliminazione", move_path: "Spostamento", linux_exec: "Linux", linux_write_file: "Linux · scrivi",
  linux_read_file: "Linux · leggi", copy_to_linux: "→ Linux", copy_from_linux: "← Linux", web_search: "Ricerca web", web_fetch: "Pagina web", http_request: "HTTP",
  generate_image: "Immagine", open_url: "Apri link", todo_write: "Piano", create_artifact: "Artefatto", memory_save: "Memoria", calculator: "Calcolo", current_datetime: "Data e ora", notify_user: "Notifica",
  Bash: "Comando", Read: "Lettura", Write: "Scrittura", Edit: "Modifica", Glob: "Ricerca file", Grep: "Cerca nel codice", WebFetch: "Pagina web", WebSearch: "Ricerca web", TodoWrite: "Piano", Task: "Sotto-agente",
};

function toolTarget(args) {
  if (!args || typeof args !== "object") return "";
  const v = args.command ?? args.path ?? args.file_path ?? args.pattern ?? args.query ?? args.url ?? args.name ?? args.expression ?? args.title ?? args.prompt ?? args.workspace_path ?? args.linux_path ?? (Array.isArray(args.todos) ? `${args.todos.length} passi` : "");
  return typeof v === "string" ? v : JSON.stringify(v);
}

function ToolCard({ part }) {
  const [open, setOpen] = useState(false);
  const label = TOOL_LABEL[part.name] || (part.name.startsWith("mcp__") ? "Connettore · " + part.name.split("__")[2] : part.name);
  return (
    <div className={"tool-card " + (part.status === "running" ? "running" : "")}>
      <div className="tool-head" onClick={() => setOpen((o) => !o)}>
        <span className={"tool-status " + part.status}>
          {part.status === "running" ? <span className="spinner" /> : part.status === "ok" ? <Icon name="check" size={12} stroke={3} /> : part.status === "waiting" ? <Icon name="lock" size={11} /> : <Icon name="x" size={12} stroke={3} />}
        </span>
        <span className="tname">{label}</span>
        <span className="targ">{truncate(toolTarget(part.args), 140)}</span>
        <Icon name={open ? "chevron" : "chevronRight"} size={14} />
      </div>
      {open && (
        <pre className="tool-out">
          {part.args && Object.keys(part.args).length ? `▸ ${JSON.stringify(part.args, null, 2).slice(0, 4000)}\n\n` : ""}
          {part.output ?? (part.status === "waiting" ? "In attesa della tua approvazione…" : "In esecuzione…")}
        </pre>
      )}
    </div>
  );
}

function FileCard({ part }) {
  const [open, setOpen] = useState(false);
  const diff = useMemo(() => (open ? lineDiff(part.before ?? "", part.after ?? "") : []), [open, part]);
  const created = part.before == null;
  const deleted = part.after == null;
  return (
    <div className="tool-card">
      <div className="tool-head" onClick={() => setOpen((o) => !o)}>
        <span className="tool-status ok">
          <Icon name="file" size={11} />
        </span>
        <span className="tname">{deleted ? "Eliminato" : created ? "Creato" : "Modificato"}</span>
        <span className="targ">{part.path}</span>
        <Icon name={open ? "chevron" : "chevronRight"} size={14} />
      </div>
      {open && !deleted && (
        <div className="diff">
          {diff.map((l, i) => (
            <div key={i} className={l.k === "add" ? "add" : l.k === "del" ? "del" : ""} style={l.k === "skip" ? { color: "#7d86a3", fontStyle: "italic" } : undefined}>
              {l.k === "add" ? "+ " : l.k === "del" ? "- " : "  "}
              {l.t}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Todos({ conv }) {
  const todos = conv?.todos || [];
  if (!todos.length) return null;
  return (
    <div className="inline-todos">
      {todos.map((t, i) => (
        <div key={i} className={"todo " + t.status}>
          <span className="box">{t.status === "completed" && <Icon name="check" size={11} stroke={3} />}</span>
          <span className="txt">{t.content}</span>
        </div>
      ))}
    </div>
  );
}

async function onCodeAction(e, conv) {
  const btn = e.target.closest(".cb-btn");
  if (!btn) return;
  const block = btn.closest(".codeblock");
  const code = block.querySelector("code").innerText;
  const lang = block.dataset.lang;
  const act = btn.dataset.act;
  if (act === "copy") {
    await copyText(code);
    btn.textContent = "✓ Copiato";
    setTimeout(() => (btn.textContent = "⧉ Copia"), 1400);
  } else if (act === "save") {
    const ext = { python: "py", javascript: "js", typescript: "ts", bash: "sh", shell: "sh", html: "html", css: "css", json: "json", lua: "lua", sql: "sql", markdown: "md" }[lang] || lang || "txt";
    await saveAs(`codice.${ext}`, code, "text/plain");
    toast("File salvato", "success");
  } else if (act === "preview") {
    const art = { id: uid("art_"), title: lang === "svg" ? "SVG" : "Anteprima HTML", kind: lang === "svg" ? "svg" : "html", content: code, createdAt: Date.now() };
    conv.artifacts = [...(conv.artifacts || []), art];
    saveConversation(conv);
    store.set({ panel: "artifacts", panelArtifact: art.id });
    bump();
  } else if (act === "run") {
    store.set({ panel: "linux" });
    btn.textContent = "… In esecuzione";
    try {
      const cmd = lang === "lua" ? `cat > /mnt/home/snippet.lua <<'CLOUDY_EOF'\n${code}\nCLOUDY_EOF\nlua /mnt/home/snippet.lua` : code;
      const r = await linux.exec(cmd, 120000);
      askDialog({ type: "output", title: "Output dal computer Linux", text: r.output || "(nessun output)", code: r.code });
    } catch (err) {
      toast("Linux: " + err.message, "error");
    }
    btn.textContent = "▶ Esegui";
  }
}

function UserMessage({ msg }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef(null);
  return (
    <div className="msg user">
      <div className="msg-tools">
        <button className="mini-btn" title="Copia" onClick={() => copyText(msg.content)}>
          <Icon name="copy" size={14} />
        </button>
        <button className="mini-btn" title="Modifica e rinvia" onClick={() => setEditing(true)}>
          <Icon name="edit" size={14} />
        </button>
      </div>
      <div style={{ display: "grid", justifyItems: "end", maxWidth: "100%" }}>
        {!!msg.attachments?.length && (
          <div className="attach-row">
            {msg.attachments.map((a) => (
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
              </div>
            ))}
          </div>
        )}
        {editing ? (
          <div className="bubble" style={{ width: "min(620px, 80vw)" }}>
            <textarea ref={ref} className="textarea" defaultValue={msg.content} autoFocus style={{ background: "transparent", border: 0, minHeight: 80 }} />
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn small ghost" onClick={() => setEditing(false)}>
                Annulla
              </button>
              <button
                className="btn small primary"
                onClick={() => {
                  setEditing(false);
                  editAndResend(msg.id, ref.current.value);
                }}
              >
                Invia
              </button>
            </div>
          </div>
        ) : (
          msg.content && <div className="bubble">{msg.content}</div>
        )}
      </div>
    </div>
  );
}

function AssistantMessage({ msg, conv, last, streaming }) {
  const info = modelInfo(msg.modelRef || conv.model);
  const live = streaming && last;
  const textParts = msg.parts.filter((p) => p.type === "text");
  const hasAny = msg.parts.length > 0;
  const runningTool = msg.parts.some((p) => p.type === "tool" && (p.status === "running" || p.status === "waiting"));
  const fullText = msg.content || textParts.map((p) => p.text).join("\n\n");
  const speak = () => {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(fullText.replace(/[#*`_>]/g, ""));
      u.lang = "it-IT";
      speechSynthesis.speak(u);
    } catch {
      toast("Sintesi vocale non disponibile", "error");
    }
  };
  return (
    <div className="msg assistant" style={{ "--mc": info.accent }}>
      <div className={"msg-avatar" + (live ? " streaming" : "")}>
        {info.logo?.src ? <img src={info.logo.src} className={info.logo.invertOnLight ? "inv" : ""} alt="" /> : <b>{info.logo?.monogram || "C"}</b>}
      </div>
      <div className="msg-body">
        <div className="msg-meta">
          <span className="dot" />
          <span className="model-name">{msg.modelName || info.name}</span>
          {msg.providerKind === "claude-code" && <span className="chip claude">Claude Code</span>}
          {msg.durationMs && !live ? <span>· {(msg.durationMs / 1000).toFixed(1)} s</span> : null}
          {msg.costUsd ? <span>· ${msg.costUsd.toFixed(4)}</span> : null}
        </div>
        {msg.reasoning && (
          <details className="reasoning" open={live && !textParts.length}>
            <summary>
              <Icon name="sparkles" size={14} /> {live && !textParts.length ? <span className="shimmer-text">Sta ragionando…</span> : "Ragionamento"}
            </summary>
            <div className="body">{msg.reasoning}</div>
          </details>
        )}
        {!hasAny && live && (
          <div className="thinking-line">
            <span className="typing-dots">
              <i />
              <i />
              <i />
            </span>
            <span className="shimmer-text">{msg.reasoning ? "Sta per rispondere…" : `${info.name} sta pensando…`}</span>
          </div>
        )}
        {msg.parts.map((p, i) => {
          const isLastText = p.type === "text" && i === msg.parts.length - 1;
          if (p.type === "text")
            return (
              <div key={i} className="md" onClick={(e) => onCodeAction(e, conv)}>
                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(p.text) }} />
                {live && isLastText && !runningTool && <span className="caret" />}
              </div>
            );
          if (p.type === "tool") return <ToolCard key={p.id || i} part={p} />;
          if (p.type === "file") return <FileCard key={i} part={p} />;
          if (p.type === "todos") return <Todos key={i} conv={conv} />;
          if (p.type === "image")
            return (
              <div className="gen-image" key={i}>
                <img src={`data:${p.mime};base64,${p.data}`} alt={p.prompt || "immagine"} />
                {p.prompt && <div className="cap">{truncate(p.prompt, 120)}</div>}
              </div>
            );
          if (p.type === "artifact")
            return (
              <div key={i}>
                <button className="artifact-chip" onClick={() => store.set({ panel: "artifacts", panelArtifact: p.id })}>
                  <Icon name="layers" /> <b>{p.title}</b> <span className="muted">· apri artefatto</span>
                </button>
              </div>
            );
          return null;
        })}
        {msg.status === "stopped" && <div className="hint">⏹ Interrotto{msg.error ? ` — ${msg.error}` : ""}</div>}
        {msg.status === "error" && (
          <div className="msg-error">
            <Icon name="alert" />
            <div className="grow">
              <div>{msg.error}</div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn small" onClick={() => regenerate()}>
                  <Icon name="refresh" size={14} /> Riprova
                </button>
                <button className="btn small" onClick={() => askDialog({ type: "switch-model", message: msg.error, fromRef: conv.model }).then((r) => r && (conv.model = r) && regenerate())}>
                  Cambia modello
                </button>
              </div>
            </div>
          </div>
        )}
        {!live && msg.status !== "error" && (
          <div className="msg-actions">
            <button className="mini-btn" onClick={() => copyText(fullText).then(() => toast("Copiato", "success", 1500))}>
              <Icon name="copy" size={14} /> Copia
            </button>
            {last && (
              <button className="mini-btn" onClick={() => regenerate()}>
                <Icon name="refresh" size={14} /> Rigenera
              </button>
            )}
            <button className="mini-btn" onClick={speak}>
              <Icon name="mic" size={14} /> Leggi
            </button>
            <button className="mini-btn" onClick={() => saveAs("risposta.md", fullText, "text/markdown")}>
              <Icon name="download" size={14} /> Salva
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export const Message = memo(function Message({ msg, conv, last, streaming, rev }) {
  return msg.role === "user" ? <UserMessage msg={msg} /> : <AssistantMessage msg={msg} conv={conv} last={last} streaming={streaming} rev={rev} />;
});

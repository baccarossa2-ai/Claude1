// The agent's tools. The first seven keep the exact names and contracts of the
// original host (read_file, write_file, list_dir, edit_file, self_test,
// use_skill, run_command); the rest extend it into a Claude Code + Cowork kit.
//
// kind decides approvals: read / meta / sandbox never ask; write / exec /
// net-write ask in "ask" mode and are refused in "readonly"; plan mode does not
// offer write / exec tools at all.
import { httpFetch } from "../platform/http.js";
import { invoke, isDesktop, notify, openExternal } from "../platform/native.js";
import { linux, linuxExec } from "../linux/vm.js";
import { cleanRel, globToRegExp, walk } from "./workspace.js";
import { uid, isTextFile } from "../lib/util.js";

const MAX_OUT = 30000;
const clip = (s, n = MAX_OUT) => {
  const str = String(s ?? "");
  return str.length > n ? str.slice(0, n) + `\n…[troncato: ${str.length - n} caratteri in più]` : str;
};
const needWs = (ctx) => {
  if (!ctx.ws) throw new Error("Nessuna cartella di lavoro aperta. Chiedi all'utente di sceglierne una (modalità Code o Cowork).");
  return ctx.ws;
};
const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });

async function shellRun(ctx, command, timeoutSeconds) {
  const timeoutMs = Math.min(Math.max(Number(timeoutSeconds) || 120, 5), 1800) * 1000;
  if (isDesktop && ctx.ws?.kind === "desktop") {
    const r = await invoke("shell:exec", { command, cwd: ctx.ws.root, timeoutMs, id: uid("sh_") });
    return formatExec(r);
  }
  // No host shell on Android / web: the AI's own Linux computer runs it.
  const r = await linuxExec(ctx.linuxBackend, command, timeoutMs);
  return "[eseguito nel computer Linux di Cloudy]\n" + formatExec(r);
}

function formatExec(r) {
  const parts = [];
  if (r.stdout) parts.push(r.stdout.trimEnd());
  if (r.stderr) parts.push("[stderr]\n" + r.stderr.trimEnd());
  parts.push(r.timedOut ? "[tempo scaduto — processo interrotto]" : `[codice di uscita ${r.code ?? "?"}]`);
  return clip(parts.join("\n"));
}

function htmlToText(html, baseUrl) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,noscript,svg,iframe,nav,footer,header form").forEach((n) => n.remove());
  const title = doc.title?.trim();
  const lines = [];
  const walkNode = (node) => {
    for (const el of node.childNodes) {
      if (el.nodeType === 3) {
        const t = el.textContent.replace(/\s+/g, " ");
        if (t.trim()) lines.push(t);
        continue;
      }
      if (el.nodeType !== 1) continue;
      const tag = el.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) lines.push(`\n\n${"#".repeat(Number(tag[1]))} ${el.textContent.trim()}\n`);
      else if (tag === "a" && el.getAttribute("href")) {
        let href = el.getAttribute("href");
        try {
          href = new URL(href, baseUrl).toString();
        } catch {
          /* keep */
        }
        const t = el.textContent.trim();
        if (t) lines.push(` [${t}](${href}) `);
      } else if (tag === "li") {
        lines.push("\n- ");
        walkNode(el);
      } else if (["p", "div", "section", "article", "br", "tr", "pre", "blockquote"].includes(tag)) {
        lines.push("\n");
        walkNode(el);
        lines.push("\n");
      } else if (tag === "img" && el.alt) lines.push(` [immagine: ${el.alt}] `);
      else walkNode(el);
    }
  };
  walkNode(doc.body || doc);
  const text = lines.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return (title ? `# ${title}\n\n` : "") + text;
}

async function webSearch(query, count = 8) {
  const results = [];
  try {
    const res = await httpFetch(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", "Accept-Language": "it-IT,it;q=0.9,en;q=0.8" },
    });
    const xml = new DOMParser().parseFromString(await res.text(), "text/xml");
    for (const item of xml.querySelectorAll("item")) {
      results.push({ title: item.querySelector("title")?.textContent, url: item.querySelector("link")?.textContent, snippet: item.querySelector("description")?.textContent });
      if (results.length >= count) break;
    }
  } catch {
    /* fall through to DuckDuckGo */
  }
  if (!results.length) {
    try {
      const res = await httpFetch("https://html.duckduckgo.com/html/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36" },
        body: "q=" + encodeURIComponent(query),
      });
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      for (const r of doc.querySelectorAll(".result")) {
        const a = r.querySelector("a.result__a");
        if (!a) continue;
        let url = a.getAttribute("href") || "";
        const m = /uddg=([^&]+)/.exec(url);
        if (m) url = decodeURIComponent(m[1]);
        results.push({ title: a.textContent.trim(), url, snippet: r.querySelector(".result__snippet")?.textContent?.trim() });
        if (results.length >= count) break;
      }
    } catch {
      /* both engines failed */
    }
  }
  return results;
}

/** A small, safe arithmetic evaluator (no eval). */
export function calculate(expr) {
  const src = String(expr).replace(/×/g, "*").replace(/÷/g, "/").replace(/,/g, ".").replace(/\*\*/g, "^");
  const tokens = src.match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?|[a-zA-Z_]+|[-+*/^%(),!]/g);
  if (!tokens || tokens.join("") !== src.replace(/\s+/g, "")) throw new Error("Espressione non valida");
  const FN = { sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, ln: Math.log, log: Math.log10, log2: Math.log2, exp: Math.exp, round: Math.round, floor: Math.floor, ceil: Math.ceil };
  const CONST = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const factorial = (n) => {
    if (n < 0 || !Number.isInteger(n) || n > 170) throw new Error("Fattoriale non valido");
    let r = 1;
    for (let k = 2; k <= n; k++) r *= k;
    return r;
  };
  const primary = () => {
    const t = next();
    if (t === undefined) throw new Error("Espressione incompleta");
    if (t === "(") {
      const v = expression();
      if (next() !== ")") throw new Error("Parentesi mancante");
      return v;
    }
    if (t === "-") return -power();
    if (t === "+") return power();
    if (/^\d/.test(t)) return Number(t);
    const name = t.toLowerCase();
    if (name in CONST) return CONST[name];
    if (name in FN) {
      if (next() !== "(") throw new Error(`Manca "(" dopo ${name}`);
      const v = expression();
      if (next() !== ")") throw new Error("Parentesi mancante");
      return FN[name](v);
    }
    throw new Error(`Simbolo sconosciuto: ${t}`);
  };
  const postfix = () => {
    let v = primary();
    while (peek() === "!") {
      next();
      v = factorial(v);
    }
    return v;
  };
  const power = () => {
    const b = postfix();
    if (peek() === "^") {
      next();
      return Math.pow(b, power());
    }
    return b;
  };
  const term = () => {
    let v = power();
    while (["*", "/", "%"].includes(peek())) {
      const op = next();
      const r = power();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  };
  const expression = () => {
    let v = term();
    while (["+", "-"].includes(peek())) v = next() === "+" ? v + term() : v - term();
    return v;
  };
  const v = expression();
  if (i < tokens.length) throw new Error(`Simbolo inatteso: ${tokens[i]}`);
  return v;
}

/** Validate model-supplied arguments against a (flat) JSON schema. */
export function validateArgs(schema, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "gli argomenti devono essere un oggetto JSON";
  if (args.__invalid_json !== undefined) return `JSON non valido: ${String(args.__invalid_json).slice(0, 200)}`;
  for (const r of schema.required || []) if (args[r] === undefined || args[r] === null) return `manca il campo obbligatorio "${r}"`;
  for (const [k, v] of Object.entries(args)) {
    const p = schema.properties?.[k];
    if (!p) continue;
    const t = Array.isArray(v) ? "array" : v === null ? "null" : typeof v;
    const want = p.type;
    if (!want) continue;
    const ok = want === t || (want === "integer" && t === "number" && Number.isInteger(v)) || (want === "number" && t === "number");
    if (!ok) return `il campo "${k}" deve essere ${want}, non ${t}`;
    if (p.enum && !p.enum.includes(v)) return `il campo "${k}" deve essere uno di: ${p.enum.join(", ")}`;
  }
  return null;
}

export const BASE_TOOLS = [
  // ---- the original seven ----
  {
    name: "read_file",
    kind: "read",
    description: "Leggi un file di testo della cartella di lavoro. Usa offset/limit (righe) per file grandi.",
    schema: obj({ path: { type: "string", description: "Percorso relativo alla cartella di lavoro" }, offset: { type: "integer", description: "Prima riga (1 = inizio)" }, limit: { type: "integer", description: "Numero massimo di righe" } }, ["path"]),
    async run({ path, offset, limit }, ctx) {
      const ws = needWs(ctx);
      const text = await ws.read(cleanRel(path));
      if (!offset && !limit) return clip(text, 120000);
      const lines = text.split("\n");
      const start = Math.max(1, offset || 1);
      const slice = lines.slice(start - 1, limit ? start - 1 + limit : undefined);
      return clip(`[righe ${start}-${start + slice.length - 1} di ${lines.length}]\n` + slice.join("\n"), 120000);
    },
  },
  {
    name: "write_file",
    kind: "write",
    description: "Crea o sovrascrivi un file di testo nella cartella di lavoro (le cartelle mancanti vengono create).",
    schema: obj({ path: { type: "string", description: "Percorso relativo alla cartella di lavoro" }, content: { type: "string" } }, ["path", "content"]),
    async run({ path, content }, ctx) {
      const ws = needWs(ctx);
      const rel = cleanRel(path);
      const before = await ws.read(rel).catch(() => null);
      await ws.write(rel, content);
      ctx.emit?.({ type: "file", path: rel, before, after: content });
      return `${before === null ? "Creato" : "Aggiornato"} ${rel} (${new Blob([content]).size} byte)`;
    },
  },
  {
    name: "list_dir",
    kind: "read",
    description: "Elenca il contenuto di una cartella (prima le sottocartelle).",
    schema: obj({ path: { type: "string", description: "Percorso relativo (vuoto = radice)" } }),
    async run({ path }, ctx) {
      const ws = needWs(ctx);
      const entries = await ws.list(cleanRel(path || ""));
      entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
      if (!entries.length) return "(cartella vuota)";
      return clip(entries.map((e) => (e.type === "dir" ? `${e.name}/` : `${e.name}  (${e.size ?? 0} B)`)).join("\n"));
    },
  },
  {
    name: "edit_file",
    kind: "write",
    description: "Sostituisci un testo esatto in un file. old_string deve corrispondere esattamente (spazi inclusi) e comparire una sola volta, a meno di replace_all=true.",
    schema: obj({ path: { type: "string" }, old_string: { type: "string", description: "Testo esatto da sostituire" }, new_string: { type: "string", description: "Testo nuovo" }, replace_all: { type: "boolean" } }, ["path", "old_string", "new_string"]),
    async run({ path, old_string, new_string, replace_all }, ctx) {
      const ws = needWs(ctx);
      const rel = cleanRel(path);
      const text = await ws.read(rel);
      const count = old_string ? text.split(old_string).length - 1 : 0;
      if (!count) throw new Error(`old_string non trovato in ${rel}. Rileggi il file e copia il testo esatto.`);
      if (count > 1 && !replace_all) throw new Error(`old_string compare ${count} volte in ${rel}: aggiungi contesto per renderlo unico o usa replace_all.`);
      const next = replace_all ? text.split(old_string).join(new_string) : text.replace(old_string, () => new_string);
      await ws.write(rel, next);
      ctx.emit?.({ type: "file", path: rel, before: text, after: next });
      return `Modificato ${rel} (${replace_all ? count : 1} sostituzione/i)`;
    },
  },
  {
    name: "self_test",
    kind: "exec",
    description: "Esegui i test del progetto (rilevati automaticamente: npm test, pytest, go test, cargo test). Passa command solo se quello rilevato è sbagliato.",
    schema: obj({ command: { type: "string", description: "Comando di test esplicito (facoltativo)" } }),
    async run({ command }, ctx) {
      const ws = needWs(ctx);
      let cmd = command;
      if (!cmd) {
        const has = async (f) => !!(await ws.stat(f).catch(() => null));
        if (await has("package.json")) {
          const pkg = JSON.parse(await ws.read("package.json"));
          cmd = pkg.scripts?.test ? "npm test" : null;
        }
        if (!cmd && ((await has("pytest.ini")) || (await has("pyproject.toml")) || (await has("tests")))) cmd = "python -m pytest -q";
        if (!cmd && (await has("go.mod"))) cmd = "go test ./...";
        if (!cmd && (await has("Cargo.toml"))) cmd = "cargo test";
        if (!cmd) return "Nessuna suite di test rilevata. Indica il comando con il parametro command.";
      }
      return `$ ${cmd}\n` + (await shellRun(ctx, cmd, 600));
    },
  },
  {
    name: "use_skill",
    kind: "meta",
    description: "Carica le istruzioni complete di una skill (elencate nel prompt di sistema). Usala quando il compito corrisponde alla skill.",
    schema: obj({ name: { type: "string", description: "Nome della skill" } }, ["name"]),
    async run({ name }, ctx) {
      const s = (ctx.skills || []).find((x) => x.name === name) || (ctx.skills || []).find((x) => x.name.toLowerCase() === String(name).toLowerCase());
      if (!s) return `Skill "${name}" non trovata. Disponibili: ${(ctx.skills || []).map((x) => x.name).join(", ")}`;
      return `# Skill: ${s.name}\n${s.description ? `_${s.description}_\n\n` : ""}${s.content}`;
    },
  },
  {
    name: "run_command",
    kind: "exec",
    description:
      "Esegui un comando di shell nella cartella di lavoro e ricevi l'output. Su Windows la shell è PowerShell; su Android il comando gira nel computer Linux di Cloudy. Richiede l'approvazione dell'utente.",
    schema: obj({ command: { type: "string" }, timeout_seconds: { type: "integer", description: "Timeout (default 120, max 1800)" } }, ["command"]),
    run: ({ command, timeout_seconds }, ctx) => shellRun(ctx, command, timeout_seconds),
  },

  // ---- file tools in the style of Claude Code ----
  {
    name: "glob_files",
    kind: "read",
    description: 'Trova file per nome con un pattern glob (es. "**/*.js", "src/**/test_*.py").',
    schema: obj({ pattern: { type: "string" }, path: { type: "string", description: "Sottocartella da cui partire" } }, ["pattern"]),
    async run({ pattern, path }, ctx) {
      const ws = needWs(ctx);
      const re = globToRegExp(pattern);
      const base = cleanRel(path || "");
      const files = (await walk(ws, base, 8000)).filter((f) => re.test(base ? f.path.slice(base.length + 1) : f.path) || re.test(f.path));
      return files.length ? clip(files.map((f) => f.path).join("\n")) : "Nessun file corrisponde.";
    },
  },
  {
    name: "search_files",
    kind: "read",
    description: "Cerca un testo (o una regex) dentro i file di testo della cartella di lavoro. Restituisce file:riga: contenuto.",
    schema: obj({ query: { type: "string" }, regex: { type: "boolean" }, path: { type: "string" }, glob: { type: "string", description: 'Filtra i file (es. "*.ts")' }, case_sensitive: { type: "boolean" } }, ["query"]),
    async run({ query, regex, path, glob, case_sensitive }, ctx) {
      const ws = needWs(ctx);
      const flags = case_sensitive ? "" : "i";
      const re = regex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
      const g = glob ? globToRegExp(glob.includes("/") ? glob : "**/" + glob) : null;
      const files = (await walk(ws, path || "", 6000)).filter((f) => f.size < 1500000 && isTextFile(f.path) && (!g || g.test(f.path)));
      const hits = [];
      for (const f of files) {
        if (hits.length >= 300) break;
        let text;
        try {
          text = await ws.read(f.path);
        } catch {
          continue;
        }
        const lines = text.split("\n");
        for (let i = 0; i < lines.length && hits.length < 300; i++) if (re.test(lines[i])) hits.push(`${f.path}:${i + 1}: ${lines[i].trim().slice(0, 240)}`);
      }
      return hits.length ? clip(hits.join("\n")) : `Nessun risultato per "${query}" (${files.length} file controllati).`;
    },
  },
  {
    name: "delete_path",
    kind: "write",
    description: "Elimina un file o una cartella (ricorsivamente) dalla cartella di lavoro.",
    schema: obj({ path: { type: "string" } }, ["path"]),
    async run({ path }, ctx) {
      const ws = needWs(ctx);
      const rel = cleanRel(path);
      if (!rel) throw new Error("Non posso eliminare la radice della cartella di lavoro.");
      await ws.remove(rel);
      ctx.emit?.({ type: "file", path: rel, before: "(eliminato)", after: null });
      return `Eliminato ${rel}`;
    },
  },
  {
    name: "move_path",
    kind: "write",
    description: "Sposta o rinomina un file/cartella nella cartella di lavoro.",
    schema: obj({ from: { type: "string" }, to: { type: "string" } }, ["from", "to"]),
    async run({ from, to }, ctx) {
      const ws = needWs(ctx);
      await ws.move(cleanRel(from), cleanRel(to));
      return `Spostato ${cleanRel(from)} → ${cleanRel(to)}`;
    },
  },

  // ---- the AI's own Linux computer ----
  {
    name: "linux_exec",
    kind: "sandbox",
    description:
      "Esegui comandi nel TUO computer Linux personale (Linux 6.8 Buildroot: busybox, sh, lua, awk, sed, bc, curl, wget, tar, vi, diff, patch…). È isolato dal computer dell'utente: puoi sperimentare liberamente. La cartella persistente è /mnt/home (sopravvive ai riavvii). Lo stato della shell (cd, variabili) resta tra un comando e l'altro.",
    schema: obj({ command: { type: "string" }, timeout_seconds: { type: "integer" } }, ["command"]),
    async run({ command, timeout_seconds }, ctx) {
      const timeoutMs = Math.min(Math.max(Number(timeout_seconds) || 120, 5), 1800) * 1000;
      ctx.emit?.({ type: "linux" });
      return formatExec(await linuxExec(ctx.linuxBackend, command, timeoutMs));
    },
  },
  {
    name: "linux_write_file",
    kind: "sandbox",
    description: "Scrivi un file nel tuo computer Linux, sotto /mnt (es. /mnt/home/script.lua).",
    schema: obj({ path: { type: "string", description: "Percorso sotto /mnt" }, content: { type: "string" } }, ["path", "content"]),
    async run({ path, content }) {
      const p = await linux.writeFile(path, content);
      return `Scritto ${p} (${new Blob([content]).size} byte)`;
    },
  },
  {
    name: "linux_read_file",
    kind: "sandbox",
    description: "Leggi un file dal tuo computer Linux (sotto /mnt).",
    schema: obj({ path: { type: "string" } }, ["path"]),
    async run({ path }) {
      return clip(new TextDecoder().decode(await linux.readFile(path)));
    },
  },
  {
    name: "copy_to_linux",
    kind: "sandbox",
    description: "Copia un file dalla cartella di lavoro dell'utente al tuo computer Linux (/mnt/home/...).",
    schema: obj({ workspace_path: { type: "string" }, linux_path: { type: "string", description: "Destinazione sotto /mnt (default /mnt/home/<nome>)" } }, ["workspace_path"]),
    async run({ workspace_path, linux_path }, ctx) {
      const ws = needWs(ctx);
      const rel = cleanRel(workspace_path);
      const b64 = await ws.readBase64(rel);
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dest = await linux.writeFile(linux_path || `/mnt/home/${rel.split("/").pop()}`, bytes);
      return `Copiato ${rel} → ${dest}`;
    },
  },
  {
    name: "copy_from_linux",
    kind: "write",
    description: "Copia un file dal tuo computer Linux (/mnt/...) alla cartella di lavoro dell'utente.",
    schema: obj({ linux_path: { type: "string" }, workspace_path: { type: "string" } }, ["linux_path", "workspace_path"]),
    async run({ linux_path, workspace_path }, ctx) {
      const ws = needWs(ctx);
      const bytes = await linux.readFile(linux_path);
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      await ws.writeBase64(cleanRel(workspace_path), btoa(s));
      return `Copiato ${linux_path} → ${cleanRel(workspace_path)}`;
    },
  },

  // ---- web ----
  {
    name: "web_search",
    kind: "net",
    description: "Cerca sul web e ottieni titoli, link e anteprime dei risultati.",
    schema: obj({ query: { type: "string" }, count: { type: "integer", description: "Numero di risultati (max 15)" } }, ["query"]),
    async run({ query, count }) {
      const r = await webSearch(query, Math.min(count || 8, 15));
      if (!r.length) return "Nessun risultato (il motore di ricerca potrebbe essere irraggiungibile). Prova web_fetch su un sito specifico.";
      return r.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${(x.snippet || "").trim()}`).join("\n\n");
    },
  },
  {
    name: "web_fetch",
    kind: "net",
    description: "Scarica una pagina web e restituiscine il testo leggibile (markdown semplificato), oppure il contenuto di file JSON/testo.",
    schema: obj({ url: { type: "string" }, max_chars: { type: "integer" } }, ["url"]),
    async run({ url, max_chars }) {
      if (!/^https?:\/\//i.test(url)) throw new Error("L'URL deve iniziare con http:// o https://");
      const res = await httpFetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36 CloudyDesktop/2", Accept: "text/html,application/json,text/plain,*/*" } });
      const type = res.headers.get("content-type") || "";
      const body = await res.text();
      const text = /html/i.test(type) ? htmlToText(body, url) : body;
      return clip(`[${res.status} ${type}] ${url}\n\n${text}`, Math.min(max_chars || 40000, 100000));
    },
  },
  {
    name: "http_request",
    kind: "net-write",
    description: "Esegui una richiesta HTTP arbitraria (API REST). GET non chiede conferma, gli altri metodi sì.",
    schema: obj({ method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] }, url: { type: "string" }, headers: { type: "object" }, body: { type: "string" } }, ["method", "url"]),
    async run({ method, url, headers, body }) {
      const res = await httpFetch(url, { method, headers: headers || {}, body: method === "GET" || method === "HEAD" ? undefined : body });
      const hdrs = [];
      res.headers.forEach((v, k) => hdrs.push(`${k}: ${v}`));
      return clip(`HTTP ${res.status}\n${hdrs.slice(0, 20).join("\n")}\n\n${method === "HEAD" ? "" : await res.text()}`);
    },
  },
  {
    name: "generate_image",
    kind: "net",
    description: "Genera un'immagine da una descrizione testuale (gratuito, senza chiave) e mostrala nella chat.",
    schema: obj({ prompt: { type: "string", description: "Descrizione dettagliata, preferibilmente in inglese" }, width: { type: "integer" }, height: { type: "integer" } }, ["prompt"]),
    async run({ prompt, width, height }, ctx) {
      const w = Math.min(Math.max(width || 1024, 256), 1536);
      const h = Math.min(Math.max(height || 1024, 256), 1536);
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&nologo=true&seed=${Math.floor(Math.random() * 1e9)}`;
      const res = await httpFetch(url);
      if (!res.ok) throw new Error(`Generazione non riuscita (${res.status})`);
      const blob = await res.blob();
      const data = await new Promise((r) => {
        const fr = new FileReader();
        fr.onload = () => r(String(fr.result).split(",")[1]);
        fr.readAsDataURL(blob);
      });
      ctx.emit?.({ type: "image", mime: blob.type || "image/jpeg", data, prompt });
      return `Immagine generata (${w}×${h}) e mostrata all'utente nella chat.`;
    },
  },
  {
    name: "open_url",
    kind: "net-write",
    description: "Apri un link nel browser dell'utente.",
    schema: obj({ url: { type: "string" } }, ["url"]),
    async run({ url }) {
      await openExternal(url);
      return `Aperto ${url}`;
    },
  },

  // ---- Cowork ----
  {
    name: "todo_write",
    kind: "meta",
    description: "Crea o aggiorna la lista dei passi del compito (visibile all'utente). Invia sempre la lista COMPLETA. Un solo passo alla volta in_progress; segna completed appena finito.",
    schema: obj(
      {
        todos: {
          type: "array",
          items: { type: "object", properties: { content: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "completed"] } }, required: ["content", "status"] },
        },
      },
      ["todos"]
    ),
    async run({ todos }, ctx) {
      ctx.emit?.({ type: "todos", todos });
      const done = todos.filter((t) => t.status === "completed").length;
      return `Lista aggiornata: ${done}/${todos.length} completati.`;
    },
  },
  {
    name: "create_artifact",
    kind: "meta",
    description:
      "Mostra all'utente un artefatto nel pannello laterale: una pagina/app HTML interattiva (kind html, file unico con CSS/JS inline), un documento markdown, un'immagine SVG o un file di codice. Usalo per siti, giochi, grafici, documenti e prototipi.",
    schema: obj({ title: { type: "string" }, kind: { type: "string", enum: ["html", "markdown", "svg", "code"] }, content: { type: "string" }, language: { type: "string", description: "Linguaggio (per kind code)" } }, ["title", "kind", "content"]),
    async run({ title, kind, content, language }, ctx) {
      const id = uid("art_");
      ctx.emit?.({ type: "artifact", artifact: { id, title, kind, content, language, createdAt: Date.now() } });
      return `Artefatto "${title}" mostrato all'utente (id ${id}).`;
    },
  },
  {
    name: "memory_save",
    kind: "meta",
    description: "Salva un'informazione duratura sull'utente o sui suoi progetti (preferenze, nomi, decisioni) da ricordare nelle prossime conversazioni.",
    schema: obj({ text: { type: "string" } }, ["text"]),
    async run({ text }, ctx) {
      ctx.emit?.({ type: "memory", text });
      return "Memorizzato.";
    },
  },
  {
    name: "calculator",
    kind: "read",
    description: "Calcola un'espressione matematica in modo esatto (+ - * / ^ % !, parentesi, sin cos tan sqrt log ln exp abs round floor ceil, pi, e).",
    schema: obj({ expression: { type: "string" } }, ["expression"]),
    async run({ expression }) {
      const v = calculate(expression);
      return `${expression} = ${Number.isFinite(v) ? +v.toPrecision(15) : v}`;
    },
  },
  {
    name: "current_datetime",
    kind: "read",
    description: "Data, ora e fuso orario attuali dell'utente.",
    schema: obj({}),
    async run() {
      const d = new Date();
      return `${d.toLocaleString("it-IT", { dateStyle: "full", timeStyle: "long" })}\nISO: ${d.toISOString()}\nFuso: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
    },
  },
  {
    name: "notify_user",
    kind: "meta",
    description: "Invia una notifica di sistema all'utente (utile al termine di compiti lunghi).",
    schema: obj({ title: { type: "string" }, body: { type: "string" } }, ["title"]),
    async run({ title, body }) {
      await notify(title, body || "");
      return "Notifica inviata.";
    },
  },
];

export const READ_KINDS = new Set(["read", "meta", "net", "sandbox"]);

/** Which tools a turn may see. */
const WORKSPACE_TOOLS = new Set(["read_file", "write_file", "list_dir", "edit_file", "self_test", "run_command", "glob_files", "search_files", "delete_path", "move_path", "copy_to_linux", "copy_from_linux"]);

export function toolsForTurn({ mode, agentMode, hasWorkspace, extra = [], chatTools = true }) {
  let list = [...BASE_TOOLS, ...extra];
  if (!hasWorkspace) list = list.filter((t) => !WORKSPACE_TOOLS.has(t.name));
  if (mode === "chat") {
    if (!chatTools) return [];
    list = list.filter((t) => !["self_test", "todo_write"].includes(t.name));
  }
  // Plan mode is read-only: write / exec tools are not offered at all.
  if (agentMode === "plan") list = list.filter((t) => READ_KINDS.has(t.kind));
  return list;
}

/** "deny" | "ask" | "allow" for one call under an access level. */
export function approvalFor(tool, args, access) {
  if (access === "full") return "allow";
  const kind = tool.kind || "exec";
  if (kind === "net-write" && tool.name === "http_request" && /^(GET|HEAD)$/i.test(args?.method || "")) return "allow";
  if (READ_KINDS.has(kind)) return "allow";
  if (access === "readonly") return "deny";
  return "ask";
}

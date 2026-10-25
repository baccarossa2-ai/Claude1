// The folder the agent works in, behind one interface:
//   desktop — a real folder on disk; every path is confined in the MAIN
//             process (electron/ipc/fs.cjs), never trusted from here
//   android — app storage via @capacitor/filesystem (Directory.External)
//   web     — the Origin Private File System
import { invoke, isAndroid, isDesktop } from "../platform/native.js";
import { b64ToBytes, bytesToB64 } from "../platform/http.js";

/** Normalise a model-supplied relative path; throws when it escapes the root. */
export function cleanRel(rel) {
  const raw = String(rel ?? "").replace(/\\/g, "/").trim();
  if (/^[a-zA-Z]:/.test(raw) || raw.startsWith("/")) {
    throw new Error(`Percorso assoluto non ammesso: "${raw}". Usa percorsi relativi alla cartella di lavoro.`);
  }
  const parts = [];
  for (const seg of raw.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) throw new Error(`Il percorso "${raw}" esce dalla cartella di lavoro.`);
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

function desktopWorkspace(root) {
  const call = (op, ...a) => invoke("fs:" + op, root, ...a);
  return {
    kind: "desktop",
    root,
    label: root.split(/[\\/]/).filter(Boolean).pop() || root,
    list: (rel = "") => call("list", cleanRel(rel)),
    read: (rel) => call("read", cleanRel(rel), "utf8"),
    readBase64: (rel) => call("read", cleanRel(rel), "base64"),
    write: (rel, text) => call("write", cleanRel(rel), text, "utf8"),
    writeBase64: (rel, b64) => call("write", cleanRel(rel), b64, "base64"),
    mkdir: (rel) => call("mkdir", cleanRel(rel)),
    remove: (rel) => call("remove", cleanRel(rel)),
    move: (a, b) => call("move", cleanRel(a), cleanRel(b)),
    stat: (rel) => call("stat", cleanRel(rel)),
    reveal: (rel = "") => call("reveal", cleanRel(rel)),
  };
}

async function androidWorkspace(name) {
  const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
  const base = `Cloudy/Progetti/${name}`;
  let directory = Directory.External;
  try {
    await Filesystem.mkdir({ path: base, directory, recursive: true });
  } catch (e) {
    if (!/exist/i.test(String(e?.message))) directory = Directory.Data;
    await Filesystem.mkdir({ path: base, directory, recursive: true }).catch(() => {});
  }
  const p = (rel) => (cleanRel(rel) ? `${base}/${cleanRel(rel)}` : base);
  const stat = async (rel) => {
    try {
      const s = await Filesystem.stat({ path: p(rel), directory });
      return { type: s.type === "directory" ? "dir" : "file", size: s.size, mtime: s.mtime };
    } catch {
      return null;
    }
  };
  return {
    kind: "android",
    root: base,
    label: name,
    async list(rel = "") {
      const { files } = await Filesystem.readdir({ path: p(rel), directory });
      return files.map((f) => ({ name: f.name, type: f.type === "directory" ? "dir" : "file", size: f.size ?? 0, mtime: f.mtime ?? 0 }));
    },
    async read(rel) {
      const r = await Filesystem.readFile({ path: p(rel), directory, encoding: Encoding.UTF8 });
      return typeof r.data === "string" ? r.data : await r.data.text();
    },
    async readBase64(rel) {
      const r = await Filesystem.readFile({ path: p(rel), directory });
      return typeof r.data === "string" ? r.data : bytesToB64(new Uint8Array(await r.data.arrayBuffer()));
    },
    write: (rel, text) => Filesystem.writeFile({ path: p(rel), directory, data: text, encoding: Encoding.UTF8, recursive: true }),
    writeBase64: (rel, b64) => Filesystem.writeFile({ path: p(rel), directory, data: b64, recursive: true }),
    mkdir: (rel) => Filesystem.mkdir({ path: p(rel), directory, recursive: true }),
    async remove(rel) {
      const s = await stat(rel);
      if (!s) throw new Error(`"${rel}" non esiste`);
      if (s.type === "dir") await Filesystem.rmdir({ path: p(rel), directory, recursive: true });
      else await Filesystem.deleteFile({ path: p(rel), directory });
    },
    move: (a, b) => Filesystem.rename({ from: p(a), to: p(b), directory, toDirectory: directory }),
    stat,
  };
}

async function opfsWorkspace(name) {
  const rootDir = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
  const walkTo = async (rel, { create = false, dirOnly = false } = {}) => {
    const parts = cleanRel(rel).split("/").filter(Boolean);
    let dir = rootDir;
    const last = parts.pop();
    for (const seg of parts) dir = await dir.getDirectoryHandle(seg, { create });
    if (!last) return { dir, handle: dir, name: "" };
    if (dirOnly) return { dir, handle: await dir.getDirectoryHandle(last, { create }), name: last };
    try {
      return { dir, handle: await dir.getFileHandle(last, { create }), name: last };
    } catch {
      return { dir, handle: await dir.getDirectoryHandle(last), name: last };
    }
  };
  const writeBytes = async (rel, data) => {
    const { handle } = await walkTo(rel, { create: true });
    const w = await handle.createWritable();
    await w.write(data);
    await w.close();
  };
  const api = {
    kind: "web",
    root: "/" + name,
    label: name,
    async list(rel = "") {
      const { handle } = await walkTo(rel, { dirOnly: !!cleanRel(rel) });
      const out = [];
      for await (const [n, h] of handle.entries()) {
        if (h.kind === "directory") out.push({ name: n, type: "dir", size: 0 });
        else {
          const f = await h.getFile();
          out.push({ name: n, type: "file", size: f.size, mtime: f.lastModified });
        }
      }
      return out;
    },
    async read(rel) {
      const { handle } = await walkTo(rel);
      return (await handle.getFile()).text();
    },
    async readBase64(rel) {
      const { handle } = await walkTo(rel);
      return bytesToB64(new Uint8Array(await (await handle.getFile()).arrayBuffer()));
    },
    write: (rel, text) => writeBytes(rel, text),
    writeBase64: (rel, b64) => writeBytes(rel, b64ToBytes(b64)),
    async mkdir(rel) {
      let dir = rootDir;
      for (const seg of cleanRel(rel).split("/").filter(Boolean)) dir = await dir.getDirectoryHandle(seg, { create: true });
    },
    async remove(rel) {
      const { dir, name: n } = await walkTo(rel);
      await dir.removeEntry(n, { recursive: true });
    },
    async move(a, b) {
      const data = await api.readBase64(a);
      await api.writeBase64(b, data);
      await api.remove(a);
    },
    async stat(rel) {
      try {
        const { handle } = await walkTo(rel);
        if (handle.kind === "directory") return { type: "dir", size: 0 };
        const f = await handle.getFile();
        return { type: "file", size: f.size, mtime: f.lastModified };
      } catch {
        return null;
      }
    },
  };
  return api;
}

const cache = new Map();
/** `spec` is an absolute folder on desktop, a project name elsewhere. */
export async function openWorkspace(spec) {
  if (!spec) return null;
  if (cache.has(spec)) return cache.get(spec);
  const ws = isDesktop ? desktopWorkspace(spec) : isAndroid ? await androidWorkspace(spec) : await opfsWorkspace(spec);
  cache.set(spec, ws);
  return ws;
}

/** Depth-first walk returning relative file paths (skips heavy folders). */
const SKIP = new Set([".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", "target", ".gradle", ".idea"]);
export async function walk(ws, rel = "", max = 4000) {
  const out = [];
  const stack = [cleanRel(rel)];
  while (stack.length && out.length < max) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = await ws.list(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = dir ? `${dir}/${e.name}` : e.name;
      if (e.type === "dir") {
        if (!SKIP.has(e.name)) stack.push(p);
      } else out.push({ path: p, size: e.size });
      if (out.length >= max) break;
    }
  }
  return out;
}

export function globToRegExp(glob) {
  let re = "";
  const g = cleanRel(glob.replace(/^\.\//, "")) || "**";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        re += g[i + 2] === "/" ? "(?:.*/)?" : ".*";
        i += g[i + 2] === "/" ? 2 : 1;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = g.indexOf("}", i);
      if (end > i) {
        re += "(?:" + g.slice(i + 1, end).split(",").map((s) => s.replace(/[.+^$()|[\]\\]/g, "\\$&")).join("|") + ")";
        i = end;
      } else re += "\\{";
    } else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$", "i");
}

// Local (stdio) MCP servers: newline-delimited JSON-RPC over a child process.
const { ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const { killTree } = require("./shell.cjs");

const servers = new Map();

function startServer(key, { command, args = [], env = {}, cwd }) {
  const win = process.platform === "win32";
  const needsShell = win && !/\.exe$/i.test(command);
  const quote = (a) => (/^[\w\-.:=/\\@]+$/.test(a) ? a : `"${String(a).replace(/"/g, '""')}"`);
  const child = needsShell
    ? spawn(command, args.map(quote), { cwd: cwd || undefined, env: { ...process.env, ...env }, shell: true, windowsHide: true })
    : spawn(command, args, { cwd: cwd || undefined, env: { ...process.env, ...env }, windowsHide: true });
  const s = { child, buf: "", nextId: 1, pending: new Map(), stderr: "" };
  child.stdout.on("data", (d) => {
    s.buf += d;
    let i;
    while ((i = s.buf.indexOf("\n")) >= 0) {
      const line = s.buf.slice(0, i).trim();
      s.buf = s.buf.slice(i + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        const p = msg.id !== undefined ? s.pending.get(msg.id) : null;
        if (p) {
          s.pending.delete(msg.id);
          msg.error ? p.reject(new Error(msg.error.message || "errore MCP")) : p.resolve(msg.result);
        }
      } catch {
        /* log line */
      }
    }
  });
  child.stderr.on("data", (d) => (s.stderr = (s.stderr + d).slice(-4000)));
  const fail = (why) => {
    for (const p of s.pending.values()) p.reject(new Error(why));
    s.pending.clear();
    servers.delete(key);
  };
  child.on("error", (e) => fail(e.message));
  child.on("close", (code) => fail(s.stderr.trim().slice(-400) || `il server MCP è terminato (${code})`));
  servers.set(key, s);
  return s;
}

function register() {
  ipcMain.handle("mcp:start", (_e, key, cfg) => {
    if (!servers.has(key)) startServer(key, cfg);
    return true;
  });
  ipcMain.handle("mcp:request", (_e, key, { method, params, notify }) => {
    const s = servers.get(key);
    if (!s) throw new Error("server MCP non avviato");
    if (notify) {
      s.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}) }) + "\n");
      return null;
    }
    const id = s.nextId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        s.pending.delete(id);
        reject(new Error("il server MCP non ha risposto in tempo"));
      }, 180000);
      s.pending.set(id, { resolve: (v) => (clearTimeout(t), resolve(v)), reject: (e) => (clearTimeout(t), reject(e)) });
      s.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }) + "\n");
    });
  });
  ipcMain.handle("mcp:stop", (_e, key) => {
    const s = servers.get(key);
    if (s) killTree(s.child);
    servers.delete(key);
    return true;
  });
}

function shutdown() {
  for (const s of servers.values()) killTree(s.child);
  servers.clear();
}

module.exports = { register, shutdown };

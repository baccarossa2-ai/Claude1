// The Claude Code bridge: the user's own `claude` CLI in headless stream-json
// mode. One long-lived process per conversation; user turns go in on stdin,
// every JSON line Claude Code prints goes out to the renderer, and permission
// prompts (control_request can_use_tool) are answered by the renderer's
// approval dialog. The model list comes from the CLI's own `initialize`
// control response — always current, and free (no prompt is sent).
const { app, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { checkRoot } = require("./fs.cjs");
const { killTree } = require("./shell.cjs");

const procs = new Map(); // key -> { child, config, sessionId, buf, ready, pending }
let modelsCache = { at: 0, path: null, models: null, account: null };

function candidates(custom) {
  const home = os.homedir();
  const list = [];
  if (custom) list.push(custom);
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) for (const ext of exts) if (dir) list.push(path.join(dir, "claude" + ext));
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    list.push(path.join(home, ".local", "bin", "claude.exe"), path.join(appdata, "npm", "claude.cmd"), path.join(local, "Programs", "claude", "claude.exe"), path.join(local, "AnthropicClaude", "claude.exe"));
  } else {
    list.push(path.join(home, ".local", "bin", "claude"), path.join(home, ".claude", "local", "claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude", path.join(home, ".npm-global", "bin", "claude"));
  }
  return list;
}

function findClaude(custom) {
  for (const p of candidates(custom)) {
    try {
      if (p && fs.statSync(p).isFile()) return p;
    } catch {
      /* next */
    }
  }
  return null;
}

// Variables that would make the child believe it runs inside another Claude
// Code session (e.g. Cloudy launched from a Claude Code terminal).
const SESSION_VARS = ["CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SSE_PORT", "CLAUDE_CODE_ENTRYPOINT"];
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of SESSION_VARS) delete env[k];
  return { ...env, ...extra };
}

/** .cmd/.bat shims need a shell on Windows; quote every argument for it. */
function spawnClaude(bin, args, opts = {}) {
  const shim = process.platform === "win32" && /\.(cmd|bat)$/i.test(bin);
  const quote = (a) => (/^[\w\-.:=/\\]+$/.test(a) ? a : `"${String(a).replace(/"/g, '""')}"`);
  return shim
    ? spawn(`"${bin}"`, args.map(quote), { ...opts, shell: true, windowsHide: true })
    : spawn(bin, args, { ...opts, windowsHide: true });
}

function run(bin, args, timeout = 20000) {
  return new Promise((resolve) => {
    const child = spawnClaude(bin, args, { env: cleanEnv() });
    let out = "";
    let err = "";
    const t = setTimeout(() => killTree(child), timeout);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => (clearTimeout(t), resolve({ code: 127, out, err: e.message })));
    child.on("close", (code) => (clearTimeout(t), resolve({ code, out, err })));
  });
}

async function detect(custom) {
  const bin = findClaude(custom);
  if (!bin) return { installed: false };
  const v = await run(bin, ["--version"]);
  const version = (v.out.match(/\d+\.\d+\.\d+/) || [])[0] || null;
  if (!version) return { installed: false, path: bin, error: (v.err || v.out).slice(0, 300) };
  const st = await run(bin, ["auth", "status"]);
  let loggedIn = null;
  let subscription = null;
  try {
    const j = JSON.parse(st.out.slice(st.out.indexOf("{")));
    loggedIn = !!j.loggedIn;
    subscription = j.subscriptionType || j.authMethod || null;
  } catch {
    loggedIn = /logged in|authenticated/i.test(st.out) ? true : /not logged|login/i.test(st.out + st.err) ? false : null;
  }
  return { installed: true, path: bin, version, loggedIn, subscription };
}

const BASE_ARGS = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--permission-prompt-tool", "stdio"];

/** Ask Claude Code itself which models exist right now (control request `initialize`). */
async function models(custom) {
  const bin = findClaude(custom);
  if (!bin) return [];
  if (modelsCache.models && modelsCache.path === bin && Date.now() - modelsCache.at < 10 * 60 * 1000) return modelsCache.models;
  const result = await new Promise((resolve, reject) => {
    const child = spawnClaude(bin, BASE_ARGS, { cwd: os.homedir(), env: cleanEnv() });
    let buf = "";
    let err = "";
    const t = setTimeout(() => (killTree(child), reject(new Error("Claude Code non ha risposto in tempo"))), 45000);
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          const j = JSON.parse(line);
          if (j.type === "control_response") {
            clearTimeout(t);
            const r = j.response?.response ?? j.response ?? {};
            killTree(child);
            resolve({ models: r.models || [], account: r.account || null });
          }
        } catch {
          /* not JSON */
        }
      }
    });
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => (clearTimeout(t), reject(e)));
    child.on("close", (code) => {
      clearTimeout(t);
      reject(new Error(err.trim().slice(0, 400) || `claude è terminato (${code})`));
    });
    child.stdin.write(JSON.stringify({ type: "control_request", request_id: "init_models", request: { subtype: "initialize" } }) + "\n");
  });
  modelsCache = { at: Date.now(), path: bin, models: result.models, account: result.account };
  return result.models;
}

function sameConfig(a, b) {
  return a.cwd === b.cwd && a.model === b.model && a.permissionMode === b.permissionMode && a.chatOnly === b.chatOnly && a.effort === b.effort && a.bin === b.bin;
}

function stop(key) {
  const p = procs.get(key);
  if (!p) return;
  procs.delete(key);
  try {
    p.child.stdin.end();
  } catch {
    /* closed */
  }
  setTimeout(() => killTree(p.child), 1500);
}

function start(key, config, resume, systemFile, sender) {
  const args = [...BASE_ARGS, "--include-partial-messages", "--model", config.model, "--permission-mode", config.permissionMode];
  if (config.effort) args.push("--effort", config.effort === "max" ? "max" : config.effort);
  if (resume) args.push("--resume", resume);
  if (systemFile) args.push("--append-system-prompt-file", systemFile);
  if (config.chatOnly) args.push("--tools", "");
  const child = spawnClaude(config.bin, args, { cwd: config.cwd, env: cleanEnv() });
  const p = { child, config, sessionId: resume || null, buf: "", stderr: "", sender };
  procs.set(key, p);
  child.stdout.on("data", (d) => {
    p.buf += d;
    let i;
    while ((i = p.buf.indexOf("\n")) >= 0) {
      const line = p.buf.slice(0, i).trim();
      p.buf = p.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.session_id) p.sessionId = msg.session_id;
      if (msg.type === "control_response" && msg.response?.request_id === "init_" + key) continue;
      if (!p.sender.isDestroyed()) p.sender.send("claudecode:event", { key, msg });
    }
  });
  child.stderr.on("data", (d) => (p.stderr = (p.stderr + d).slice(-4000)));
  child.on("error", (e) => {
    if (procs.get(key) === p) procs.delete(key);
    if (!p.sender.isDestroyed()) p.sender.send("claudecode:exit", { key, code: 127, stderr: e.message });
  });
  child.on("close", (code) => {
    if (procs.get(key) === p) procs.delete(key);
    if (!p.sender.isDestroyed()) p.sender.send("claudecode:exit", { key, code, stderr: p.stderr });
  });
  child.stdin.write(JSON.stringify({ type: "control_request", request_id: "init_" + key, request: { subtype: "initialize" } }) + "\n");
  return p;
}

function write(p, obj) {
  p.child.stdin.write(JSON.stringify(obj) + "\n");
}

function register() {
  ipcMain.handle("claudecode:detect", (_e, custom) => detect(custom));
  ipcMain.handle("claudecode:models", (_e, custom) => models(custom));
  ipcMain.handle("claudecode:login", (_e, custom) => {
    const bin = findClaude(custom);
    if (!bin) throw new Error("Claude Code non trovato");
    const child = spawnClaude(bin, ["auth", "login"], { env: cleanEnv(), detached: true, stdio: "ignore" });
    child.unref?.();
    return true;
  });

  ipcMain.handle("claudecode:turn", (e, key, opts) => {
    const bin = findClaude(opts.customPath);
    if (!bin) throw Object.assign(new Error("Claude Code non è installato su questo computer."), { kind: "auth" });
    let cwd = os.homedir();
    if (opts.cwd) cwd = checkRoot(opts.cwd);
    else {
      cwd = path.join(app.getPath("userData"), "claude-chat");
      fs.mkdirSync(cwd, { recursive: true });
    }
    const config = { bin, cwd, model: opts.model, permissionMode: opts.permissionMode || "default", chatOnly: !!opts.chatOnly, effort: opts.effort || null };
    let p = procs.get(key);
    const resume = p?.sessionId || opts.resume || null;
    if (p && !sameConfig(p.config, config)) {
      stop(key);
      p = null;
    }
    if (!p) {
      let systemFile = null;
      if (opts.systemAppend) {
        systemFile = path.join(app.getPath("temp"), `cloudy-system-${key}.md`);
        fs.writeFileSync(systemFile, opts.systemAppend);
      }
      p = start(key, config, resume, systemFile, e.sender);
    }
    p.sender = e.sender;
    write(p, { type: "user", message: { role: "user", content: opts.content }, parent_tool_use_id: null, session_id: p.sessionId || "default" });
    return true;
  });

  ipcMain.handle("claudecode:respond", (_e, key, requestId, response) => {
    const p = procs.get(key);
    if (p) write(p, { type: "control_response", response: { subtype: "success", request_id: requestId, response } });
    return true;
  });

  ipcMain.handle("claudecode:interrupt", (_e, key) => {
    const p = procs.get(key);
    if (p) write(p, { type: "control_request", request_id: "int_" + Date.now(), request: { subtype: "interrupt" } });
    return true;
  });

  ipcMain.handle("claudecode:stop", (_e, key) => (stop(key), true));
}

function shutdown() {
  for (const key of [...procs.keys()]) stop(key);
}

module.exports = { register, shutdown, findClaude, detect, models };

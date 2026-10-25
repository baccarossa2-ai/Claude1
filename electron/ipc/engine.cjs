// The ORIGINAL Cloudy agent host. cloudy-cli's own src/agent.js spawns its
// own `cloudy serve --stdio` (dist/serve.cjs) and speaks cloudy.rpc/1 to it —
// exactly what the TUI does. We only change how the child is started: with
// this Electron binary in Node mode, and a private config folder holding the
// device token, so the user's ~/.config/cloudy is never touched.
const { app, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { checkRoot } = require("./fs.cjs");

let ROOT = path.join(__dirname, "..", "..");
let client = null;
let clientBase = null;
let openRoot = null;

function originalDir() {
  // Packaged: original/ ships unpacked next to app.asar so a Node child can run it.
  const unpacked = path.join(process.resourcesPath || "", "app.asar.unpacked", "original", "cloudy-cli");
  return app.isPackaged && fs.existsSync(unpacked) ? unpacked : path.join(ROOT, "original", "cloudy-cli");
}

const configHome = () => path.join(app.getPath("userData"), "engine-config");

function childEnv(base) {
  return { ...process.env, ELECTRON_RUN_AS_NODE: "1", XDG_CONFIG_HOME: configHome(), CLOUDY_API_URL: base, CLOUDY_NO_UPDATE: "1" };
}

function writeConfig(token, base) {
  // The same file `cloudy login` writes (src/client.js saveConfig), mode 0600.
  const dir = path.join(configHome(), "cloudy");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "config.json");
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* first run */
  }
  fs.writeFileSync(file, JSON.stringify({ ...cfg, token: token || null, base, modelChosen: true }, null, 2) + "\n", { mode: 0o600 });
}

async function ensure({ token, base, root }) {
  writeConfig(token, base);
  if (!client || client.closing || clientBase !== base) {
    client?.close();
    const { createAgentClient } = await import(pathToFileURL(path.join(originalDir(), "src", "agent.js")).href);
    client = createAgentClient({ base }, { spawnChild: (_cmd, args, opts) => spawn(process.execPath, args, { ...opts, env: { ...opts.env, ...childEnv(base) }, windowsHide: true }) });
    clientBase = base;
    openRoot = null;
  }
  if (root && root !== openRoot) {
    const real = checkRoot(root);
    await client.openWorkspace(real);
    openRoot = root;
  }
  return true;
}

function register(ctx) {
  ROOT = ctx.root;
  ipcMain.handle("engine:ensure", (_e, opts) => ensure(opts));
  ipcMain.handle("engine:respond", (e, params) => {
    if (!client) throw new Error("motore non avviato");
    client
      .respond(params, (event) => {
        if (!e.sender.isDestroyed()) e.sender.send("engine:event", { sendId: params.sendId, event });
      })
      .catch((err) => {
        if (!e.sender.isDestroyed()) e.sender.send("engine:event", { sendId: params.sendId, event: { type: "error", error: err.message } });
      });
    return true;
  });
  ipcMain.handle("engine:approve", (_e, approvalId, ok) => client?.approve(approvalId, !!ok));
  ipcMain.handle("engine:abort", (_e, sendId) => client?.abort(sendId));

  // `cloudy import --json [--apply] --path <root>`: skills and plugin servers
  // from Claude Code, Cursor and VS Code, through the original command.
  ipcMain.handle("engine:import", async (_e, { root, apply }) => {
    const dir = root ? checkRoot(root) : app.getPath("home");
    const bin = path.join(originalDir(), "bin", "cloudy.mjs");
    const args = [bin, "import", "--json", "--path", dir, ...(apply ? ["--apply"] : [])];
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { env: childEnv("https://cloudy.chat"), windowsHide: true });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", reject);
      child.on("close", (code) => {
        try {
          resolve(JSON.parse(out));
        } catch {
          reject(new Error((err || out).trim().slice(0, 500) || `import terminato con codice ${code}`));
        }
      });
    });
  });
}

function shutdown() {
  client?.close();
  client = null;
}

module.exports = { register, shutdown };

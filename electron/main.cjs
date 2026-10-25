// Cloudy Desktop — Electron main process.
//
// The window loads the renderer from app://cloudy/ (a privileged custom
// scheme, so fetch, ES modules and WebAssembly behave exactly as on the web).
// Everything that needs the machine — HTTP without CORS, the workspace on
// disk, shell commands, Claude Code, the original Cloudy agent host, local MCP
// servers, the OS keychain — lives in electron/ipc/*.cjs behind the preload's
// fixed channel list.
const { app, BrowserWindow, Menu, nativeTheme, protocol, shell, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const WWW = path.join(ROOT, "www");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".wasm": "application/wasm", ".woff2": "font/woff2", ".woff": "font/woff", ".bin": "application/octet-stream", ".txt": "text/plain" };

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.setAppUserModelId("chat.cloudy.desktop");

// Hardware acceleration can be switched off in Settings → Aspetto (or with
// --disable-gpu); the choice lives in userData/gpu-off and --enable-gpu undoes
// it. Chromium already falls back to software rendering by itself when the
// GPU process keeps crashing; we only tell the user where the switch is.
let win = null;
const gpuOffFlag = () => path.join(app.getPath("userData"), "gpu-off");
if (process.argv.includes("--enable-gpu")) fs.rmSync(gpuOffFlag(), { force: true });
if (process.argv.includes("--disable-gpu") || fs.existsSync(gpuOffFlag())) app.disableHardwareAcceleration();
let gpuCrashes = 0;
app.on("child-process-gone", (_e, details) => {
  if (details.type !== "GPU" || details.reason === "clean-exit") return;
  if (++gpuCrashes === 2 && win && !win.isDestroyed()) win.webContents.send("app:gpu", { crashed: details.reason });
});

const statePath = () => path.join(app.getPath("userData"), "window.json");

function loadBounds() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return { width: 1320, height: 860 };
  }
}

function createWindow() {
  const bounds = loadBounds();
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";
  win = new BrowserWindow({
    ...bounds,
    minWidth: 380,
    minHeight: 520,
    show: false,
    backgroundColor: "#07080f",
    title: "Cloudy",
    icon: path.join(ROOT, "build", isWin ? "icon.ico" : "icon.png"),
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    ...(isWin ? { titleBarOverlay: { color: "#0b0d16", symbolColor: "#c9cfe1", height: 46 } } : {}),
    ...(!isWin && !isMac ? { frame: false } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false,
    },
  });
  if (bounds.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  const save = () => {
    if (!win || win.isDestroyed()) return;
    try {
      fs.writeFileSync(statePath(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
    } catch {
      /* best effort */
    }
  };
  win.on("close", save);

  // Links leave the app for the system browser; the app itself never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("app://cloudy/")) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  // The Browser app's <webview>: no preload, no Node, ever.
  win.webContents.on("will-attach-webview", (_e, prefs) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
  });
  win.webContents.on("before-input-event", (_e, input) => {
    if (input.type === "keyDown" && input.control && input.shift && input.key.toLowerCase() === "i") win.webContents.toggleDevTools();
  });
  win.loadURL("app://cloudy/index.html");
  return win;
}

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  protocol.handle("app", async (req) => {
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/" || !rel) rel = "/index.html";
    const file = path.normalize(path.join(WWW, rel));
    if (!file.startsWith(WWW)) return new Response("forbidden", { status: 403 });
    try {
      const data = await fs.promises.readFile(file);
      return new Response(data, { headers: { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });

  // Microphone / camera / geolocation are never requested by the app itself.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(["notifications", "clipboard-read", "clipboard-sanitized-write", "fullscreen"].includes(permission)));

  Menu.setApplicationMenu(
    process.platform === "darwin"
      ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }])
      : null
  );

  const ctx = { getWindow: () => win, root: ROOT };
  for (const mod of ["http", "fs", "shell", "secrets", "app", "claudecode", "engine", "mcp"]) require(`./ipc/${mod}.cjs`).register(ctx);

  createWindow();
  nativeTheme.themeSource = "dark";
});

app.on("window-all-closed", () => {
  for (const mod of ["claudecode", "engine", "mcp"]) {
    try {
      require(`./ipc/${mod}.cjs`).shutdown?.();
    } catch {
      /* ignore */
    }
  }
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

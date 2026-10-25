// Small window / OS services: links, notifications, save dialog, window
// controls and the Windows title-bar overlay colours.
const { app, BrowserWindow, Notification, dialog, ipcMain, nativeTheme, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

function register({ getWindow }) {
  ipcMain.handle("app:openExternal", (_e, url) => {
    if (!/^(https?|mailto):/i.test(String(url))) throw new Error("Solo link http(s) o mailto");
    return shell.openExternal(url);
  });
  ipcMain.handle("app:notify", (_e, { title, body }) => {
    if (Notification.isSupported()) new Notification({ title: String(title || "Cloudy"), body: String(body || "") }).show();
    return true;
  });
  ipcMain.handle("app:info", () => ({ version: app.getVersion(), userData: app.getPath("userData"), platform: process.platform, arch: process.arch }));
  // Hardware acceleration (userData/gpu-off, read in main.cjs): report the
  // state, or switch it and restart, since Chromium decides it at startup.
  ipcMain.handle("app:gpu", (_e, enable) => {
    const flag = path.join(app.getPath("userData"), "gpu-off");
    const forced = process.argv.includes("--disable-gpu");
    const off = forced || fs.existsSync(flag);
    if (typeof enable !== "boolean") return { enabled: !off, forced };
    if (enable === !off) return { enabled: enable, forced };
    if (enable) fs.rmSync(flag, { force: true });
    else fs.writeFileSync(flag, "manual\n");
    // Restart without the GPU switches, or --enable-gpu would undo the choice.
    const args = process.argv.slice(1).filter((a) => a !== "--enable-gpu" && a !== "--disable-gpu");
    setTimeout(() => (app.relaunch({ args }), app.exit(0)), 300);
    return { enabled: enable, restarting: true };
  });
  ipcMain.handle("dialog:saveFile", async (_e, { name, base64 }) => {
    const res = await dialog.showSaveDialog(getWindow(), { defaultPath: name });
    if (res.canceled || !res.filePath) return null;
    await fs.promises.writeFile(res.filePath, Buffer.from(base64, "base64"));
    return res.filePath;
  });
  ipcMain.handle("win:minimize", (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
  ipcMain.handle("win:toggleMaximize", (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) w.isMaximized() ? w.unmaximize() : w.maximize();
  });
  ipcMain.handle("win:close", (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  ipcMain.handle("win:theme", (e, theme) => {
    nativeTheme.themeSource = theme === "light" ? "light" : "dark";
    const w = BrowserWindow.fromWebContents(e.sender);
    if (process.platform === "win32" && w?.setTitleBarOverlay) {
      w.setTitleBarOverlay(theme === "light" ? { color: "#eef1f8", symbolColor: "#1f2937" } : { color: "#0b0d16", symbolColor: "#c9cfe1" });
    }
    w?.setBackgroundColor(theme === "light" ? "#eef1f8" : "#07080f");
    return true;
  });
}

module.exports = { register };

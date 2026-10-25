// The renderer's only door to the main process: a fixed list of channels.
const { contextBridge, ipcRenderer } = require("electron");

const INVOKE = new Set([
  "http:start", "http:abort",
  "fs:list", "fs:read", "fs:write", "fs:mkdir", "fs:remove", "fs:move", "fs:stat", "fs:reveal",
  "shell:exec", "shell:kill",
  "claudecode:detect", "claudecode:models", "claudecode:login", "claudecode:turn", "claudecode:respond", "claudecode:interrupt", "claudecode:stop",
  "engine:ensure", "engine:respond", "engine:approve", "engine:abort", "engine:import",
  "mcp:start", "mcp:request", "mcp:stop",
  "secrets:get", "secrets:set",
  "app:openExternal", "app:notify", "app:info", "app:gpu",
  "dialog:pickFolder", "dialog:saveFile",
  "win:minimize", "win:toggleMaximize", "win:close", "win:theme",
]);
const EVENTS = new Set(["http:event", "shell:output", "claudecode:event", "claudecode:exit", "engine:event", "app:menu", "app:gpu"]);

contextBridge.exposeInMainWorld("cloudyNative", {
  platform: process.platform,
  invoke(channel, ...args) {
    if (!INVOKE.has(channel)) return Promise.reject(new Error(`canale non consentito: ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, cb) {
    if (!EVENTS.has(channel)) return () => {};
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});

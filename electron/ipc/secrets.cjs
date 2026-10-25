// API keys and the Cloudy device token, encrypted with the OS keychain
// (DPAPI on Windows, Keychain on macOS, libsecret on Linux) via safeStorage.
const { app, ipcMain, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const file = () => path.join(app.getPath("userData"), "secrets.json");
let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch {
    cache = {};
  }
  return cache;
}

function persist() {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(cache, null, 2), { mode: 0o600 });
}

const canEncrypt = () => {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
};

function get(key) {
  const v = load()[key];
  if (!v) return null;
  try {
    if (v.startsWith("enc:")) return safeStorage.decryptString(Buffer.from(v.slice(4), "base64"));
    if (v.startsWith("b64:")) return Buffer.from(v.slice(4), "base64").toString("utf8");
  } catch {
    return null;
  }
  return null;
}

function set(key, value) {
  load();
  if (value == null || value === "") delete cache[key];
  else cache[key] = canEncrypt() ? "enc:" + safeStorage.encryptString(String(value)).toString("base64") : "b64:" + Buffer.from(String(value)).toString("base64");
  persist();
  return true;
}

function register() {
  ipcMain.handle("secrets:get", (_e, key) => get(key));
  ipcMain.handle("secrets:set", (_e, key, value) => set(key, value));
}

module.exports = { register, get, set };

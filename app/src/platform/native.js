// One surface over the three hosts the renderer runs in:
//   desktop — Electron; the preload exposes `window.cloudyNative` (IPC)
//   android — Capacitor WebView; native plugins via @capacitor/core
//   web     — a plain browser tab (dev server); best-effort fallbacks
import { Capacitor, registerPlugin } from "@capacitor/core";

const bridge = typeof window !== "undefined" ? window.cloudyNative : undefined;

export const isDesktop = !!bridge;
export const isAndroid = !isDesktop && Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
export const isWeb = !isDesktop && !isAndroid;
export const platform = isDesktop ? "desktop" : isAndroid ? "android" : "web";
export const osName = isDesktop
  ? { win32: "windows", darwin: "mac", linux: "linux" }[bridge.platform] || bridge.platform
  : isAndroid
    ? "android"
    : "web";

/** Native Android helpers implemented in android/.../CloudyNativePlugin.java. */
export const CloudyAndroid = isAndroid ? registerPlugin("CloudyNative") : null;

export function invoke(channel, ...args) {
  if (!bridge) return Promise.reject(new Error(`"${channel}" è disponibile solo nell'app desktop`));
  return bridge.invoke(channel, ...args);
}

export function onNative(channel, cb) {
  if (!bridge) return () => {};
  return bridge.on(channel, cb);
}

export async function openExternal(url) {
  if (!url) return;
  if (isDesktop) return invoke("app:openExternal", url);
  if (isAndroid) {
    const { Browser } = await import("@capacitor/browser");
    return Browser.open({ url });
  }
  window.open(url, "_blank", "noopener");
}

export async function notify(title, body) {
  if (isDesktop) return invoke("app:notify", { title, body });
  try {
    if ("Notification" in window) {
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission === "granted") new Notification(title, { body });
    }
  } catch {
    /* notifications are a courtesy, never a failure */
  }
}

// ---------------------------------------------------------------
// Secrets — API keys and the Cloudy device token. Desktop encrypts them with
// the OS keychain (Electron safeStorage); elsewhere they live in localStorage
// under a prefix, which on Android is the app's private storage.
// ---------------------------------------------------------------

const SECRET_PREFIX = "cloudy.secret.";
export const secrets = {
  async get(key) {
    if (isDesktop) return invoke("secrets:get", key);
    try {
      return localStorage.getItem(SECRET_PREFIX + key);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    if (isDesktop) return invoke("secrets:set", key, value ?? null);
    try {
      if (value == null || value === "") localStorage.removeItem(SECRET_PREFIX + key);
      else localStorage.setItem(SECRET_PREFIX + key, value);
    } catch {
      /* private mode */
    }
  },
};

export const appInfo = {
  version: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev",
  engineVersion: typeof __ENGINE_VERSION__ !== "undefined" ? __ENGINE_VERSION__ : "1.0.0",
};

export const windowControls = {
  minimize: () => invoke("win:minimize"),
  toggleMaximize: () => invoke("win:toggleMaximize"),
  close: () => invoke("win:close"),
};

/** Ask the user for a folder (desktop) — returns an absolute path or null. */
export function pickFolder() {
  return isDesktop ? invoke("dialog:pickFolder") : Promise.resolve(null);
}

/** Save a blob/text where the user chooses (desktop dialog, download elsewhere). */
export async function saveAs(name, data, mime = "application/octet-stream") {
  if (isDesktop) {
    const b64 = typeof data === "string" ? btoa(unescape(encodeURIComponent(data))) : await blobToBase64(data);
    return invoke("dialog:saveFile", { name, base64: b64 });
  }
  if (isAndroid) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const b64 = typeof data === "string" ? btoa(unescape(encodeURIComponent(data))) : await blobToBase64(data);
    const res = await Filesystem.writeFile({ path: `Cloudy/Export/${name}`, data: b64, directory: Directory.External, recursive: true });
    return res.uri;
  }
  const blob = typeof data === "string" ? new Blob([data], { type: mime }) : data;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return name;
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Boot sequence and account actions.
import { lsGet } from "../lib/db.js";
import { isDesktop, onNative, secrets } from "../platform/native.js";
import { loginPairing, loginPassword } from "../providers/cloudy.js";
import { claudeCodeLogin } from "../providers/claudecode.js";
import { uid } from "../lib/util.js";
import { bump, getSettings, store, toast, updateSettings } from "./store.js";
import { cloudyCfg, refreshClaudeModels, refreshCloudy, refreshProviderModels, refreshUsage } from "./models.js";
import { loadIndex, newConversation, openConversation } from "./conversations.js";

export function applyTheme(settings = getSettings()) {
  const root = document.documentElement;
  const dark = settings.theme === "auto" ? window.matchMedia?.("(prefers-color-scheme: dark)").matches : settings.theme !== "light";
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.motion = settings.motion;
  root.style.setProperty("--accent", settings.accent);
  root.style.setProperty("--font-scale", String(settings.fontScale || 1));
  if (isDesktop) window.cloudyNative?.invoke("win:theme", dark ? "dark" : "light").catch(() => {});
}

export async function initApp() {
  applyTheme();
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => applyTheme());
  const token = await secrets.get("cloudy.token");
  const user = lsGet("cloudy.user", null);
  store.set((s) => ({
    cloudy: { ...s.cloudy, token, user, models: lsGet("cloudy.cache.models", []) },
    claude: { ...s.claude, table: lsGet("cloudy.claude.table", []), history: lsGet("cloudy.claude.history", []) },
  }));
  await loadIndex();
  const list = store.get().conversations;
  if (list[0] && Date.now() - list[0].updatedAt < 6 * 3600 * 1000) await openConversation(list[0].id);
  else newConversation("chat");
  store.set({ ready: true });

  // Network refreshes run after first paint — the app never waits on them.
  refreshCloudy().then(() => {
    const cur = store.get().current;
    if (cur?.draft && !cur.messages.length && !getSettings().defaultModel && store.get().cloudy.defaultModel) {
      cur.model = `cloudy:${store.get().cloudy.defaultModel}`;
      bump();
    }
  });
  refreshClaudeModels({ silent: true });
  for (const p of getSettings().providers) refreshProviderModels(p).catch(() => {});
  setInterval(() => refreshClaudeModels(), 30 * 60 * 1000);
  setInterval(() => store.get().cloudy.token && refreshUsage(), 5 * 60 * 1000);
  if (isDesktop) {
    onNative("app:menu", (action) => window.dispatchEvent(new CustomEvent("cloudy:menu", { detail: action })));
    onNative("app:gpu", () => toast("La scheda video ha dei problemi. Se vedi lo schermo nero o sfarfallii, spegni l'accelerazione hardware in Impostazioni → Aspetto.", "error", 12000));
  }
}

// ---------------- Cloudy account ----------------

async function storeLogin({ token, user }) {
  await secrets.set("cloudy.token", token);
  localStorage.setItem("cloudy.user", JSON.stringify(user || null));
  store.set((s) => ({ cloudy: { ...s.cloudy, token, user } }));
  toast(`Accesso effettuato come ${user?.email || "utente Cloudy"}`, "success");
  refreshCloudy();
}

export async function loginWithPassword(email, password) {
  await storeLogin(await loginPassword(cloudyCfg(), email, password));
}

export async function loginWithBrowser(onCode, provider, signal) {
  await storeLogin(await loginPairing(cloudyCfg(), onCode, provider, signal));
}

export async function logoutCloudy() {
  await secrets.set("cloudy.token", null);
  localStorage.removeItem("cloudy.user");
  store.set((s) => ({ cloudy: { ...s.cloudy, token: null, user: null, usage: null } }));
  toast("Disconnesso da Cloudy");
}

// ---------------- Claude ----------------

export async function setAnthropicKey(key) {
  await secrets.set("anthropic.apiKey", key?.trim() || null);
  store.set((s) => ({ claude: { ...s.claude, hasKey: !!key?.trim() } }));
  return refreshClaudeModels();
}

export async function loginClaudeCode() {
  await claudeCodeLogin(getSettings().claude.codePath);
  toast("Completa l'accesso a Claude nel browser che si è aperto, poi premi \"Aggiorna\".", "info", 8000);
}

export function setClaudeEnabled(id, on) {
  updateSettings((s) => ({ claude: { ...s.claude, enabled: { ...s.claude.enabled, [id]: on } } }));
}

// ---------------- custom providers ----------------

export async function saveProvider(p, apiKey) {
  const provider = { id: p.id || uid("p"), name: p.name, preset: p.preset, baseUrl: p.baseUrl.trim(), format: p.format || "openai", models: p.models || [], noTools: !!p.noTools };
  if (apiKey !== undefined) await secrets.set(`provider.${provider.id}`, apiKey || null);
  updateSettings((s) => ({ providers: [...s.providers.filter((x) => x.id !== provider.id), provider] }));
  return provider;
}

export async function removeProvider(id) {
  await secrets.set(`provider.${id}`, null);
  updateSettings((s) => ({ providers: s.providers.filter((x) => x.id !== id) }));
}

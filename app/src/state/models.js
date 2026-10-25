// Every model the picker can offer, grouped by provider, plus the refresh
// logic that keeps the Claude table current. Model references:
//   cloudy:<id>              Cloudy's own registry (GET /api/chat)
//   claude:<id>              a Claude model (via Claude Code or an API key)
//   custom:<provider>:<id>   a model of a custom provider
import { lsGet, lsSet } from "../lib/db.js";
import { secrets } from "../platform/native.js";
import { fetchModels, fetchUsage, fetchProviders, fetchAds } from "../providers/cloudy.js";
import { buildTable, diffTables, fromClaudeCodeModels, BUILTIN_CLAUDE } from "../providers/claude-models.js";
import { listAnthropicModels } from "../providers/anthropic.js";
import { claudeCodeAvailable, claudeCodeModels, detectClaudeCode } from "../providers/claudecode.js";
import { listOpenAIModels } from "../providers/openai.js";
import { modelAccent, modelLogo } from "../providers/logos.js";
import { getSettings, store, toast, updateSettings } from "./store.js";

export const cloudyCfg = () => ({ base: getSettings().cloudyBase, token: store.get().cloudy.token });

// ---------------- Cloudy ----------------

export async function refreshCloudy() {
  const cfg = cloudyCfg();
  try {
    const { models, default: def } = await fetchModels(cfg);
    store.set((s) => ({ cloudy: { ...s.cloudy, models, defaultModel: def, offline: false } }));
    lsSet("cloudy.cache.models", models);
  } catch {
    const cached = lsGet("cloudy.cache.models", []);
    store.set((s) => ({ cloudy: { ...s.cloudy, models: s.cloudy.models.length ? s.cloudy.models : cached, offline: true } }));
  }
  fetchProviders(cfg).then((providers) => store.set((s) => ({ cloudy: { ...s.cloudy, providers } })));
  refreshUsage();
  refreshAd();
}

export async function refreshUsage() {
  const usage = await fetchUsage(cloudyCfg()).catch(() => null);
  store.set((s) => ({ cloudy: { ...s.cloudy, usage } }));
}

let lastAdIds = [];
export async function refreshAd() {
  const data = await fetchAds(cloudyCfg(), "/desktop", lastAdIds);
  if (data?.banner) lastAdIds = [...lastAdIds, data.banner.id].slice(-5);
  store.set((s) => ({ cloudy: { ...s.cloudy, ad: data?.banner || null } }));
}

// ---------------- Claude ----------------

export async function refreshClaudeCode() {
  if (!claudeCodeAvailable) return null;
  const info = await detectClaudeCode(getSettings().claude.codePath).catch((e) => ({ installed: false, error: e.message }));
  store.set((s) => ({ claude: { ...s.claude, code: info } }));
  return info;
}

/**
 * Rebuild the table from every live source and apply the swap rules: a
 * family's new model takes the old one's place (and its "enabled" switch);
 * conversations are NOT moved — they ask when they next send.
 */
export async function refreshClaudeModels({ silent = false } = {}) {
  store.set((s) => ({ claude: { ...s.claude, refreshing: true, error: null } }));
  const settings = getSettings();
  const key = await secrets.get("anthropic.apiKey");
  let code = [];
  let api = [];
  const errors = [];
  const info = await refreshClaudeCode();
  if (info?.installed) {
    try {
      code = fromClaudeCodeModels(await claudeCodeModels(settings.claude.codePath));
    } catch (e) {
      errors.push("Claude Code: " + e.message);
    }
  }
  if (key) {
    try {
      api = await listAnthropicModels(key);
    } catch (e) {
      errors.push("API: " + e.message);
    }
  }
  const prev = lsGet("cloudy.claude.table", null) || store.get().claude.table;
  const live = code.length || api.length;
  const table = live ? buildTable({ code, api }) : prev?.length ? prev : BUILTIN_CLAUDE;
  const diff = diffTables(prev || [], table);
  const history = lsGet("cloudy.claude.history", []);
  if (live && diff.replaced.length) {
    const enabled = { ...settings.claude.enabled };
    for (const r of diff.replaced) {
      history.unshift({ family: r.family, from: r.from.id, fromLabel: r.from.name, to: r.to.id, toLabel: r.to.name, at: Date.now() });
      if (enabled[r.from.id]) enabled[r.to.id] = true;
      delete enabled[r.from.id];
      if (!silent) toast(`${r.to.name} ha sostituito ${r.from.name} nella tabella dei modelli`, "success", 7000);
    }
    updateSettings((s) => ({ claude: { ...s.claude, enabled } }));
    lsSet("cloudy.claude.history", history.slice(0, 50));
  }
  if (live) lsSet("cloudy.claude.table", table);
  store.set((s) => ({ claude: { ...s.claude, table, updatedAt: live ? Date.now() : s.claude.updatedAt, history, hasKey: !!key, refreshing: false, error: errors.join(" · ") || null, live: !!live } }));
  return diff;
}

/** The replacement for a model id that left the table, if the history knows it. */
export function replacementFor(id) {
  const { claude } = store.get();
  if (claude.table.some((m) => m.id === id)) return null;
  let cur = id;
  for (let guard = 0; guard < 20; guard++) {
    const step = claude.history.find((h) => h.from === cur);
    if (!step) break;
    cur = step.to;
  }
  const fam = /claude-([a-z]+)-/.exec(id)?.[1];
  return claude.table.find((m) => m.id === cur) || claude.table.find((m) => m.family === fam) || null;
}

/** How a Claude model will be reached right now: "code" | "api" | null. */
export function claudeRoute() {
  const { claude } = store.get();
  const via = getSettings().claude.via;
  const codeOk = !!(claude.code?.installed && claude.code?.loggedIn !== false);
  if (via === "code") return codeOk ? "code" : null;
  if (via === "api") return claude.hasKey ? "api" : null;
  return codeOk ? "code" : claude.hasKey ? "api" : null;
}

// ---------------- custom providers ----------------

export async function refreshProviderModels(provider) {
  const key = await secrets.get(`provider.${provider.id}`);
  const models = provider.format === "anthropic" ? await listAnthropicModels(key, provider.baseUrl) : await listOpenAIModels(provider.baseUrl, key);
  store.set((s) => ({ providerModels: { ...s.providerModels, [provider.id]: models } }));
  return models;
}

// ---------------- the picker ----------------

export function allModels() {
  const s = store.get();
  const settings = s.settings;
  const out = [];
  for (const m of s.cloudy.models) {
    const ref = `cloudy:${m.id}`;
    out.push({ ref, group: "Cloudy", name: m.name, detail: m.detail, vision: !!m.supportsAttachments, credits: m.creditCost, logo: modelLogo(ref, m), accent: modelAccent(ref, m), available: true, contextWindow: m.contextWindow });
  }
  const route = claudeRoute();
  for (const m of s.claude.table) {
    const ref = `claude:${m.id}`;
    out.push({
      ref,
      group: "Claude",
      name: m.name,
      detail: m.blurb || m.description || "",
      vision: true,
      logo: modelLogo(ref, m),
      accent: modelAccent(ref, m),
      enabled: !!settings.claude.enabled[m.id],
      available: !!route,
      via: route,
      reason: route ? null : "Collega Claude Code o una chiave API nelle Impostazioni",
      claude: m,
    });
  }
  for (const p of settings.providers) {
    for (const m of p.models || []) {
      if (!m.enabled) continue;
      const ref = `custom:${p.id}:${m.id}`;
      out.push({ ref, group: p.name, name: m.name || m.id, detail: p.baseUrl.replace(/^https?:\/\//, ""), vision: true, logo: modelLogo(ref, { id: m.id, providerName: p.name }), accent: modelAccent(ref, {}), available: true, provider: p });
    }
  }
  return out;
}

export function modelInfo(ref) {
  const m = allModels().find((x) => x.ref === ref);
  if (m) return m;
  const [kind, ...rest] = String(ref || "").split(":");
  const id = rest.pop() || ref;
  return { ref, group: kind === "claude" ? "Claude" : kind === "custom" ? "Personalizzato" : "Cloudy", name: id, detail: "", logo: modelLogo(ref, { id }), accent: modelAccent(ref, {}), available: kind !== "claude", missing: true };
}

export function defaultModelRef() {
  const s = store.get();
  if (s.settings.defaultModel && allModels().some((m) => m.ref === s.settings.defaultModel)) return s.settings.defaultModel;
  const def = s.cloudy.defaultModel || s.cloudy.models[0]?.id;
  return def ? `cloudy:${def}` : s.settings.defaultModel || "cloudy:glm-5.3-flash";
}

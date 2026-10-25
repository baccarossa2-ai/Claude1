/**
 * Cloudy API client — the same surface the desktop app uses.
 *
 * Zero dependencies. Auth is a device token (`cdy_…`) either from
 * email+password (POST /api/desktop/auth) or the browser pairing flow
 * (GET /api/desktop/oauth → open {url} → user approves → POST
 * /api/desktop/oauth/poll until { status:"complete", token }). Every
 * request sends `Authorization: Bearer <token>`. Chat streams the SSE
 * protocol /api/chat serves the web app (reasoning + content deltas).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_BASE as BUILT_BASE } from "./base-url.js";

/**
 * Where this CLI talks by default. The compiled value is baked from the one
 * deployment config (scripts/build-clients.mjs); CLOUDY_API_URL and the stored
 * config still override it, which is how a dev points it at localhost.
 */
const DEFAULT_BASE = process.env.CLOUDY_API_URL || BUILT_BASE;

// ---------------------------------------------------------------
// Config — ~/.config/cloudy/config.json (mode 0600, like a token file)
// ---------------------------------------------------------------

/** The CLI's config directory — also where the stdio host keeps settings.json. */
export function cliConfigDir() {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdg, "cloudy");
}

function configPath() {
  return path.join(cliConfigDir(), "config.json");
}

export function loadConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    return {
      token: typeof cfg.token === "string" ? cfg.token : null,
      base: typeof cfg.base === "string" ? cfg.base : DEFAULT_BASE,
      model: typeof cfg.model === "string" ? cfg.model : null,
      user: cfg.user && typeof cfg.user === "object" ? cfg.user : null,
      // Two facts about this install rather than about the account:
      //   modelChosen — the user has picked a model at least once, so the
      //     picker opens on a first run and never unasked afterwards;
      //   updateCheck — when the updater last asked the registry, so a launch
      //     is not a request a day.
      modelChosen: cfg.modelChosen === true,
      updateCheck: Number.isFinite(Number(cfg.updateCheck)) ? Number(cfg.updateCheck) : 0,
    };
  } catch {
    return {
      token: null,
      base: DEFAULT_BASE,
      model: null,
      user: null,
      modelChosen: false,
      updateCheck: 0,
    };
  }
}

export function saveConfig(patch) {
  const cfg = { ...loadConfig(), ...patch };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  return cfg;
}

/**
 * TokenStore for the shared app-server host (see serve.js): the CLI's own
 * credential file. A host that spawns the server inherits whatever `cloudy
 * login` stored instead of asking for a second sign-in.
 */
export function fileTokenStore() {
  return {
    get: async () => loadConfig().token,
    set: async (token) => {
      saveConfig({ token: token ?? null });
    },
  };
}

// ---------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------

async function apiFetch(cfg, pathname, options = {}) {
  const res = await fetch(cfg.base + pathname, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
      ...options.headers,
    },
  });
  return res;
}

async function apiJson(cfg, pathname, options = {}) {
  const res = await apiFetch(cfg, pathname, options);
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

// ---------------------------------------------------------------
// Auth — password login or the browser pairing flow
// ---------------------------------------------------------------

/** Email + password → device token. Returns the stored user or throws. */
export async function loginPassword(cfg, email, password) {
  const { ok, status, body } = await apiJson(cfg, "/api/desktop/auth", {
    method: "POST",
    body: JSON.stringify({ email, password, deviceName: "cloudy CLI" }),
  });
  if (!ok) throw new Error(body.error || `login failed (${status})`);
  const user = { email: body.user?.email ?? email };
  return { token: body.token, user };
}

/** Human-friendly code, e.g. ABQ4-K7X2. */
export function formatCode(raw) {
  const c = String(raw).replace(/[^A-Z0-9]/gi, "").toUpperCase();
  return c.length > 4 ? c.slice(0, 4) + "-" + c.slice(4) : c;
}

/**
 * Point an approval URL at one provider.
 *
 * The device never talks to a provider itself: the browser session signs in,
 * and `/link?provider=…` hands that visitor straight to the provider's page
 * instead of a code form they would be refused for. An unusable URL or an
 * absent provider returns the URL untouched — a malformed URL is worse than
 * the generic approval page.
 */
export function withProvider(url, provider) {
  if (!provider) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("provider", provider);
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Which social sign-ins this server can complete.
 *
 * Auth.js serves the list at /api/auth/providers, and a provider with no
 * credentials is absent rather than half-configured — so no client keeps its
 * own copy of "what we support" (a copy is how a surface offers a button that
 * dead-ends at the identity provider).
 */
export async function fetchProviders(cfg) {
  let res;
  try {
    res = await apiJson(cfg, "/api/auth/providers");
  } catch {
    // Unreachable server: no providers to offer, and the sign-in screen must
    // still open — browser pairing and email do not need this list.
    return [];
  }
  if (!res.ok || !res.body || typeof res.body !== "object") return [];
  return Object.keys(res.body).filter((id) => id !== "credentials");
}

/** The order the known providers are listed in — the same order the web pages
 *  and the phone use. Presentation only: an unknown (newly configured) id is
 *  still offered, after the known ones, so nothing needs redeploying. */
const PROVIDER_RANK = ["apple", "google", "microsoft-entra-id", "github"];

const PROVIDER_NAMES = {
  apple: "Apple",
  google: "Google",
  github: "GitHub",
  "microsoft-entra-id": "Microsoft",
};

/** A human name for any provider id, known or not. */
export function providerName(id) {
  if (PROVIDER_NAMES[id]) return PROVIDER_NAMES[id];
  const words = String(id)
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.join(" ") || String(id);
}

/** De-duplicate and order provider ids for display. */
export function orderedProviders(ids) {
  const rank = (id) => {
    const i = PROVIDER_RANK.indexOf(id);
    return i === -1 ? PROVIDER_RANK.length : i;
  };
  return [...new Set(ids || [])]
    .filter((id) => id && id !== "credentials")
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * Browser pairing: create a code, open the URL, poll until approved.
 * onCode(url, code) lets the caller print (and optionally open) the link.
 * `provider` (an Auth.js id) makes that link sign in with that provider first.
 */
export async function loginPairing(cfg, onCode, provider = null) {
  const { ok, status, body } = await apiJson(
    cfg,
    `/api/desktop/oauth?deviceName=${encodeURIComponent("cloudy CLI")}`
  );
  if (!ok) throw new Error(body.error || `could not start pairing (${status})`);
  onCode(withProvider(body.url, provider), formatCode(body.code));

  const deadline = Date.now() + Math.max(30, body.expiresIn || 600) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const poll = await apiJson(cfg, "/api/desktop/oauth/poll", {
      method: "POST",
      body: JSON.stringify({ code: body.code }),
    });
    if (poll.ok && poll.body.status === "complete") {
      return { token: poll.body.token, user: poll.body.user };
    }
    if (poll.ok && poll.body.status === "expired") {
      throw new Error("that code expired — run /login to get a new one");
    }
  }
  throw new Error("timed out waiting for approval — run /login to try again");
}

export async function fetchModels(cfg) {
  const { ok, status, body } = await apiJson(cfg, "/api/chat");
  if (!ok) throw new Error(`could not load models (${status})`);
  return body.models || [];
}

export async function fetchUsage(cfg) {
  const { ok, body } = await apiJson(cfg, "/api/usage");
  return ok ? body : null;
}

// ---------------------------------------------------------------
// Ads — same inventory the web app serves (GET /api/ads; impressions are
// recorded server-side on fetch). Clicks go through the signed
// /api/ads/click redirect so billing and safety stay server-side.
// ---------------------------------------------------------------

let adsInflight = null;

/**
 * Fetch the current ad inventory. Concurrent callers share one request and
 * a short window is respected before refetching (mirrors lib/ads-client.ts).
 * Returns { banner, suggestion, suggestions } or null.
 */
export function fetchAds(cfg, page = "/cli", lastIds = []) {
  if (!adsInflight) {
    const last = lastIds.length ? `&last=${encodeURIComponent(lastIds.slice(-5).join(","))}` : "";
    adsInflight = apiJson(cfg, `/api/ads?page=${encodeURIComponent(page)}${last}`)
      .then(({ ok, body }) => (ok ? body : null))
      .catch(() => null)
      .finally(() => {
        setTimeout(() => {
          adsInflight = null;
        }, 4000);
      });
  }
  return adsInflight;
}

// ---------------------------------------------------------------
// Chat — stream the SSE wire format the web app consumes
// ---------------------------------------------------------------

export class ChatAPIError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * Send one conversation turn; calls onDelta(chunk, full) for each content chunk.
 * Resolves with { text, reasoning, tokens }. Quota walls (429) surface
 * the server's own message — it already names the reset time.
 *
 * `opts` is { signal, effort }. An AbortSignal is still accepted in its place so
 * an older caller keeps working — the abort path is too important to break on a
 * signature change.
 */
export async function streamChat(cfg, model, messages, onDelta, opts = {}) {
  const options = opts instanceof AbortSignal ? { signal: opts } : opts;
  const res = await apiFetch(cfg, "/api/chat", {
    method: "POST",
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      ...(options.effort ? { effort: options.effort } : {}),
    }),
    signal: options.signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ChatAPIError(body.error || `request failed (${res.status})`, res.status);
  }
  if (!res.body) throw new ChatAPIError("empty response from server", 502);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  let reasoning = "";
  let tokens = null;
  const sse = { buf: "" };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    sse.buf += value;
    let nl;
    while ((nl = sse.buf.indexOf("\n")) !== -1) {
      const line = sse.buf.slice(0, nl).trim();
      sse.buf = sse.buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const obj = JSON.parse(payload);
        const delta = obj.choices?.[0]?.delta;
        if (typeof delta?.content === "string" && delta.content.length) {
          text += delta.content;
          // The full text rides along so a renderer can repaint the growing
          // bubble without keeping its own copy in sync.
          onDelta(delta.content, text);
        }
        if (typeof delta?.reasoning_content === "string" && delta.reasoning_content.length) {
          reasoning += delta.reasoning_content;
        }
        if (obj.usage && typeof obj.usage.total_tokens === "number") tokens = obj.usage.total_tokens;
      } catch {
        // keep-alives and partial frames are expected; skip them
      }
    }
  }
  return { text, reasoning, tokens };
}

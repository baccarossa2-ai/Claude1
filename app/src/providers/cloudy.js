// Cloudy API client — the renderer port of original/cloudy-cli/src/client.js.
// Same endpoints, same device-token auth, same SSE wire format; the only
// change is the transport (httpFetch, so Authorization survives CORS) and the
// storage (secrets + settings instead of ~/.config/cloudy/config.json).
import { DEFAULT_BASE } from "../../../original/cloudy-cli/src/base-url.js";
import { httpFetch, httpJson, readSSE } from "../platform/http.js";
import { osName } from "../platform/native.js";

export { DEFAULT_BASE };
const DEVICE_NAME = `Cloudy Desktop (${osName})`;

export class CloudyError extends Error {
  constructor(message, status, kind = "error") {
    super(message);
    this.status = status;
    this.kind = kind; // "quota" | "auth" | "error"
  }
}

const auth = (cfg) => (cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {});

// ---------------------------------------------------------------
// Auth — password login or the browser pairing flow (client.js)
// ---------------------------------------------------------------

export async function loginPassword(cfg, email, password) {
  const { ok, status, body } = await httpJson(cfg.base + "/api/desktop/auth", {
    method: "POST",
    body: JSON.stringify({ email, password, deviceName: DEVICE_NAME }),
  });
  if (!ok) throw new CloudyError(body.error || `accesso non riuscito (${status})`, status, "auth");
  return { token: body.token, user: { email: body.user?.email ?? email } };
}

/** Human-friendly code, e.g. ABQ4-K7X2. */
export function formatCode(raw) {
  const c = String(raw).replace(/[^A-Z0-9]/gi, "").toUpperCase();
  return c.length > 4 ? c.slice(0, 4) + "-" + c.slice(4) : c;
}

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

export async function fetchProviders(cfg) {
  try {
    const res = await httpJson(cfg.base + "/api/auth/providers");
    if (!res.ok || !res.body || typeof res.body !== "object") return [];
    return orderedProviders(Object.keys(res.body).filter((id) => id !== "credentials"));
  } catch {
    return [];
  }
}

const PROVIDER_RANK = ["apple", "google", "microsoft-entra-id", "github"];
const PROVIDER_NAMES = { apple: "Apple", google: "Google", github: "GitHub", "microsoft-entra-id": "Microsoft" };

export function providerName(id) {
  if (PROVIDER_NAMES[id]) return PROVIDER_NAMES[id];
  return (
    String(id)
      .split(/[-_]/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ") || String(id)
  );
}

export function orderedProviders(ids) {
  const rank = (id) => {
    const i = PROVIDER_RANK.indexOf(id);
    return i === -1 ? PROVIDER_RANK.length : i;
  };
  return [...new Set(ids || [])].filter((id) => id && id !== "credentials").sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * Browser pairing: create a code, hand the URL to the caller (who opens it),
 * poll until approved. `signal` cancels the wait.
 */
export async function loginPairing(cfg, onCode, provider = null, signal) {
  const { ok, status, body } = await httpJson(`${cfg.base}/api/desktop/oauth?deviceName=${encodeURIComponent(DEVICE_NAME)}`);
  if (!ok) throw new CloudyError(body.error || `impossibile avviare l'abbinamento (${status})`, status, "auth");
  onCode(withProvider(body.url, provider), formatCode(body.code));
  const deadline = Date.now() + Math.max(30, body.expiresIn || 600) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    if (signal?.aborted) throw new CloudyError("abbinamento annullato", 0, "auth");
    const poll = await httpJson(cfg.base + "/api/desktop/oauth/poll", { method: "POST", body: JSON.stringify({ code: body.code }) });
    if (poll.ok && poll.body.status === "complete") return { token: poll.body.token, user: poll.body.user };
    if (poll.ok && poll.body.status === "expired") throw new CloudyError("il codice è scaduto — riprova", 410, "auth");
  }
  throw new CloudyError("tempo scaduto in attesa dell'approvazione — riprova", 408, "auth");
}

export async function fetchModels(cfg) {
  const { ok, status, body } = await httpJson(cfg.base + "/api/chat", { headers: auth(cfg) });
  if (!ok) throw new CloudyError(`impossibile caricare i modelli (${status})`, status);
  return { models: body.models || [], default: body.default || null };
}

export async function fetchUsage(cfg) {
  if (!cfg.token) return null;
  const { ok, body } = await httpJson(cfg.base + "/api/usage", { headers: auth(cfg) });
  return ok ? body : null;
}

export async function fetchMe(cfg) {
  if (!cfg.token) return null;
  const { ok, body } = await httpJson(cfg.base + "/api/desktop/me", { headers: auth(cfg) });
  return ok ? body : null;
}

/** `cloudy usage` lines (main.js usageLines), in Italian. */
export function usageLines(u) {
  if (!u) return ["nessun dato di utilizzo (hai effettuato l'accesso?)"];
  if (u.trial) return [`prova: ${u.trial.remaining} di ${u.trial.limit} messaggi rimasti oggi`];
  const m = u.messages?.daily;
  const w = u.messages?.weekly;
  const c = u.credits?.daily;
  const cw = u.credits?.weekly;
  if (!m || !c) return ["nessun dato di utilizzo (hai effettuato l'accesso?)"];
  return [
    `messaggi — oggi: ${m.used}/${m.limit} · questa settimana: ${w?.used ?? 0}/${w?.limit ?? 0}`,
    `crediti agente — oggi: ${c.used}/${c.limit} · questa settimana: ${cw?.used ?? 0}/${cw?.limit ?? 0}`,
  ];
}

// ---------------------------------------------------------------
// Ads — the sponsor card (GET /api/ads; clicks go through /api/ads/click)
// ---------------------------------------------------------------

let adsInflight = null;
export function fetchAds(cfg, page = "/desktop", lastIds = []) {
  if (!adsInflight) {
    const last = lastIds.length ? `&last=${encodeURIComponent(lastIds.slice(-5).join(","))}` : "";
    adsInflight = httpJson(`${cfg.base}/api/ads?page=${encodeURIComponent(page)}${last}`, { headers: auth(cfg) })
      .then(({ ok, body }) => (ok ? body : null))
      .catch(() => null)
      .finally(() => setTimeout(() => (adsInflight = null), 4000));
  }
  return adsInflight;
}

/** A relative ad link is resolved against our own base (tui.js adTargetUrl). */
export function adTargetUrl(base, link) {
  try {
    return new URL(link, base).toString();
  } catch {
    return base;
  }
}

// ---------------------------------------------------------------
// Chat — the OpenAI-compatible chunk stream /api/chat serves
// ---------------------------------------------------------------

function toCloudyMessages(messages, { vision }) {
  const out = [];
  for (const m of messages) {
    if (m.role === "tool") {
      for (const r of m.results) out.push({ role: "tool", tool_call_id: r.id, content: r.output });
      continue;
    }
    if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.text || "",
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })) }
          : {}),
      });
      continue;
    }
    const images = vision ? (m.attachments || []).filter((a) => a.kind === "image") : [];
    const text = m.text || "";
    if (images.length) {
      out.push({
        role: "user",
        content: [{ type: "text", text }, ...images.map((a) => ({ type: "image_url", image_url: { url: `data:${a.mime};base64,${a.data}` } }))],
      });
    } else out.push({ role: "user", content: text });
  }
  return out;
}

/**
 * One request to /api/chat. `agent` opts into the coding-agent contract the
 * original host uses (agent:true, agentStep, messageKind:"agent", extra
 * tools) — agent turns are billed in agent credits, plain chat in messages.
 */
export async function sendChat(cfg, { model, messages, system, tools, agent, effort, vision, signal, onText, onReasoning }) {
  const wire = toCloudyMessages(messages, { vision });
  // /api/chat accepts only user / assistant / tool roles. Like the original
  // host's workspace note, our context rides on the last user message.
  if (system) {
    const last = [...wire].reverse().find((m) => m.role === "user");
    const note = `\n\n[Contesto]\n${system}`;
    if (last && typeof last.content === "string") last.content += note;
    else if (last && Array.isArray(last.content)) last.content[0].text += note;
  }
  const body = {
    model,
    messages: wire,
    stream: true,
    ...(effort ? { effort } : {}),
    ...(agent
      ? {
          agent: true,
          tools: agent.finalAnswer ? [] : tools?.length ? tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } })) : true,
          ...(agent.step > 0 ? { agentStep: true } : {}),
          messageKind: "agent",
        }
      : {}),
  };
  const res = await httpFetch(cfg.base + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...auth(cfg) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = (typeof err.error === "string" ? err.error : err.error?.message) || `richiesta non riuscita (${res.status})`;
    throw new CloudyError(msg, res.status, res.status === 429 ? "quota" : res.status === 401 ? "auth" : "error");
  }
  let text = "";
  let reasoning = "";
  let failure = null;
  let usage = null;
  const calls = new Map();
  await readSSE(res, (payload) => {
    if (payload === "[DONE]") return true;
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      return false;
    }
    if (chunk.error) {
      failure = chunk.error.message || String(chunk.error);
      return true;
    }
    if (chunk.usage) usage = { input: chunk.usage.prompt_tokens ?? 0, output: chunk.usage.completion_tokens ?? 0, total: chunk.usage.total_tokens ?? 0 };
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return false;
    // `reasoning` is what the proxy sends today; `reasoning_content` is what
    // the CLI was written against — read both, like the host does.
    const think = delta.reasoning_content ?? delta.reasoning ?? "";
    if (think) {
      reasoning += think;
      onReasoning?.(think);
    }
    if (delta.content) {
      text += delta.content;
      onText?.(delta.content);
    }
    for (const tc of delta.tool_calls ?? []) {
      const idx = typeof tc.index === "number" ? tc.index : 0;
      const cur = calls.get(idx) ?? { id: "", name: "", args: "" };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name += tc.function.name;
      if (tc.function?.arguments) cur.args += tc.function.arguments;
      calls.set(idx, cur);
    }
    return false;
  });
  if (failure) {
    const quota = /limit|quota|429/i.test(failure) && /reset|today|week|giorn|limite/i.test(failure);
    throw new CloudyError(failure, quota ? 429 : 502, quota ? "quota" : "error");
  }
  const toolCalls = [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => ({ id: c.id || `call_${Math.random().toString(36).slice(2, 10)}`, name: c.name, args: parseArgs(c.args) }))
    .filter((c) => c.name);
  return { text, reasoning, toolCalls, usage };
}

function parseArgs(s) {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return { __invalid_json: s };
  }
}

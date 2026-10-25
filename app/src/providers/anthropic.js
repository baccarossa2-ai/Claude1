// Claude through the official Anthropic SDK. The SDK gets our httpFetch as its
// transport, so requests leave through Electron's main process / the Android
// plugin and stream exactly like a Node client would.
import Anthropic from "@anthropic-ai/sdk";
import { httpFetch } from "../platform/http.js";

const clients = new Map();
export function anthropicClient(apiKey, baseURL) {
  const key = `${apiKey}|${baseURL || ""}`;
  if (!clients.has(key)) {
    clients.set(
      key,
      new Anthropic({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
        fetch: httpFetch,
        dangerouslyAllowBrowser: true,
        maxRetries: 2,
      })
    );
  }
  return clients.get(key);
}

/** Every model the key can use (GET /v1/models, auto-paginated). */
export async function listAnthropicModels(apiKey, baseURL) {
  const out = [];
  for await (const m of anthropicClient(apiKey, baseURL).models.list({ limit: 100 })) {
    out.push({ id: m.id, name: m.display_name || m.id, createdAt: m.created_at, contextWindow: m.max_input_tokens ?? null, maxOutput: m.max_tokens ?? null });
  }
  return out;
}

/** Current-generation models take adaptive thinking + output_config.effort. */
export function isModernClaude(model) {
  const m = /claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?/.exec(model || "");
  if (!m) return false;
  const major = Number(m[2]);
  if (m[1] === "haiku") return major >= 5;
  return major >= 5 || (major === 4 && Number(m[3] || 0) >= 6);
}

// Models that take the server-side refusal fallback ("default" routing).
const FALLBACK_MODELS = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;

function attachmentBlocks(atts = []) {
  const blocks = [];
  for (const a of atts) {
    if (a.kind === "image" && /^image\/(png|jpe?g|gif|webp)$/.test(a.mime)) {
      blocks.push({ type: "image", source: { type: "base64", media_type: a.mime === "image/jpg" ? "image/jpeg" : a.mime, data: a.data } });
    } else if (a.kind === "pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data }, title: a.name });
    } else if (a.kind === "text") {
      blocks.push({ type: "text", text: `<file name="${a.name}">\n${a.data}\n</file>` });
    } else {
      blocks.push({ type: "text", text: `[Allegato binario "${a.name}" (${a.mime || "sconosciuto"}, ${a.size} byte) — contenuto non leggibile come testo]` });
    }
  }
  return blocks;
}

export function toAnthropicMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === "user") {
      const content = [...attachmentBlocks(m.attachments), ...(m.text ? [{ type: "text", text: m.text }] : [])];
      out.push({ role: "user", content: content.length ? content : [{ type: "text", text: "(vuoto)" }] });
    } else if (m.role === "assistant") {
      if (m.raw?.length) {
        out.push({ role: "assistant", content: m.raw });
        continue;
      }
      const content = [];
      if (m.text) content.push({ type: "text", text: m.text });
      for (const c of m.toolCalls || []) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.args ?? {} });
      if (content.length) out.push({ role: "assistant", content });
    } else if (m.role === "tool") {
      // All results of one step go back in ONE user message (parallel tool use).
      out.push({
        role: "user",
        content: m.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.output || "(nessun output)", ...(r.isError ? { is_error: true } : {}) })),
      });
    }
  }
  return out;
}

/**
 * One streamed turn. Returns { text, reasoning, toolCalls, raw, stop, usage }.
 * `raw` is the full content array — replayed unchanged on the next step so
 * thinking blocks stay valid (append-only history).
 */
export async function sendAnthropic({ apiKey, baseURL, model, system, messages, tools, effort, signal, onText, onReasoning, fallbacks = true, firstParty = true }) {
  const client = anthropicClient(apiKey, baseURL);
  const modern = isModernClaude(model);
  const params = {
    model,
    max_tokens: 64000,
    messages: toAnthropicMessages(messages),
    ...(system ? { system } : {}),
    ...(tools?.length
      ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema, eager_input_streaming: true })) }
      : {}),
    ...(modern
      ? {
          thinking: { type: "adaptive", display: "summarized" },
          ...(effort ? { output_config: { effort: effort === "max" ? "max" : effort } } : {}),
        }
      : {}),
  };
  const useFallback = firstParty && fallbacks && FALLBACK_MODELS.test(model);

  const run = async (withFallback) => {
    const stream = withFallback
      ? client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }, { signal })
      : client.messages.stream(params, { signal });
    stream.on("text", (delta) => onText?.(delta));
    stream.on("thinking", (delta) => onReasoning?.(delta));
    return stream.finalMessage();
  };

  let message;
  try {
    message = await run(useFallback);
  } catch (err) {
    // A proxy or gateway that does not know the fallback beta rejects the
    // field; the same request without it is still a valid request.
    if (useFallback && err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message)) message = await run(false);
    else throw mapError(err);
  }

  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const reasoning = message.content.filter((b) => b.type === "thinking").map((b) => b.thinking).join("\n");
  const toolCalls = message.content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} }));
  if (message.stop_reason === "refusal") {
    const cat = message.stop_details?.category;
    throw Object.assign(new Error(`Claude ha rifiutato questa richiesta${cat ? ` (categoria: ${cat})` : ""}.`), { kind: "refusal" });
  }
  if (message.stop_reason === "max_tokens" && toolCalls.length) {
    throw Object.assign(new Error("La risposta è stata troncata mentre Claude scriveva un comando (max_tokens). Riprova con un compito più piccolo."), { kind: "error" });
  }
  return {
    text,
    reasoning,
    toolCalls,
    raw: message.content,
    stop: message.stop_reason,
    servedBy: message.model,
    usage: { input: message.usage?.input_tokens ?? 0, output: message.usage?.output_tokens ?? 0, cached: message.usage?.cache_read_input_tokens ?? 0 },
  };
}

function mapError(err) {
  if (err?.name === "AbortError" || err instanceof Anthropic.APIUserAbortError) return Object.assign(new Error("aborted"), { name: "AbortError" });
  if (err instanceof Anthropic.AuthenticationError) return Object.assign(new Error("Chiave API Anthropic non valida o revocata."), { kind: "auth", status: 401 });
  if (err instanceof Anthropic.PermissionDeniedError) return Object.assign(new Error("La chiave API non ha accesso a questo modello."), { kind: "auth", status: 403 });
  if (err instanceof Anthropic.NotFoundError) return Object.assign(new Error("Modello non trovato: potrebbe essere stato ritirato. Aggiorna la tabella modelli."), { kind: "model", status: 404 });
  if (err instanceof Anthropic.RateLimitError) return Object.assign(new Error("Limite di richieste Claude raggiunto: riprova tra poco."), { kind: "quota", status: 429 });
  if (err instanceof Anthropic.BadRequestError) return Object.assign(new Error(`Richiesta rifiutata da Claude: ${err.message}`), { kind: "error", status: 400 });
  if (err instanceof Anthropic.APIError) return Object.assign(new Error(`Errore Claude ${err.status ?? ""}: ${err.message}`), { kind: "error", status: err.status });
  return err;
}

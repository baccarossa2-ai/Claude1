// Custom providers that speak the OpenAI Chat Completions dialect — OpenAI,
// OpenRouter, Groq, Mistral, DeepSeek, Together, Gemini (OpenAI endpoint),
// xAI, Ollama, LM Studio, or anything the user points at.
import { httpFetch, httpJson, readSSE } from "../platform/http.js";

export const PROVIDER_PRESETS = [
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", keyHint: "sk-…", logo: "gpt.svg", format: "openai" },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", keyHint: "sk-or-…", format: "openai" },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", keyHint: "gsk_…", format: "openai" },
  { id: "mistral", name: "Mistral AI", baseUrl: "https://api.mistral.ai/v1", keyHint: "", format: "openai" },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", keyHint: "sk-…", logo: "deepseek.png", format: "openai" },
  { id: "gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyHint: "AIza…", format: "openai" },
  { id: "xai", name: "xAI Grok", baseUrl: "https://api.x.ai/v1", keyHint: "xai-…", format: "openai" },
  { id: "together", name: "Together AI", baseUrl: "https://api.together.xyz/v1", keyHint: "", format: "openai" },
  { id: "fireworks", name: "Fireworks", baseUrl: "https://api.fireworks.ai/inference/v1", keyHint: "fw_…", format: "openai" },
  { id: "cerebras", name: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", keyHint: "csk-…", format: "openai" },
  { id: "perplexity", name: "Perplexity", baseUrl: "https://api.perplexity.ai", keyHint: "pplx-…", format: "openai" },
  { id: "ollama", name: "Ollama (locale)", baseUrl: "http://localhost:11434/v1", keyHint: "nessuna chiave", format: "openai" },
  { id: "lmstudio", name: "LM Studio (locale)", baseUrl: "http://localhost:1234/v1", keyHint: "nessuna chiave", format: "openai" },
  { id: "anthropic-compatible", name: "Compatibile Anthropic", baseUrl: "https://", keyHint: "", format: "anthropic" },
  { id: "custom", name: "Personalizzato", baseUrl: "https://", keyHint: "", format: "openai" },
];

const join = (base, p) => base.replace(/\/+$/, "") + p;
const authHeaders = (key) => (key ? { Authorization: `Bearer ${key}` } : {});

export async function listOpenAIModels(baseUrl, apiKey) {
  const { ok, status, body } = await httpJson(join(baseUrl, "/models"), { headers: authHeaders(apiKey) });
  if (!ok) throw new Error(body?.error?.message || `impossibile leggere i modelli (${status})`);
  const list = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : Array.isArray(body) ? body : [];
  return list
    .map((m) => ({ id: m.id || m.name, name: m.name && m.name !== m.id ? m.name : m.id || m.name, contextWindow: m.context_length ?? m.context_window ?? null }))
    .filter((m) => m.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function toOpenAIMessages(messages, system) {
  const out = system ? [{ role: "system", content: system }] : [];
  for (const m of messages) {
    if (m.role === "tool") {
      for (const r of m.results) out.push({ role: "tool", tool_call_id: r.id, content: r.output || "" });
    } else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.text || "",
        ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })) } : {}),
      });
    } else {
      const atts = m.attachments || [];
      const texts = atts.filter((a) => a.kind === "text").map((a) => `<file name="${a.name}">\n${a.data}\n</file>`);
      const others = atts.filter((a) => a.kind === "pdf" || a.kind === "binary").map((a) => `[Allegato "${a.name}" (${a.mime}, ${a.size} byte)]`);
      const images = atts.filter((a) => a.kind === "image");
      const text = [...texts, ...others, m.text || ""].filter(Boolean).join("\n\n");
      out.push(
        images.length
          ? { role: "user", content: [{ type: "text", text }, ...images.map((a) => ({ type: "image_url", image_url: { url: `data:${a.mime};base64,${a.data}` } }))] }
          : { role: "user", content: text }
      );
    }
  }
  return out;
}

export async function sendOpenAI({ baseUrl, apiKey, model, system, messages, tools, effort, signal, onText, onReasoning, extraHeaders }) {
  const body = {
    model,
    stream: true,
    messages: toOpenAIMessages(messages, system),
    ...(tools?.length ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } })) } : {}),
    ...(effort && /^(o\d|gpt-5)/.test(model) ? { reasoning_effort: effort === "max" ? "high" : effort } : {}),
  };
  const res = await httpFetch(join(baseUrl, "/chat/completions"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...authHeaders(apiKey), ...(extraHeaders || {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || err?.message || `richiesta non riuscita (${res.status})`;
    throw Object.assign(new Error(msg), { status: res.status, kind: res.status === 429 ? "quota" : res.status === 401 ? "auth" : "error" });
  }
  let text = "";
  let reasoning = "";
  let usage = null;
  let failure = null;
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
    if (chunk.usage) usage = { input: chunk.usage.prompt_tokens ?? 0, output: chunk.usage.completion_tokens ?? 0 };
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return false;
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
  if (failure) throw Object.assign(new Error(failure), { kind: "error" });
  const toolCalls = [...calls.values()]
    .filter((c) => c.name)
    .map((c) => {
      let args = {};
      try {
        args = c.args ? JSON.parse(c.args) : {};
      } catch {
        args = { __invalid_json: c.args };
      }
      return { id: c.id || `call_${Math.random().toString(36).slice(2, 10)}`, name: c.name, args };
    });
  return { text, reasoning, toolCalls, usage };
}

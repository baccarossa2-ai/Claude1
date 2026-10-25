// Minimal Model Context Protocol client: Streamable HTTP (and the legacy SSE
// transport) from the renderer, stdio servers through the desktop main
// process. Connectors expose their tools to the agent as mcp__<server>__<tool>.
import { httpFetch, readSSE } from "../platform/http.js";
import { invoke, isDesktop } from "../platform/native.js";

const PROTOCOL = "2025-06-18";
const CLIENT = { name: "cloudy-desktop", version: "2.0.0" };

class HttpTransport {
  constructor(cfg) {
    this.cfg = cfg;
    this.session = null;
    this.protocol = PROTOCOL;
    this.nextId = 1;
  }
  headers(extra = {}) {
    return {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(this.session ? { "Mcp-Session-Id": this.session } : {}),
      ...(this.initialized ? { "MCP-Protocol-Version": this.protocol } : {}),
      ...(this.cfg.token ? { Authorization: `Bearer ${this.cfg.token}` } : {}),
      ...(this.cfg.headers || {}),
      ...extra,
    };
  }
  async request(method, params, { signal, notify = false } = {}) {
    const id = notify ? undefined : this.nextId++;
    const res = await httpFetch(this.cfg.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", ...(notify ? {} : { id }), method, ...(params ? { params } : {}) }),
      signal,
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.session = sid;
    if (notify) {
      res.body?.cancel?.().catch(() => {});
      return null;
    }
    if (res.status === 401 || res.status === 403) throw new Error("Il connettore richiede l'autenticazione: aggiungi un token nelle impostazioni del connettore.");
    if (!res.ok) throw new Error(`Il server MCP ha risposto ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const type = res.headers.get("content-type") || "";
    let msg = null;
    if (type.includes("text/event-stream")) {
      await readSSE(res, (data) => {
        try {
          const j = JSON.parse(data);
          if (j.id === id) {
            msg = j;
            return true;
          }
        } catch {
          /* keep reading */
        }
        return false;
      });
    } else {
      const text = await res.text();
      msg = text ? JSON.parse(text) : null;
      if (Array.isArray(msg)) msg = msg.find((m) => m.id === id) || msg[0];
    }
    if (!msg) throw new Error("Nessuna risposta dal server MCP");
    if (msg.error) throw new Error(msg.error.message || "errore MCP");
    return msg.result;
  }
  close() {
    if (this.session) httpFetch(this.cfg.url, { method: "DELETE", headers: this.headers() }).catch(() => {});
  }
}

/** Legacy HTTP+SSE: a GET stream that names a POST endpoint; replies arrive on the stream. */
class SseTransport {
  constructor(cfg) {
    this.cfg = cfg;
    this.nextId = 1;
    this.pending = new Map();
    this.ctrl = new AbortController();
  }
  async open() {
    const res = await httpFetch(this.cfg.url, {
      headers: { Accept: "text/event-stream", ...(this.cfg.token ? { Authorization: `Bearer ${this.cfg.token}` } : {}), ...(this.cfg.headers || {}) },
      signal: this.ctrl.signal,
    });
    if (!res.ok) throw new Error(`SSE ${res.status}`);
    let event = "message";
    await new Promise((resolve, reject) => {
      readSSE(
        res,
        (data) => {
          if (event === "endpoint") {
            this.endpoint = new URL(data, this.cfg.url).toString();
            resolve();
          } else {
            try {
              const j = JSON.parse(data);
              const p = this.pending.get(j.id);
              if (p) {
                this.pending.delete(j.id);
                j.error ? p.reject(new Error(j.error.message)) : p.resolve(j.result);
              }
            } catch {
              /* ignore */
            }
          }
          event = "message";
          return false;
        },
        (name) => (event = name)
      ).catch(reject);
      setTimeout(() => reject(new Error("il server SSE non ha indicato l'endpoint")), 15000);
    });
  }
  async request(method, params, { notify = false } = {}) {
    if (!this.endpoint) await this.open();
    const id = notify ? undefined : this.nextId++;
    const p = notify ? null : new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    await httpFetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(this.cfg.token ? { Authorization: `Bearer ${this.cfg.token}` } : {}), ...(this.cfg.headers || {}) },
      body: JSON.stringify({ jsonrpc: "2.0", ...(notify ? {} : { id }), method, ...(params ? { params } : {}) }),
    });
    return p;
  }
  close() {
    this.ctrl.abort();
  }
}

class StdioTransport {
  constructor(cfg) {
    this.cfg = cfg;
    this.key = "mcp_" + cfg.id;
  }
  async request(method, params, { notify = false } = {}) {
    if (!this.started) {
      await invoke("mcp:start", this.key, { command: this.cfg.command, args: this.cfg.args || [], env: this.cfg.env || {}, cwd: this.cfg.cwd || null });
      this.started = true;
    }
    return invoke("mcp:request", this.key, { method, params, notify });
  }
  close() {
    if (this.started) invoke("mcp:stop", this.key).catch(() => {});
    this.started = false;
  }
}

export class McpClient {
  constructor(cfg) {
    this.cfg = cfg;
    this.transport =
      cfg.transport === "stdio" ? new StdioTransport(cfg) : cfg.transport === "sse" || /\/sse\/?$/.test(cfg.url || "") ? new SseTransport(cfg) : new HttpTransport(cfg);
    this.tools = [];
    this.serverInfo = null;
  }
  async connect() {
    if (this.cfg.transport === "stdio" && !isDesktop) throw new Error("I server MCP locali (stdio) funzionano solo nell'app desktop.");
    const init = await this.transport.request("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: CLIENT });
    this.serverInfo = init?.serverInfo || null;
    if (init?.protocolVersion) this.transport.protocol = init.protocolVersion;
    this.transport.initialized = true;
    await this.transport.request("notifications/initialized", undefined, { notify: true }).catch(() => {});
    this.tools = [];
    let cursor;
    do {
      const r = await this.transport.request("tools/list", cursor ? { cursor } : {});
      this.tools.push(...(r?.tools || []));
      cursor = r?.nextCursor;
    } while (cursor && this.tools.length < 500);
    return this;
  }
  async call(name, args, signal) {
    const r = await this.transport.request("tools/call", { name, arguments: args || {} }, { signal });
    const parts = [];
    const images = [];
    for (const c of r?.content || []) {
      if (c.type === "text") parts.push(c.text);
      else if (c.type === "image") images.push({ mime: c.mimeType, data: c.data });
      else if (c.type === "resource") parts.push(c.resource?.text || `[risorsa ${c.resource?.uri}]`);
      else if (c.type === "resource_link") parts.push(`[${c.name || c.uri}](${c.uri})`);
    }
    if (r?.structuredContent && !parts.length) parts.push(JSON.stringify(r.structuredContent, null, 2));
    return { output: parts.join("\n\n") || (images.length ? `[${images.length} immagine/i]` : "(nessun output)"), isError: !!r?.isError, images };
  }
  close() {
    this.transport.close?.();
  }
}

/** A tool name the model APIs accept: [a-zA-Z0-9_-], at most 64 chars. */
export function mcpToolName(server, tool) {
  const s = (x) => String(x).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `mcp__${s(server)}__${s(tool)}`.slice(0, 64);
}

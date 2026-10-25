// Live MCP connections for the enabled connectors (catalog + custom), and
// their tools in the agent's shape.
import { McpClient, mcpToolName } from "../connectors/mcp.js";
import { CONNECTOR_CATALOG } from "../connectors/catalog.js";
import { isDesktop } from "../platform/native.js";
import { getSettings, store, updateSettings } from "./store.js";
import { pluginConnectorIds } from "./plugins.js";

const clients = new Map();

export function connectorList() {
  const s = getSettings();
  return [...CONNECTOR_CATALOG, ...(s.customConnectors || []).map((c) => ({ ...c, custom: true }))];
}

export function connectorConfig(id) {
  const base = connectorList().find((c) => c.id === id);
  const user = getSettings().connectors[id] || {};
  return base ? { ...base, ...user } : null;
}

export function isConnectorEnabled(id) {
  const user = getSettings().connectors[id];
  if (user && user.enabled !== undefined) return user.enabled;
  return pluginConnectorIds().has(id) && connectorConfig(id)?.auth !== "token";
}

export function setConnector(id, patch) {
  updateSettings((s) => ({ connectors: { ...s.connectors, [id]: { ...(s.connectors[id] || {}), ...patch } } }));
  const c = clients.get(id);
  if (c) {
    c.close();
    clients.delete(id);
  }
  setState(id, { status: "idle", tools: [], error: null });
}

function setState(id, patch) {
  store.set((s) => ({ connectorState: { ...s.connectorState, [id]: { ...(s.connectorState[id] || {}), ...patch } } }));
}

function expand(cfg, workspaceRoot) {
  const sub = (v) => String(v).replace("{workspace}", workspaceRoot || ".");
  return { ...cfg, args: (cfg.args || []).map(sub), url: cfg.url ? sub(cfg.url) : cfg.url };
}

export async function connect(id, { workspaceRoot } = {}) {
  const cfg = connectorConfig(id);
  if (!cfg) throw new Error(`Connettore sconosciuto: ${id}`);
  if (cfg.transport === "stdio" && !isDesktop) throw new Error("Disponibile solo nell'app desktop");
  if (clients.has(id)) return clients.get(id);
  setState(id, { status: "connecting", error: null });
  try {
    const client = await new McpClient(expand(cfg, workspaceRoot)).connect();
    clients.set(id, client);
    setState(id, { status: "connected", tools: client.tools.map((t) => ({ name: t.name, description: t.description })), server: client.serverInfo });
    return client;
  } catch (e) {
    setState(id, { status: "error", error: e.message, tools: [] });
    throw e;
  }
}

export function disconnect(id) {
  clients.get(id)?.close();
  clients.delete(id);
  setState(id, { status: "idle", tools: [] });
}

/** Tools of every enabled connector, connecting on demand (failures are skipped). */
export async function connectorTools({ workspaceRoot } = {}) {
  const out = [];
  const enabled = connectorList().filter((c) => isConnectorEnabled(c.id) && (isDesktop || c.transport !== "stdio"));
  await Promise.all(
    enabled.map(async (c) => {
      try {
        const client = await connect(c.id, { workspaceRoot });
        for (const t of client.tools) {
          out.push({
            name: mcpToolName(c.id, t.name),
            kind: t.annotations?.readOnlyHint ? "read" : "net-write",
            description: `[${c.name}] ${t.description || t.name}`.slice(0, 1024),
            schema: t.inputSchema && t.inputSchema.type === "object" ? { ...t.inputSchema, properties: t.inputSchema.properties || {} } : { type: "object", properties: {} },
            async run(args, ctx) {
              const r = await client.call(t.name, args, ctx.signal);
              for (const img of r.images || []) ctx.emit?.({ type: "image", mime: img.mime, data: img.data, prompt: `${c.name}: ${t.name}` });
              if (r.isError) throw new Error(r.output);
              return r.output;
            },
          });
        }
      } catch {
        /* an unreachable connector must not block the turn */
      }
    })
  );
  return out;
}

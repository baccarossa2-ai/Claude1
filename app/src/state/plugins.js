// Installed plugins → the skills, commands, connectors and prompt additions
// they contribute.
import { PLUGIN_CATALOG } from "../plugins/catalog.js";
import { BUILTIN_SKILLS } from "../skills/builtin.js";
import { getSettings, updateSettings } from "./store.js";

export function pluginList() {
  return [...PLUGIN_CATALOG, ...(getSettings().customPlugins || [])];
}

export function installedPlugins() {
  const on = getSettings().plugins || {};
  return pluginList().filter((p) => on[p.id]);
}

export function setPlugin(id, enabled) {
  updateSettings((s) => ({ plugins: { ...s.plugins, [id]: enabled } }));
}

export function pluginSkills() {
  const out = [];
  for (const p of installedPlugins()) {
    for (const s of p.skills || []) {
      if (typeof s === "string") {
        const b = BUILTIN_SKILLS.find((x) => x.name === s);
        if (b) out.push(b);
      } else out.push({ ...s, icon: s.icon || p.icon, source: p.name });
    }
  }
  return out;
}

export function pluginCommands() {
  const out = [];
  for (const p of installedPlugins()) for (const c of p.commands || []) out.push({ ...c, plugin: p.name, icon: p.icon });
  return out;
}

export function pluginConnectorIds() {
  return new Set(installedPlugins().flatMap((p) => p.connectors || []));
}

export function pluginPrompts() {
  return installedPlugins()
    .filter((p) => p.systemPrompt)
    .map((p) => `[Plugin ${p.name}] ${p.systemPrompt}`);
}

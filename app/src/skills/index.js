// Every skill the agent can be told about: built-in ones, the user's own
// (created in Settings or imported), the ones installed plugins bring, and
// the workspace's .cloudy/skills/*.md + .claude/skills/*/SKILL.md files.
import { BUILTIN_SKILLS } from "./builtin.js";

/** Front-matter parser — same rules as the original host's parseSkill. */
export function parseSkill(raw, fallbackName = "") {
  if (!raw || !raw.trim()) return null;
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { name: fallbackName, description: "", content: raw.trim() };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { name: meta.name || fallbackName, description: meta.description || "", content: m[2].trim() };
}

export function skillToMarkdown(s) {
  return `---\nname: ${s.name}\ndescription: ${s.description || ""}\n---\n\n${s.content || ""}\n`;
}

export async function workspaceSkills(ws) {
  if (!ws) return [];
  const out = [];
  try {
    for (const e of await ws.list(".cloudy/skills")) {
      if (e.type !== "file" || !/\.md$/i.test(e.name)) continue;
      const s = parseSkill(await ws.read(`.cloudy/skills/${e.name}`), e.name.replace(/\.md$/i, ""));
      if (s) out.push({ ...s, source: "workspace", icon: "📁" });
    }
  } catch {
    /* no .cloudy/skills */
  }
  try {
    for (const e of await ws.list(".claude/skills")) {
      if (e.type !== "dir") continue;
      try {
        const s = parseSkill(await ws.read(`.claude/skills/${e.name}/SKILL.md`), e.name);
        if (s) out.push({ ...s, source: "claude", icon: "✳️" });
      } catch {
        /* folder without SKILL.md */
      }
    }
  } catch {
    /* no .claude/skills */
  }
  return out;
}

/**
 * The skills offered to the model. `disabled` lists names the user switched
 * off; later sources win on a name clash (workspace beats built-in).
 */
export function collectSkills({ user = [], plugins = [], workspace = [], disabled = [] }) {
  const byName = new Map();
  for (const s of [...BUILTIN_SKILLS, ...plugins, ...user, ...workspace]) if (s?.name) byName.set(s.name, s);
  return [...byName.values()].filter((s) => !disabled.includes(s.name));
}

export function skillsPromptBlock(skills) {
  if (!skills.length) return "";
  const lines = skills.map((s) => `- ${s.name}: ${s.description || "(nessuna descrizione)"}`);
  return `\n\n## Skills disponibili\nQuando il compito corrisponde a una skill, caricala con il tool use_skill e segui le sue istruzioni.\n${lines.join("\n")}`;
}

export { BUILTIN_SKILLS };

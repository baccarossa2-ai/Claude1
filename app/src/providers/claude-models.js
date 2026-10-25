// The Claude model table: one row per family (Fable, Opus, Sonnet, Haiku…),
// always the newest version. When a family moves on (Opus 5 → Opus 5.5) the
// old row disappears and the new one takes its place; diffTables() reports
// the swap so the app can ASK the user before any conversation moves to it.
// Pure functions — tests/unit/claude-models.test.mjs covers them.

export const FAMILY_ORDER = ["fable", "mythos", "opus", "sonnet", "haiku"];

const FAMILY_BLURB = {
  fable: "Il più capace, per i compiti più difficili e lunghi",
  mythos: "Accesso riservato (Project Glasswing)",
  opus: "Il migliore per compiti complessi di tutti i giorni",
  sonnet: "Veloce e capace per lavoro quotidiano e coding",
  haiku: "Il più rapido, per risposte immediate",
};

/** Shipped so the table is never empty offline; live sources replace it. */
export const BUILTIN_CLAUDE = [
  { id: "claude-fable-5-1", contextWindow: 1000000 },
  { id: "claude-opus-5-5", contextWindow: 1000000 },
  { id: "claude-sonnet-5-5", contextWindow: 1000000 },
  { id: "claude-haiku-5-5", contextWindow: 1000000 },
].map((m) => ({ ...describe(m.id), ...m, source: "builtin" }));

/**
 * claude-opus-5-5 → { family:"opus", major:5, minor:5, label:"Opus 5.5" }.
 * Also reads dated ids (claude-haiku-4-5-20251001) and the old
 * claude-3-5-sonnet-20241022 ordering. Null for anything that is not Claude.
 */
export function parseClaudeId(id) {
  const s = String(id || "").toLowerCase();
  let m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-(\d{8}))?$/.exec(s);
  if (m && !/^\d/.test(m[1])) {
    return { family: m[1], major: Number(m[2]), minor: m[3] ? Number(m[3]) : 0, date: m[4] ? Number(m[4]) : 0 };
  }
  m = /^claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)(?:-(\d{8}))?$/.exec(s);
  if (m) return { family: m[3], major: Number(m[1]), minor: m[2] ? Number(m[2]) : 0, date: m[4] ? Number(m[4]) : 0 };
  return null;
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function describe(id, extra = {}) {
  const p = parseClaudeId(id);
  if (!p) return { id, family: "other", label: extra.name || id, version: "", blurb: extra.description || "" };
  const version = p.minor ? `${p.major}.${p.minor}` : String(p.major);
  return {
    id,
    family: p.family,
    version,
    label: `${cap(p.family)} ${version}`,
    name: `Claude ${cap(p.family)} ${version}`,
    blurb: FAMILY_BLURB[p.family] || extra.description || "",
  };
}

/** Is `a` a newer model than `b` (same family assumed)? */
export function isNewerModel(a, b) {
  const pa = parseClaudeId(a.id);
  const pb = parseClaudeId(b.id);
  if (!pa || !pb) return (a.createdAt || "") > (b.createdAt || "");
  if (pa.major !== pb.major) return pa.major > pb.major;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor;
  if (pa.date !== pb.date) return pa.date > pb.date;
  return (a.createdAt || "") > (b.createdAt || "");
}

/** Keep only the newest model of each family, in display order. */
export function latestPerFamily(models) {
  const best = new Map();
  for (const m of models) {
    if (!m?.id) continue;
    const fam = describe(m.id).family;
    if (fam === "other") continue;
    const cur = best.get(fam);
    if (!cur || isNewerModel(m, cur)) best.set(fam, m);
  }
  const rank = (f) => {
    const i = FAMILY_ORDER.indexOf(f);
    return i === -1 ? FAMILY_ORDER.length : i;
  };
  return [...best.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([, m]) => ({ ...describe(m.id, m), ...m, ...pick(describe(m.id, m)) }));
}

const pick = (d) => ({ family: d.family, label: d.label, name: d.name, version: d.version, blurb: d.blurb || "" });

/**
 * Merge every live source into one list (Claude Code's own model list, the
 * /v1/models listing for an API key), then reduce it to the table.
 */
export function buildTable({ code = [], api = [] } = {}) {
  const byId = new Map();
  const add = (m, source) => {
    if (!m?.id || !parseClaudeId(m.id)) return;
    const prev = byId.get(m.id) || {};
    byId.set(m.id, { ...prev, ...Object.fromEntries(Object.entries(m).filter(([, v]) => v != null)), sources: [...new Set([...(prev.sources || []), source])] });
  };
  for (const m of code) add(m, "claude-code");
  for (const m of api) add(m, "api");
  const live = [...byId.values()];
  return latestPerFamily(live.length ? live : BUILTIN_CLAUDE);
}

/** What changed between two tables, family by family. */
export function diffTables(prev = [], next = []) {
  const p = new Map(prev.map((m) => [m.family, m]));
  const n = new Map(next.map((m) => [m.family, m]));
  const replaced = [];
  const added = [];
  const removed = [];
  for (const [fam, m] of n) {
    const old = p.get(fam);
    if (!old) added.push(m);
    else if (old.id !== m.id) replaced.push({ family: fam, from: old, to: m });
  }
  for (const [fam, m] of p) if (!n.has(fam)) removed.push(m);
  return { replaced, added, removed, changed: replaced.length + added.length + removed.length > 0 };
}

/**
 * Claude Code's initialize response lists aliases with the model each one
 * resolves to — that is the always-current list we read for free.
 */
export function fromClaudeCodeModels(list = []) {
  return list
    .filter((m) => m && m.value !== "default" && m.resolvedModel)
    .map((m) => ({
      id: m.resolvedModel,
      alias: m.value,
      description: m.description || "",
      effortLevels: m.supportedEffortLevels || null,
      needsCredits: /usage credits/i.test(m.description || ""),
    }));
}

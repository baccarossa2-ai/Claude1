/**
 * The pure half of `cloudy import` — argument parsing and the printed plan.
 *
 * Kept apart from import.js on purpose: import.js boots the app-server (which is
 * TypeScript, so it only loads once bundled), while this file is plain ESM with
 * no imports at all. That is what lets the CLI's tests assert the exact wording
 * and the flag handling without spawning a process.
 */

export const IMPORT_USAGE = `usage: cloudy import [--apply] [--path DIR] [--json]

Reads the skills and MCP servers Claude Code, Cursor and VS Code keep on this
machine and offers to bring them into a Cloudy project. Without --apply nothing
is written.`;

export const SOURCE_LABEL = { claude: "Claude Code", cursor: "Cursor", vscode: "VS Code" };

/** Parse the import command's flags. Throws with a message the caller prints. */
export function parseImportArgs(argv = []) {
  const opts = { apply: false, json: false, path: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") opts.apply = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--path") {
      opts.path = argv[++i] ?? null;
      if (!opts.path) throw new Error("--path needs a folder");
    } else if (arg.startsWith("--path=")) opts.path = arg.slice("--path=".length);
    else throw new Error(`unknown option: ${arg}`);
  }
  return opts;
}

/**
 * The human-readable plan, one string per line.
 *
 * A preview must never read like an action: with `apply` false the closing line
 * says what `--apply` would do, and "nothing to import" is stated plainly rather
 * than left as an empty list.
 */
export function formatPlan(result, { applied } = { applied: false }) {
  const lines = [];
  const plan = result?.plan ?? { skills: [], servers: [], skipped: [], found: [] };
  const looked = (plan.found ?? []).map((f) => SOURCE_LABEL[f] ?? f);

  lines.push(
    looked.length
      ? `looked at ${looked.join(", ")}`
      : "nothing found — no Claude Code, Cursor or VS Code settings on this machine"
  );

  if (plan.skills?.length) {
    lines.push("", `skills (${plan.skills.length}):`);
    for (const s of plan.skills) {
      lines.push(`  ${s.name}${s.description ? ` — ${s.description}` : ""}  [${SOURCE_LABEL[s.source] ?? s.source}]`);
    }
  }

  if (plan.servers?.length) {
    lines.push("", `plugin servers (${plan.servers.length}):`);
    for (const s of plan.servers) {
      lines.push(`  ${s.name}: ${s.command} ${(s.args ?? []).join(" ")}  [${SOURCE_LABEL[s.source] ?? s.source}]`);
    }
  }

  if (plan.skipped?.length) {
    lines.push("", `left behind (${plan.skipped.length}):`);
    for (const s of plan.skipped) {
      lines.push(`  ${s.name} — ${s.reason}`);
    }
  }

  const total = (plan.skills?.length ?? 0) + (plan.servers?.length ?? 0);
  lines.push("");
  if (applied) {
    lines.push(`imported ${result?.skills?.length ?? 0} skill(s) and ${result?.serversAdded?.length ?? 0} server(s).`);
    if (result?.errors?.length) {
      lines.push("could not write:");
      for (const e of result.errors) lines.push(`  ${e.name}: ${e.error}`);
    }
  } else if (total === 0) {
    lines.push("nothing to import — there is nothing you already have that Cloudy can take over.");
  } else {
    lines.push(`run \`cloudy import --apply\` to import ${total} item(s).`);
  }

  return lines;
}

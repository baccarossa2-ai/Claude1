/**
 * `cloudy import` — bring skills and plugin servers over from another agent.
 *
 * This is a host command, not a chat command: reading `~/.claude/skills`,
 * `~/.claude.json`, `~/.cursor/mcp.json` and VS Code's `mcp.json` needs the
 * filesystem and the workspace, and the thing that owns both is the app-server.
 * So it boots exactly the server `cloudy serve --stdio` boots (same bootstrap,
 * same workspace rules, same MCP config file) and calls `agents.import` on it —
 * one implementation, three surfaces.
 *
 * Default is a DRY RUN: it prints what would be imported and what is being left
 * behind, and writes nothing. `--apply` performs it.
 *
 *   cloudy import                 preview for the current folder
 *   cloudy import --apply         write the skills and register the servers
 *   cloudy import --path ~/repo   preview for another folder
 *   cloudy import --json          machine-readable result (for editors/scripts)
 */

import path from "node:path";
import { createAppServer, shutdownWorkspaceState } from "cloudy-core/app-server/bootstrap";
import { cliConfigDir, fileTokenStore, loadConfig } from "./client.js";
import { IMPORT_USAGE, formatPlan, parseImportArgs } from "./import-plan.js";

/** Boot the host, call agents.import, print, and exit cleanly. */
export async function run(argv = []) {
  let opts;
  try {
    opts = parseImportArgs(argv);
  } catch (e) {
    process.stderr.write(`${e.message}\n\n${IMPORT_USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  if (opts.help) {
    process.stdout.write(IMPORT_USAGE + "\n");
    return;
  }

  const server = createAppServer({
    baseUrl: process.env.CLOUDY_API_URL || loadConfig().base,
    tokens: fileTokenStore(),
    settingsFile: path.join(cliConfigDir(), "settings.json"),
    // stdout carries the report; nothing subscribes to notifications here.
    notify: () => {},
    deviceName: "Cloudy CLI",
  });

  const call = async (method, params) => {
    const res = await server.handle({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) });
    if (res?.error) throw new Error(res.error.message);
    return res?.result;
  };

  try {
    // The folder to import into: the one asked for, else where the user is.
    const opened = await call("workspace.open", opts.path ? { root: path.resolve(opts.path) } : {});
    if (!opened?.open) {
      process.stderr.write("cloudy import: could not open a workspace to import into.\n");
      process.exitCode = 1;
      return;
    }

    const result = await call("agents.import", opts.apply ? { apply: true } : {});
    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      const heading = `Cloudy import — ${opened.root}\n\n`;
      process.stdout.write(heading + formatPlan(result, { applied: opts.apply }).join("\n") + "\n");
    }
  } finally {
    // Plugin processes a preview may have spawned must not outlive the command.
    shutdownWorkspaceState();
  }
}

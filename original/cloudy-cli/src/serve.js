/**
 * Cloudy stdio host — the backend behind `cloudy serve --stdio`.
 *
 * It is not a second implementation of anything: it boots the same app-server
 * the desktop app runs (`cloudy-core`, the shared workspace package) and speaks
 * cloudy.rpc/1 as newline-delimited JSON-RPC over stdin/stdout, so any editor
 * or agent that spawns it gets identical tools, confinement, approvals and
 * quota behaviour. Credentials come from this CLI's own config file, so one
 * `cloudy login` serves the TUI AND every host that spawns this — no second
 * auth path, no copied model list (chat.models proxies the server registry).
 *
 * Source is ESM so it is readable next to the rest of the CLI; `npm run build`
 * bundles it (with the app-server) to dist/serve.cjs, which is what plain node
 * executes — see bin/cloudy.mjs.
 */

import path from "node:path";
import readline from "node:readline";
import { createAppServer, shutdownWorkspaceState } from "cloudy-core/app-server/bootstrap";
import { cliConfigDir, fileTokenStore, loadConfig } from "./client.js";

const USAGE = "usage: cloudy serve --stdio";

/** Boot the host on stdio and stay up until the client closes the pipe. */
export async function run(argv = []) {
  if (!argv.includes("--stdio")) {
    process.stderr.write(USAGE + "\n");
    process.exitCode = 2;
    return;
  }

  // stdout carries protocol frames only; diagnostics go to stderr, which the
  // spawner wires into its output channel.
  const write = (frame) => {
    if (process.stdout.writable) process.stdout.write(JSON.stringify(frame) + "\n");
  };

  const server = createAppServer({
    // An explicit URL from the spawner wins; otherwise the server this CLI is
    // signed in to, so the stored token and the endpoint always travel as a pair.
    baseUrl: process.env.CLOUDY_API_URL || loadConfig().base,
    tokens: fileTokenStore(),
    settingsFile: path.join(cliConfigDir(), "settings.json"),
    notify: write,
    deviceName: "Cloudy for VS Code",
  });

  // Chat and agent turns reply immediately and finish by notification, so
  // serializing handlers keeps every frame on the wire in request order.
  let queue = Promise.resolve();
  const input = readline.createInterface({ input: process.stdin, terminal: false });
  input.on("line", (line) => {
    const text = line.trim();
    if (!text) return;
    queue = queue.then(async () => {
      const response = await server.handle(text);
      if (response) write(response);
    });
  });

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    // Kill workspace-scoped children (MCP plugins, terminal, preview) so a
    // closed editor window leaves nothing behind.
    shutdownWorkspaceState();
    process.exit(0);
  };
  input.on("close", stop);
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  process.on("unhandledRejection", (err) => {
    process.stderr.write(`cloudy serve: ${(err && err.stack) || err}\n`);
  });
}

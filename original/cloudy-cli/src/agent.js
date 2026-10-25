/**
 * The CLI's agent — the spawned app-server, driven over stdio.
 *
 * `cloudy serve --stdio` already boots the same app-server the desktop app and
 * the VS Code panel drive, so the TUI does not reimplement a tool loop: it
 * spawns that host and speaks cloudy.rpc/1 to it, exactly as the editor does.
 * Identical tools, the same workspace confinement, the same approval gate, and
 * the same one-credit-per-turn rule — a turn taken here is a turn taken there.
 *
 * Two consequences worth knowing at this layer:
 *
 *   - Plan mode is enforced by the SERVER (it withholds every tool that can
 *     write or execute), so "plan" here is a request, not a promise the client
 *     keeps. Nothing in this file decides what the agent may do.
 *   - The child is started lazily and closed on exit. A session that never
 *     sends a turn never pays for a process.
 *
 * Wire shape: newline-delimited JSON-RPC 2.0 on the child's stdout, requests on
 * its stdin. `chat.event` notifications carry their sendId, and events are only
 * routed to a turn that registered for that id BEFORE its request went out —
 * the host starts the turn as soon as it parses the frame, so a turn that
 * registered after the fact would lose its first deltas.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI_BIN = fileURLToPath(new URL("../bin/cloudy.mjs", import.meta.url));

/** How long a host gets to shut down cleanly before it is killed. */
const CLOSE_GRACE_MS = 2000;

/**
 * A client of one spawned host.
 *
 * `cfg.base` is handed to the child as CLOUDY_API_URL, so the host talks to the
 * server this CLI is signed in to rather than to whatever it would default to.
 * `spawnChild` exists so tests can drive the framing without a real process.
 */
export function createAgentClient(cfg, { spawnChild = spawn } = {}) {
  let child = null;
  let buffer = "";
  let nextId = 0;
  let closing = false;
  /** id → { resolve, reject } for requests still waiting on a response. */
  const waiting = new Map();
  /** sendId → { onEvent, finish } for turns still streaming. */
  const turns = new Map();
  /** The tail of the host's stderr, used to explain an early exit. */
  let diagnostics = "";

  const hostIsGone = () => child === null || child.exitCode !== null || child.signalCode !== null;

  /**
   * Why the host is not answering. The entry point prints its own reason ("the
   * stdio host is not built — run `npm run build` in cli/") to stderr and exits,
   * so what it said is more useful than anything this file could invent.
   */
  const goneReason = () =>
    diagnostics.trim() || "the agent host exited before answering — try again";

  const settle = (id, ok, value) => {
    const entry = waiting.get(id);
    if (!entry) return;
    waiting.delete(id);
    if (ok) entry.resolve(value);
    else entry.reject(new Error(value));
  };

  const finishTurn = (sendId, resolve) => {
    const turn = turns.get(sendId);
    if (!turn) return;
    turns.delete(sendId);
    turn.finish();
  };

  const onFrame = (frame) => {
    // A response to something we asked: `error` is the host refusing.
    if (frame.id !== undefined && (frame.result !== undefined || frame.error !== undefined)) {
      settle(frame.id, !frame.error, frame.error ? frame.error.message || "the host refused the request" : frame.result);
      return;
    }
    if (frame.method !== "chat.event") return;
    const { sendId, event } = frame.params ?? {};
    const turn = sendId ? turns.get(sendId) : null;
    if (!turn || !event) return;
    turn.onEvent(event);
    // The turn is over when the host says so — the request itself resolved long
    // before, because a run is fire-and-forget on the wire.
    if (event.type === "done" || event.type === "error") finishTurn(sendId);
  };

  const consume = (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        continue; // a partial line is not a frame; the next chunk completes it
      }
      onFrame(frame);
    }
  };

  const start = () => {
    if (child && !hostIsGone()) return child;
    child = spawnChild(process.execPath, [CLI_BIN, "serve", "--stdio"], {
      env: { ...process.env, CLOUDY_API_URL: cfg.base },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", consume);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d) => {
      diagnostics = (diagnostics + d).slice(-2000);
    });
    child.on("exit", () => {
      // The host is gone: nothing that was waiting can ever be answered, and
      // pretending otherwise would hang the TUI until the user pressed ctrl+c.
      buffer = "";
      const reason = goneReason();
      for (const id of [...waiting.keys()]) settle(id, false, reason);
      for (const sendId of [...turns.keys()]) {
        const turn = turns.get(sendId);
        turns.delete(sendId);
        turn.onEvent({ type: "error", error: reason });
        turn.finish();
      }
    });
    child.on("error", (err) => {
      diagnostics = String(err?.message ?? err);
      for (const id of [...waiting.keys()]) settle(id, false, diagnostics);
    });
    return child;
  };

  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const host = start();
      if (hostIsGone()) return reject(new Error(goneReason()));
      const id = ++nextId;
      waiting.set(id, { resolve, reject });
      try {
        host.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`
        );
      } catch (err) {
        settle(id, false, String(err?.message ?? err));
      }
    });

  return {
    /** Whether a host process has been started (and is still alive). */
    get started() {
      return child !== null && !hostIsGone();
    },

    /**
     * Adopt the folder the agent is confined to. `root` is passed explicitly by
     * the CLI — the directory you launched in is the one you chose, which is
     * what every coding agent does — and an explicit root skips the host's
     * "is this a sensible guess?" guard, which exists for hosts that guess.
     */
    openWorkspace(root) {
      return request("workspace.open", root ? { root } : {});
    },

    /**
     * Run one agent turn. Resolves when the turn ENDS (its `done` or `error`
     * event), not when the request is acknowledged, so a caller can simply
     * await it; `onEvent` receives every streamed event in order.
     *
     * `params.sendId` is the caller's session id and must be set: it is the key
     * events are routed by, and the server's one-hour session budget is counted
     * against it.
     */
    respond(params, onEvent) {
      const sendId = params?.sendId;
      if (typeof sendId !== "string" || !sendId) {
        return Promise.reject(new Error("agent turns need a sendId"));
      }
      // Registered before the request goes out: the host can emit the first
      // delta before its own response frame reaches us.
      const ended = new Promise((resolve) => turns.set(sendId, { onEvent, finish: resolve }));
      return request("agent.respond", params)
        .then(() => ended)
        .catch((err) => {
          turns.delete(sendId);
          throw err;
        });
    },

    /** Answer a pending approval; the host resumes or declines the tool. */
    approve(approvalId, approve) {
      return request("agent.approve", { approvalId, approve });
    },

    /**
     * The workspace skills the agent can be told about: every
     * `.cloudy/skills/*.md` the host found, as `{ skills: [{ name, description }] }`.
     * Read straight from the host so the list is the one the model is offered —
     * a second implementation here could name skills that do not load.
     */
    listSkills() {
      return request("skills.list");
    },

    /** One skill's full body. `{ name, description, content }`. */
    readSkill(name) {
      return request("skills.read", { name });
    },

    /**
     * The MCP servers this workspace can use, with their live state:
     * `{ servers: [{ name, config, running, error?, tools }] }`. Listing them is
     * also what connects them, which is why this answers with `running` rather
     * than just a config file echo.
     */
    listMcpServers() {
      return request("mcp.list");
    },

    /** Stop one session's run (its pending approvals resolve as denied). */
    abort(sendId) {
      return request("chat.abort", sendId ? { sendId } : {});
    },

    /** Close the host. Ending stdin is the protocol's own shutdown signal. */
    close() {
      closing = true;
      if (!child || hostIsGone()) return;
      const host = child;
      try {
        host.stdin.end();
      } catch {
        /* already closed */
      }
      const timer = setTimeout(() => {
        if (!hostIsGone()) host.kill("SIGTERM");
      }, CLOSE_GRACE_MS);
      timer.unref?.();
      host.once("exit", () => clearTimeout(timer));
    },

    /** True once close() was called — a later respond() would need a new client. */
    get closing() {
      return closing;
    },
  };
}

/**
 * The one line a tool call gets in the transcript: what it is doing, to what.
 * Kept here rather than in the renderer so the label and the event shape stay
 * together — the server's tool args are the only source of this text.
 */
export function toolLabel(call) {
  const args = call?.args ?? {};
  const target =
    args.command ??
    args.path ??
    args.pattern ??
    args.query ??
    args.name ??
    (Array.isArray(args.paths) ? args.paths.join(" ") : "");
  return [call?.name ?? "tool", String(target ?? "")].filter(Boolean).join(" ");
}

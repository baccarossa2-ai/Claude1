/**
 * cloudy CLI main — commands and the REPL.
 *
 * `cloudy` alone opens the chat loop; `cloudy login|models|usage|whoami|ask`
 * are one-shot commands. The REPL keeps conversation history in memory
 * (like the web app's thread) until /new. All quota and auth errors surface
 * the server's own copy — the CLI never rewords a wall.
 */

import { spawn } from "node:child_process";
import readline from "node:readline";
import { C, renderMarkdown, spinner } from "./ui.js";
import { runTui } from "./tui.js";
import { PACKAGE, autoUpdate, currentVersion, updateNotice } from "./update.js";
import {
  ChatAPIError,
  fetchModels,
  fetchProviders,
  fetchUsage,
  loadConfig,
  loginPairing,
  loginPassword,
  orderedProviders,
  providerName,
  saveConfig,
  streamChat,
} from "./client.js";

const HELP = `${C.bold}cloudy${C.reset} — chat with Cloudy from your terminal

${C.bold}usage${C.reset}
  cloudy                     start the chat loop
  cloudy ask "prompt"        one question, print the answer, exit
  cloudy login [provider]    sign in (provider, browser pairing or email)
  cloudy models              list models
  cloudy usage               show your quota
  cloudy whoami              show the signed-in account
  cloudy import [--apply]    bring skills + plugin servers over from Claude Code,
                             Cursor or VS Code (previews first; --apply writes)
  cloudy serve --stdio       run the app-server host editors spawn

${C.bold}chat commands${C.reset} (also in-app under /help)
  /login                     sign in or switch accounts
  /model [name]              pick a model (no name: open the picker)
  /skills                    what this workspace teaches the agent
  /mcps                      plugin servers, and whether they are running
  /sponsor [on|off]          hide the sponsor card for this session
  /usage                     show your quota
  /whoami                    show the signed-in account
  /new                       start a fresh conversation

${C.bold}chat keys${C.reset}
  ↑ ↓ recall what you have sent · ctrl+o model · ctrl+t usage · ctrl+w account
  ctrl+n new · ctrl+l login · ctrl+u clear input · ctrl+c twice to quit
  click the sponsor card to open it (enter sends — it does not open ads)

${C.bold}updates${C.reset}
  An installed copy checks npm once a day and updates itself in place; the new
  version runs on the next launch. A source checkout is never touched. Set
  CLOUDY_NO_UPDATE=1 to turn it off.`;

/**
 * Hand a URL to the desktop's browser.
 *
 * argv, never a shell string: the URL is a pairing link minted by the server
 * or an advertiser's creative `link`, and `$(…)`/backticks inside a quoted
 * shell string still run — JSON.stringify escapes for JSON, not for the shell.
 */
function openBrowser(url) {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer.exe"
        : "xdg-open";
  try {
    spawn(cmd, [url], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } catch {
    /* no opener on this machine — the URL is printed either way */
  }
}

let modelsCache = null;
async function models(cfg) {
  if (!modelsCache) modelsCache = await fetchModels(cfg);
  return modelsCache;
}

/**
 * `cloudy usage` output, one string per line. Pure so it can be tested (and
 * so the two currencies always read the same way in every surface).
 */
export function usageLines(u) {
  if (!u) return ["no usage data (are you signed in?)"];
  if (u.trial) {
    return [`trial: ${u.trial.remaining} of ${u.trial.limit} messages left today`];
  }
  const m = u.messages?.daily;
  const w = u.messages?.weekly;
  const c = u.credits?.daily;
  const cw = u.credits?.weekly;
  if (!m || !c) return ["no usage data (are you signed in?)"];
  return [
    `messages — today: ${m.used}/${m.limit} · this week: ${w?.used ?? 0}/${w?.limit ?? 0}`,
    `agent credits — today: ${c.used}/${c.limit} · this week: ${cw?.used ?? 0}/${cw?.limit ?? 0} (one per agent turn)`,
  ];
}

async function printUsage(cfg) {
  const lines = usageLines(await fetchUsage(cfg));
  for (const line of lines) console.log(`${C.dim}${line}${C.reset}`);
}

async function whoami(cfg) {
  if (!cfg.token) {
    console.log("not signed in — run /login or `cloudy login`");
    return;
  }
  console.log(`${cfg.user?.email ?? "signed in"} — free plan`);
}

// ---------------------------------------------------------------
// One conversation turn — used by `cloudy ask`
// ---------------------------------------------------------------

async function runTurn(cfg, messages, onDelta) {
  if (!cfg.token) throw new ChatAPIError("not signed in — run `cloudy login` first", 401);
  const spin = spinner("thinking");
  try {
    return await streamChat(cfg, cfg.model, messages, onDelta);
  } finally {
    spin.stop();
  }
}

// ---------------------------------------------------------------
// Auth flows
// ---------------------------------------------------------------

/**
 * Match what someone typed against the providers this server offers, by id or
 * by display name ("google", "Google"). Null for anything else: a name this
 * deployment has no credentials for is refused rather than opening a page that
 * cannot complete.
 */
export function providerFor(typed, offered) {
  const want = String(typed ?? "").trim().toLowerCase();
  if (!want) return null;
  return (
    orderedProviders(offered).find(
      (id) => id.toLowerCase() === want || providerName(id).toLowerCase() === want
    ) ?? null
  );
}

async function doLogin(cfg, rl, requested) {
  // `cloudy login google` names the provider outright; interactive use lists
  // whatever the server offers, so a provider configured later works here too.
  const offered = await fetchProviders(cfg);
  let answer = requested ?? null;
  if (!answer && rl) {
    const hint = offered.length ? `, or one of ${offered.join(", ")}` : "";
    answer = await new Promise((resolve) =>
      rl.question(`Sign in with [b]rowser or [e]mail${hint}? `, resolve)
    );
  }
  const typed = String(answer ?? "").trim().toLowerCase();

  if (typed === "e" || typed === "email") {
    await doEmailLogin(cfg, rl);
    return;
  }

  const provider = providerFor(typed, offered);
  if (typed && !provider && typed !== "b" && typed !== "browser") {
    console.log(`${C.dim}no provider called "${typed}" here — using browser pairing${C.reset}`);
  }

  try {
    const result = await loginPairing(
      cfg,
      (url, code) => {
        console.log(`\nOpen this link to approve this device:\n\n  ${C.bold}${url}${C.reset}\n`);
        console.log(`Your code: ${C.bold}${code}${C.reset} — waiting for approval…`);
        if (process.stdout.isTTY) openBrowser(url);
      },
      provider
    );
    saveConfig({ token: result.token, user: result.user });
    cfg.token = result.token;
    cfg.user = result.user;
    console.log(`\nSigned in as ${C.bold}${result.user?.email ?? "?"}${C.reset}\n`);
  } catch (err) {
    console.log(`\n${C.dim}login failed: ${err?.message ?? err}${C.reset}\n`);
  }
  if (rl) rl.prompt();
}

async function doEmailLogin(cfg, rl) {
  try {
    const ask = (q) =>
      rl
        ? new Promise((r) => rl.question(q, r))
        : new Promise((r) => {
            const iface = readline.createInterface({ input: process.stdin, output: process.stdout });
            iface.question(q, (a) => {
              iface.close();
              r(a);
            });
          });
    const email = (await ask("Email: ")).trim();
    const password = await ask("Password: ");
    const result = await loginPassword(cfg, email, password);
    saveConfig({ token: result.token, user: result.user });
    cfg.token = result.token;
    cfg.user = result.user;
    console.log(`\nSigned in as ${C.bold}${result.user?.email ?? "?"}${C.reset}\n`);
  } catch (err) {
    console.log(`\n${C.dim}login failed: ${err?.message ?? err}${C.reset}\n`);
  }
  if (rl) rl.prompt();
}

// ---------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------

export async function main(argv) {
  const cfg = loadConfig();
  const cmd = argv[0];

  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    return;
  }
  if (cmd === "version" || cmd === "--version") {
    // Read from the package's own manifest rather than a literal here: a
    // hardcoded version is one npm publish away from being a lie.
    console.log(`${PACKAGE} ${currentVersion() ?? "unknown"}`);
    return;
  }

  // Keep an installed copy current, before the command prints anything of its
  // own. Every rule about whether this may happen (installed copy vs checkout,
  // interactive vs script, opt-out, once a day) lives in src/update.js; this is
  // only where it is called and how the outcome is reported.
  try {
    const result = await autoUpdate({ current: currentVersion(), lastCheck: cfg.updateCheck });
    const notice = updateNotice(result);
    if (notice) console.log(`${C.dim}${notice}${C.reset}`);
    // Only stamp a check that actually reached the registry: a skip for any
    // other reason should not silence tomorrow's attempt, and an unreachable
    // registry should be retried rather than waited out.
    if (result.action !== "skip") saveConfig({ updateCheck: Date.now() });
  } catch {
    // An updater is never allowed to be the reason a command fails.
  }

  if (cmd === "login") {
    await doLogin(cfg, null, argv[1]);
    return;
  }
  if (cmd === "whoami") {
    await whoami(cfg);
    return;
  }
  if (cmd === "models") {
    const list = await models(cfg);
    for (const m of list) console.log(`${m.id.padEnd(28)} ${C.dim}${m.name}${C.reset}`);
    return;
  }
  if (cmd === "usage") {
    await printUsage(cfg);
    return;
  }
  if (cmd === "ask") {
    const prompt = argv.slice(1).join(" ").trim();
    if (!prompt) {
      console.log('usage: cloudy ask "your question"');
      process.exitCode = 2;
      return;
    }
    const { text } = await runTurn(cfg, [{ role: "user", content: prompt }], () => {});
    console.log(renderMarkdown(text));
    return;
  }

  if (cmd && cmd !== "chat") {
    console.log(`unknown command "${cmd}"\n\n` + HELP);
    process.exitCode = 2;
    return;
  }

  // ------------------ the full-screen chat TUI ------------------
  // Resolve the default model up front so the status bar is right on launch;
  // inside the TUI the model picker owns changes.
  try {
    const list = await models(cfg);
    if (!cfg.model || !list.some((m) => m.id === cfg.model)) {
      cfg.model = list[0]?.id ?? cfg.model;
    }
  } catch {
    // Offline — the TUI shows "no models" in the picker.
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("cloudy needs an interactive terminal — run it directly, without piping input.");
    process.exitCode = 1;
    return;
  }

  await runTui(cfg);
}

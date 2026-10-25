/**
 * Keeping `cloudy` current.
 *
 * The desktop app updates itself and the web app is whatever the server is, so
 * the CLI is the one surface that can silently fall a year behind: a global npm
 * install has no updater and no UI saying "there is a newer version". This is
 * that updater, and it follows the rules the rest of the CLI does — never block
 * startup, never touch anything it did not install, and say what happened.
 *
 * The shape: at launch, at most once a day, ask the registry what the newest
 * version is. If it is newer and this is an INSTALLED copy (a global npm
 * install, not a git checkout or an `npm link`), install it and say so. The new
 * version is what runs next launch — replacing the files of a running program
 * under it is how you get a half-updated process.
 *
 * What it deliberately will not do:
 *
 *   - It never updates a source checkout. `node cli/bin/cloudy.mjs` in the repo
 *     is someone's working tree, and `npm install -g` there would either fail
 *     or, worse, install a stale registry copy over the thing they are editing.
 *   - It never runs in a script. `cloudy ask "…" | jq` should not quietly
 *     install packages; a non-TTY run is not a person waiting for a prompt.
 *   - It never escalates. If the global prefix is not writable without sudo,
 *     the honest answer is a command to paste, not a privileged install.
 *   - It never fails loudly. A registry that is down, a proxy that eats the
 *     request, npm missing: the user gets their CLI, and the check is retried
 *     tomorrow.
 *
 * Every decision below is a pure function so the rules can be tested without a
 * network or an npm (tests/update.test.js); `autoUpdate` is only the wiring.
 */

import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE = "cloudy-cli";
export const REGISTRY = "https://registry.npmjs.org";

/** How long between registry checks. Once a day is plenty for a release cadence
 *  measured in days, and it keeps a launch offline-tolerant. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** The registry is a courtesy call on the way to the chat; do not wait long. */
const LOOKUP_TIMEOUT_MS = 2_500;
/** npm itself can be slow (it resolves a tree). Killing it is better than
 *  holding a terminal hostage — the next launch retries tomorrow. */
const INSTALL_TIMEOUT_MS = 45_000;

/** This package's own directory, i.e. the root of the installed package. */
export function packageRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * The version this process is running. Read from the package's own manifest so
 * there is one number, not a constant that drifts from package.json.
 */
export function currentVersion(root = packageRoot()) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

/**
 * `1.2.3` → [1, 2, 3]. A pre-release (`1.2.3-beta.1`) keeps its numbers and
 * ignores the suffix, and anything unparseable is null — which every caller
 * treats as "cannot compare", never as "older".
 */
export function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? "").trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `candidate` is a strictly newer release than `current`. */
export function isNewer(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

/** True when this copy lives inside a node_modules tree, i.e. npm put it here. */
export function isInstalledCopy(root = packageRoot()) {
  return root.split(path.sep).includes("node_modules");
}

/** True when a check is due. A missing or unreadable stamp means "due". */
export function checkDue(lastCheck, now = Date.now(), intervalMs = CHECK_INTERVAL_MS) {
  const at = Number(lastCheck);
  if (!Number.isFinite(at) || at <= 0) return true;
  // A stamp in the future (a clock that moved, a shared config) would otherwise
  // silence updates forever.
  if (at > now) return true;
  return now - at >= intervalMs;
}

/**
 * Why this launch should not check the registry at all, or null to go ahead.
 * Ordered so the cheapest and most decisive reason wins.
 */
export function skipCheckReason({ env = process.env, tty = false, installedCopy = isInstalledCopy() } = {}) {
  const off = String(env.CLOUDY_NO_UPDATE ?? "").trim().toLowerCase();
  if (off && off !== "0" && off !== "false") return "CLOUDY_NO_UPDATE is set";
  if (env.CI) return "running in CI";
  if (!tty) return "not an interactive terminal";
  if (!installedCopy) return "running from a checkout — update it with git, not npm";
  return null;
}

/** The npm argv that installs one version globally. */
export function installArgs(version) {
  return ["install", "-g", `${PACKAGE}@${version}`];
}

/** What to do about `latest`, and why. Pure — the whole policy in one place. */
export function planUpdate({
  current,
  latest,
  lastCheck,
  now = Date.now(),
  env = process.env,
  tty = false,
  installedCopy = isInstalledCopy(),
}) {
  const skip = skipCheckReason({ env, tty, installedCopy });
  if (skip) return { action: "skip", reason: skip };
  if (!checkDue(lastCheck, now)) return { action: "skip", reason: "checked recently" };
  if (!latest) return { action: "skip", reason: "could not reach the registry" };
  if (!isNewer(latest, current)) return { action: "current", reason: `already on ${current}` };
  return { action: "install", reason: `${current} → ${latest}`, version: latest };
}

/**
 * The newest published version, or null. Never throws: a registry that is
 * unreachable is a normal state for a machine on a plane.
 */
export async function fetchLatest({ fetchImpl = fetch, timeoutMs = LOOKUP_TIMEOUT_MS, registry = REGISTRY } = {}) {
  try {
    const res = await fetchImpl(`${registry}/${PACKAGE}/latest`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return parseVersion(body?.version) ? String(body.version) : null;
  } catch {
    return null;
  }
}

/** True when npm can write to its global prefix without privilege escalation. */
export function globalPrefixWritable({ env = process.env } = {}) {
  try {
    const prefix = execFileSync("npm", ["prefix", "-g"], {
      encoding: "utf8",
      timeout: 10_000,
      env,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!prefix) return false;
    fs.accessSync(prefix, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check, and install if a newer version exists. Returns what happened so the
 * caller can print one line — this function never prints.
 *
 * `run` is injected so a test can assert the command instead of running npm.
 */
export async function autoUpdate({
  current,
  lastCheck,
  now = Date.now(),
  env = process.env,
  tty = process.stdout.isTTY === true,
  fetchImpl = fetch,
  run = (args) =>
    new Promise((resolve, reject) => {
      execFile("npm", args, { timeout: INSTALL_TIMEOUT_MS }, (err) => (err ? reject(err) : resolve()));
    }),
  writable = () => globalPrefixWritable({ env }),
  installedCopy = isInstalledCopy(),
} = {}) {
  const version = current ?? currentVersion();
  // Screen before the lookup, with the same helpers the policy uses, so an
  // opt-out or a checkout never reaches the network at all. `planUpdate` below
  // re-checks them; it is a pure function, so asking twice costs nothing and
  // keeps the policy in exactly one place.
  const gate = skipCheckReason({ env, tty, installedCopy });
  if (gate) return { action: "skip", reason: gate };
  if (!checkDue(lastCheck, now)) return { action: "skip", reason: "checked recently" };

  const latest = await fetchLatest({ fetchImpl });
  const plan = planUpdate({ current: version, latest, lastCheck, now, env, tty, installedCopy });
  if (plan.action !== "install") return plan;
  const target = plan.version;

  // A prefix owned by another user (a system node, a Homebrew npm) needs sudo,
  // and an updater that asks for a password is not an updater.
  if (!writable()) {
    return {
      action: "manual",
      reason: "the npm global prefix is not writable here",
      version: target,
      command: `npm ${installArgs(target).join(" ")}`,
    };
  }

  try {
    await run(installArgs(target));
    return { action: "installed", from: version, version: target };
  } catch (e) {
    return {
      action: "failed",
      reason: String(e?.message ?? e).split("\n")[0],
      version: target,
      command: `npm ${installArgs(target).join(" ")}`,
    };
  }
}

/** The one line a launch may print about all of this. `null` = say nothing. */
export function updateNotice(result) {
  if (!result) return null;
  if (result.action === "installed") {
    return `updated to ${PACKAGE} ${result.version} — the new version runs next launch`;
  }
  if (result.action === "manual" || result.action === "failed") {
    const why = result.action === "manual" ? result.reason : `update failed: ${result.reason}`;
    return `${PACKAGE} ${result.version} is available — ${why}. Run: ${result.command}`;
  }
  return null;
}

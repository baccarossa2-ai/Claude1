/**
 * cloudy TUI — a full-screen Ink app matching the opencode layout.
 *
 * Layout (top to bottom):
 *   ┌─────────────────────────────────────────────┐
 *   │            (transcript / splash)            │  flexGrow
 *   │                                             │
 *   ├─────────────────────────────────────────────┤
 *   │  ┌─────────────────────────────────────┐    │
 *   │  │ Ask anything...                     │    │  input box
 *   │  │                                     │    │
 *   │  └─────────────────────────────────────┘    │
 *   │  ● Build · GLM 5.3 Flash  medium       1.0.0│  status row
 *   │      / commands  ctrl+o model  ctrl+t usage │  key hints (pre-session)
 *   └─────────────────────────────────────────────┘
 */

import React, { useEffect, useRef, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import { TUI, MODEL_ACCENTS } from "./tokens.js";
import { emptyHistory, recordSent, recall } from "./history.js";
import {
  fetchAds,
  fetchModels,
  fetchProviders,
  fetchUsage,
  cliConfigDir,
  loginPairing,
  loginPassword,
  orderedProviders,
  providerName,
  saveConfig,
  ChatAPIError,
} from "./client.js";
import { createAgentClient, toolLabel } from "./agent.js";
import { execFile, spawn } from "node:child_process";
import { writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdown } from "./ui.js";
import { SESSION_BUDGET_MS } from "./session.js";
import { MOUSE_ENABLE, MOUSE_DISABLE, parseWheel, parseClicks, applyWheel, stripMouse, isMouseOnly } from "./mouse.js";


// Set the terminal's own background to true black (TUI.bg, theme/tokens.mjs)
// while the app is on screen, and restore whatever the terminal reported on
// exit. The root box fill paints the app's rows; this paints the canvas
// behind them (scrollback, side gutters) so the whole window is one black.
const BG_SET = `\x1b]11;${TUI.bg}\x07`;
// No OSC 11 query: the terminal's reply arrives on stdin where Ink's own
// reader types it into the composer ("]11;rgb:…"). Exit restores the canvas
// with OSC 111 (reset to the terminal's default) instead of the queried value.
const BG_RESET = "\x1b]111;\x07";

const h = React.createElement;

// Version — bumped manually with releases
const VERSION = "1.0.0";

/**
 * Reasoning effort the model may spend on a turn. The same four levels the web
 * and desktop pickers offer — the server owns what each one means, the client
 * only names the choice.
 */
const EFFORT_LEVELS = ["low", "medium", "high", "max"];

/**
 * How much authority a turn's agent has. These three ids mirror the protocol's
 * `AccessLevel` (core/src/shared/types.ts), which is what `agent.respond`
 * accepts and what the agent loop enforces — the CLI cannot import that module
 * (it is TypeScript, and the TUI runs from source), so it validates the id here
 * and lets the server be the thing that decides what the id means.
 */
const ACCESS_LEVELS = ["readonly", "ask", "full"];

// The same sentences the desktop's picker and the shared ACCESS_LEVELS table
// use, so all three surfaces describe a level the same way.
const ACCESS_HINTS = {
  readonly: "reads and searches — cannot change a file or run a command",
  ask: "reads freely, asks before every write and command",
  full: "reads, writes and runs commands without asking",
};

/**
 * Build and Plan. Short enough to survive the settings panel's 80-column row —
 * the folder the agent works in has a row of its own.
 */
const MODE_HINTS = {
  build: "edits files and runs commands",
  plan: "reads the project and proposes; nothing is edited",
};

// ---------------------------------------------------------------------------
// Static text
// ---------------------------------------------------------------------------

const COMMANDS = [
  ["help", "show help"],
  ["login", "sign in"],
  ["mode [build|plan]", "build edits, plan only reads (tab toggles)"],
  ["access [level]", "readonly|ask|full — what the agent may do without asking"],
  ["model [name]", "pick a model"],
  ["effort [level]", "reasoning effort: low|medium|high|max"],
  ["skills", "what this workspace teaches the agent"],
  ["mcps", "plugin servers, and whether they are running"],
  ["sponsor [on|off]", "hide the sponsor card for this session"],
  ["import [apply]", "bring skills/servers from Claude, Cursor or VS Code"],
  ["usage", "show quota"],
  ["settings", "account, model and server"],
  ["whoami", "account info"],
  ["new", "new conversation"],
  ["quit", "exit"],
];

function filterCommands(query) {
  const base = query.toLowerCase().trim().split(" ")[0];
  return COMMANDS.filter(([name]) => name.split(" ")[0].startsWith(base));
}

// The "cloudy" wordmark in opencode's pixel-block style: 7 rows, two-wide
// strokes, and glyphs that read unambiguously — an open C, an l that is a tall
// bar with a right-only foot (never an I: no top serif, no centred base), O /
// U / D distinct (D carries its ascender bars), and a Y whose tail descends
// from the joint.
export const WORDMARK = [
  "                                    ██        ",
  " █████    ██    █████  ██   ██      ██ ██   ██",
  "██   ██   ██   ██   ██ ██   ██  █████  ██   ██",
  "██        ██   ██   ██ ██   ██ ██   ██  █████ ",
  "██   ██   ██   ██   ██ ██   ██ ██   ██    ██  ",
  " █████    ██    █████   █████   █████    ██   ",
  "          ████                                ",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** One line describing both currencies; null when there is nothing to show. */
export function fmtUsage(u) {
  if (!u) return null;
  if (u.trial)
    return `trial: ${u.trial.remaining} of ${u.trial.limit} messages left today`;
  const m = u.messages?.daily;
  const w = u.messages?.weekly;
  const c = u.credits?.daily;
  const cw = u.credits?.weekly;
  if (!m || !c) return null;
  return (
    `messages ${m.used}/${m.limit} today · ${w?.used ?? 0}/${w?.limit ?? 0} this week` +
    `  ·  agent credits ${c.used}/${c.limit} today · ${cw?.used ?? 0}/${cw?.limit ?? 0} this week`
  );
}

/**
 * Truncate a single-line string to the terminal width.
 *
 * Ink wraps text that is wider than its box, and a wrapped line makes the
 * frame taller than the terminal — which is what corrupts the screen (the top
 * rows get scrolled away and Ink starts slicing text mid-string). Every piece
 * of single-line chrome is therefore fitted to the width it has.
 */
function fit(text, width) {
  const s = String(text ?? "");
  if (width <= 1) return "";
  return s.length <= width ? s : s.slice(0, width - 1) + "…";
}

/**
 * Keep a list of one-row items inside the rows actually available, reporting
 * how many were dropped so the caller can say so. Never let Ink clip instead:
 * clipping a taller-than-box frame is what mangles text.
 */
function trimRows(items, maxRows) {
  const list = items.filter(Boolean);
  if (maxRows <= 0) return { shown: [], hidden: list.length };
  if (list.length <= maxRows) return { shown: list, hidden: 0 };
  const notice = h(Text, { key: "__more", dimColor: true }, `  … ${list.length - maxRows + 1} more`);
  return { shown: [...list.slice(0, maxRows - 1), notice], hidden: list.length - maxRows + 1 };
}

/** Current terminal size, refreshed on resize. */
function terminalSize() {
  return { w: process.stdout.columns || 80, h: process.stdout.rows || 24 };
}

/**
 * Hand a URL to the desktop's browser.
 *
 * argv, never a shell string: the URL is a pairing link minted by the server
 * or an advertiser's creative `link` (see `openAd`), and `$(…)`/backticks
 * inside a quoted shell string still run — JSON.stringify escapes for JSON,
 * not for the shell.
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

// ---------------------------------------------------------------------------
// Splash — centered wordmark, stays until first message
// ---------------------------------------------------------------------------

function Splash() {
  return h(
    Box,
    {
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      flexGrow: 1,
    },
    h(Text, null, " "),
    ...WORDMARK.map((line, i) => h(Text, { key: i, dimColor: true }, line)),
    h(Text, null, " ")
  );
}

// ---------------------------------------------------------------------------
// Message list — the transcript
// ---------------------------------------------------------------------------

/**
 * Wrap one logical line into visual rows of at most `width` characters.
 *
 * The transcript wraps text itself instead of trusting the terminal: the row
 * count has to be exact, because the number of rows a message occupies is what
 * decides whether it fits. Ink wrapping it instead would make the frame taller
 * than the terminal, which is how the transcript used to overwrite the composer.
 */
function wrapLine(text, width) {
  const line = String(text ?? "");
  if (line.length <= width) return [line];
  const rows = [];
  let rest = line;
  while (rest.length > width) {
    let cut = rest.lastIndexOf(" ", width);
    if (cut <= 0) cut = width;
    rows.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, "");
  }
  rows.push(rest);
  return rows;
}

/** One glyph per tool state. The whole tool row is one line, by design. */
function toolMark(status) {
  if (status === "ok") return "✓";
  if (status === "error") return "✗";
  return "…";
}

function MessageList({ messages, thinking, size, budget, scroll = 0, maxScrollRef }) {
  // The budget is the rows the chrome leaves free — the parent owns that math,
  // so the transcript can never push the frame past the terminal.
  const width = Math.max(20, size.w - 6);

  // Flatten the conversation into rows, then show the tail that fits. A single
  // message taller than the viewport is trimmed rather than allowed through
  // whole — otherwise one long answer paints over the composer.
  const rows = [];
  for (const m of messages) {
    rows.push({ header: true, role: m.role, text: m.role === "user" ? "you ›" : "cloudy ›" });
    // An agent turn is a sequence of parts — narration, the tools it called,
    // the approval it stopped on — and they render in the order they happened,
    // so the transcript says what the agent actually did rather than only what
    // it finally said. A plain message (and the composer's own errors) carries
    // content and no parts.
    const parts = m.parts?.length ? m.parts : [{ kind: "text", text: m.content ?? "" }];
    for (const part of parts) {
      if (part.kind === "tool") {
        rows.push({ role: m.role, text: `  ${toolMark(part.status)} ${fit(part.label, width - 4)}` });
        continue;
      }
      if (part.kind === "approval") {
        rows.push({ role: m.role, text: `  ⚠ ${fit(`approve · ${part.command}`, width - 4)}` });
        rows.push({ role: m.role, text: `    ${part.resolved ?? "waiting — y runs it, n declines"}` });
        continue;
      }
      const body = m.role === "user" ? part.text : renderMarkdown(part.text);
      for (const line of body.split("\n")) {
        for (const piece of wrapLine(line, width)) {
          rows.push({ role: m.role, text: "  " + piece });
        }
      }
    }
    rows.push({ role: m.role, text: " " });
  }
  if (thinking) rows.push({ role: "assistant", text: "  ⠋ thinking…" });

  const overflow = rows.length > budget;
  const capacity = Math.max(1, overflow ? budget - 1 : budget);
  // `scroll` is rows from the bottom, driven by the mouse wheel (see mouse.js).
  // Zoomed to the newest line it behaves exactly as before; a non-zero offset
  // keeps the frame — and therefore the composer — perfectly still while the
  // transcript moves under it.
  const maxScroll = Math.max(0, rows.length - capacity);
  // The wheel handlers live in App, which does not build the rows; publishing
  // the limit here (the one place that knows it) keeps the clamping honest
  // instead of App guessing how tall the transcript is.
  if (maxScrollRef) maxScrollRef.current = maxScroll;
  const offset = Math.min(maxScroll, Math.max(0, scroll));
  const end = rows.length - offset;
  const start = Math.max(0, end - capacity);
  const shown = rows.slice(start, end);
  const hidden = start;
  const below = rows.length - end;

  return h(
    Box,
    {
      flexDirection: "column",
      flexGrow: 1,
      flexShrink: 1,
      minHeight: 0,
      paddingX: 1,
    },
    hidden > 0 &&
      h(
        Text,
        { dimColor: true },
        `  … ${hidden} earlier line${hidden === 1 ? "" : "s"} above`
      ),
    shown.map((row, i) =>
      h(
        Text,
        {
          key: i,
          bold: !!row.header,
          dimColor: !row.header && row.role === "assistant",
        },
        fit(row.text, size.w - 2)
      )
    ),
    // Saying how far below the fold the view is stops "the chat ended" and
    // "I scrolled up" from looking the same.
    offset > 0 &&
      h(
        Text,
        { dimColor: true },
        `  ↓ ${below} newer line${below === 1 ? "" : "s"} · wheel down to follow`
      )
  );
}

// ---------------------------------------------------------------------------
// Input box — opencode-style large bordered textarea
// ---------------------------------------------------------------------------

function InputBox({ value, placeholder, disabled, maxVisible = 5, size }) {
  const lines = value ? value.split("\n") : [];
  const hasContent = lines.length > 0;
  const displayLines = hasContent
    ? lines
    : [placeholder || "Ask anything..."];
  // Border (2) + paddingX (2) + the one-space lead-in on each line.
  const maxWidth = Math.max(8, size.w - 5);
  // Show up to `maxVisible` lines (the parent shrinks it on short terminals),
  // then a scroll indicator.
  const startIdx = Math.max(0, displayLines.length - maxVisible);
  const visibleLines = displayLines.slice(startIdx);
  const scrolled = startIdx > 0;

  return h(
    Box,
    {
      flexDirection: "column",
      borderStyle: "round",
      borderColor: TUI.border,
      paddingX: 1,
      marginTop: 1,
      flexShrink: 0,
    },
    ...visibleLines.map((line, i) =>
      h(
        Text,
        {
          key: i,
          dimColor: !hasContent || (scrolled && i === 0),
        },
        fit((scrolled && i === 0 ? "…" : " ") + (line || " "), maxWidth)
      )
    ),
  );
}

// ---------------------------------------------------------------------------
// Model indicator — below input box
// ---------------------------------------------------------------------------

function ModelIndicator({ mode, model, accent, effort, size, sessionLeft }) {
  const modelName = model || "no model";
  // The one status row: mode, model, effort, the session clock, and the
  // version. It replaces the old indicator + bottom bar pair.
  //
  // The mode is the one the NEXT turn will run as — the label and the request
  // it describes come from the same state, so it cannot advertise a mode the
  // agent is not actually in.
  const label = mode === "plan" ? "Plan" : "Build";
  const suffix = `  ${effort}`;
  const timer = sessionLeft !== null ? `  ·  session ${fmtClock(sessionLeft)}` : "";
  // Width the fixed parts claim: paddingX (2) + "● " (2) + the mode label +
  // " · " (3) + effort + timer + the right-aligned version (5) + a gap (1). The
  // name takes the rest and is truncated rather than allowed to wrap the row.
  const fixed = 2 + 2 + label.length + 3 + suffix.length + timer.length + 5 + 1;
  const name = fit(modelName, Math.max(6, size.w - fixed));
  return h(
    Box,
    { justifyContent: "space-between", paddingX: 1, flexShrink: 0 },      h(Box, { flexShrink: 0 },
      // The dot carries the model's own accent (theme/tokens.mjs → the `model`
      // group), the same colour the web app puts beside a model's name. It is
      // the one place colour on this row can say something: which model is
      // about to answer.
      h(Text, { color: accent }, "●"),
      h(Text, null, " "),
      h(Text, { bold: true }, label),
      h(Text, { dimColor: true }, " · "),
      h(Text, null, name),
      h(Text, { dimColor: true }, suffix),
      h(Text, { color: sessionLeft !== null && sessionLeft < 300_000 ? "red" : "gray" }, timer)
    ),
    h(Text, { dimColor: true }, VERSION)
  );
}

/** mm:ss left on the session budget (negative clamps to 0:00). */
function fmtClock(msLeft) {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Key hints — below model indicator
//
// Only keys the composer actually binds (see the input handler): commands open
// by typing "/", ctrl+o opens the model picker, ctrl+t the usage panel. A hint
// for a key that does nothing is a surface with nothing behind it, so this row
// is kept to what a user can press here.
// ---------------------------------------------------------------------------

function KeyHints({ size }) {
  return h(
    Box,
    { justifyContent: "flex-end", paddingX: 1, flexShrink: 0 },
    h(Text, { dimColor: true }, fit("/ commands  tab plan  ctrl+o model  ctrl+t usage", size.w - 2))
  );
}

// ---------------------------------------------------------------------------
// Approval bar — the agent is waiting on you
//
// Sits above the composer for as long as an approval is unanswered, so the
// question cannot scroll out of view behind a long transcript. The keys it
// names are the keys the input handler binds while it is showing.
// ---------------------------------------------------------------------------

function ApprovalBar({ pending, size }) {
  const keys = "  y run · n decline";
  const command = fit(`  ⚠ approve · ${pending.command}`, Math.max(8, size.w - keys.length - 2));
  return h(
    Box,
    { paddingX: 1, flexShrink: 0 },
    h(Text, { bold: true }, command),
    h(Text, { dimColor: true }, keys)
  );
}

// ---------------------------------------------------------------------------
// Ad banner
// ---------------------------------------------------------------------------

/**
 * The ad banner's height: two border rows plus the headline and body rows.
 * (The layout budget counts the same 4 rows in `chromeRows`.)
 */
export const AD_BANNER_ROWS = 4;

/**
 * Where the ad banner sits, in the terminal's own 1-based coordinates — the
 * frame Ink paints is anchored at row 1 of the alternate screen, so a mouse
 * report's `y` is directly comparable to `top`/`bottom`.
 *
 * Counted from the BOTTOM, never the top: everything under the banner (the
 * optional approval row, the composer, the status row and the key hints) is
 * fixed height, so `below` is exact however the transcript above grows or
 * shrinks. `null` when the banner is not on screen at all, which is what keeps
 * a click harmless when the chrome is hidden.
 */
export function adBannerRect({ rows, cols, below }) {
  // The same clamp the root box uses: a terminal too short to hold the frame
  // gets the minimum, and the rows below can then be off screen — so the rect
  // is clamped into the screen rather than pointing at a row that is not there.
  const frame = Math.max(10, rows - 1);
  const bottom = Math.min(frame, Math.max(0, frame - below));
  const top = bottom - (AD_BANNER_ROWS - 1);
  if (bottom < 1 || top < 1) return null;
  return { top, bottom, left: 1, right: Math.max(1, cols) };
}

/**
 * True when a click landed on the ad banner. The whole card is the target —
 * the CTA strip is one row inside it, and a card that only opens when the
 * pointer finds a 14-column button reads as broken.
 */
export function clickedAdBanner(click, rect) {
  if (!click || !rect) return false;
  return click.y >= rect.top && click.y <= rect.bottom && click.x >= rect.left && click.x <= rect.right;
}

/**
 * Route one raw stdin chunk to the gesture it holds. Pure — the caller supplies
 * what is on screen and what to do about it — so the rules below are testable
 * without a terminal, a browser, or a real click.
 *
 * Returns "wheel", "click" or null. A chunk is a wheel or a click, never both:
 * a terminal writes one report per gesture, and Ink splits a report's leading
 * ESC off, so the two never share a chunk.
 */
export function routeMouseChunk(chunk, { ad, rect, onWheel, onAdClick } = {}) {
  const events = parseWheel(chunk);
  if (events.length) {
    onWheel(events);
    return "wheel";
  }

  const clicks = parseClicks(chunk);
  if (!clicks.length) return null;
  // No card on screen means no click target: the banner is the only clickable
  // thing in the frame, so a click anywhere else — the transcript, the
  // composer, a row the card has just given up — is dropped rather than
  // guessed at.
  if (!ad) return null;
  if (!clicks.some((click) => clickedAdBanner(click, rect))) return null;
  onAdClick(ad);
  return "click";
}

/**
 * Resolve a sponsor card's destination to the URL the browser is handed.
 * Pure, so the one rule that matters — a click must go through our server — is
 * testable without a browser: a relative link is joined to the API base.
 */
export function adTargetUrl(base, link) {
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return link;
  return `${String(base ?? "").replace(/\/+$/, "")}${link.startsWith("/") ? "" : "/"}${link}`;
}

function AdBanner({ ad, hidden, size }) {
  if (!ad || hidden) return null;
  const cta = ` ${ad.ctaLabel || "learn more"} `;
  const hint = "  click to open · esc dismiss";
  // A sponsor card is the one thing on screen that is not Cloudy, so it is the
  // one thing the CLI colours: the border and the CTA strip take the
  // advertiser's accent. A campaign that brought its own accent (validated
  // server-side) wins; a network or house slot gets the token set's default.
  // Everything else on the card stays monochrome.
  const accent = ad.accent || TUI.adBorder;
  // One row each, fitted to the inner width so the banner can never wrap.
  const width = Math.max(8, size.w - 4);
  const headline = fit(`${ad.customHeadline || ad.headline || ad.content}  ·  sponsor`, width);
  const body = ad.body ? fit(ad.body, Math.max(0, width - cta.length - hint.length)) : null;
  return h(
    Box,
    {
      flexDirection: "column",
      borderStyle: "round",
      borderColor: accent,
      paddingX: 1,
      flexShrink: 0,
    },
    h(Text, null, h(Text, { bold: true }, headline)),
    h(
      Text,
      null,
      body ? h(Text, { dimColor: true }, body) : null,
      h(Text, { backgroundColor: accent, color: TUI.adCtaInk }, cta),
      h(Text, { dimColor: true }, hint)
    )
  );
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

function Overlay({ title, onClose, size, maxRows, children }) {
  useInput((input, key) => {
    if (key.escape) onClose();
  });
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  const { shown } = trimRows(items, maxRows);
  return h(
    Box,
    {
      flexDirection: "column",
      borderStyle: "round",
      borderColor: TUI.border,
      paddingX: 1,
      flexGrow: 1,
      flexShrink: 1,
    },
    h(Text, { bold: true }, fit(title, Math.max(10, size.w - 4))),
    h(Box, { flexDirection: "column", marginTop: 1 }, ...shown)
  );
}

function ModelPicker({ models, cfg, onClose, size, maxRows }) {
  const [idx, setIdx] = useState(
    Math.max(0, models.findIndex((m) => m.id === cfg.model))
  );
  useInput((input, key) => {
    if (key.upArrow) setIdx((i) => Math.max(0, i - 1));
    else if (key.downArrow)
      setIdx((i) => Math.min(models.length - 1, i + 1));
    else if (key.return) {
      const m = models[idx];
      if (m) {
        // `modelChosen` is what retires the first-run picker: having picked
        // once, the launch after this one goes straight to the chat.
        saveConfig({ model: m.id, modelChosen: true });
        cfg.model = m.id;
        cfg.modelChosen = true;
      }
      onClose();
    }
  });
  return h(
    Overlay,
    { title: "model — ↑↓ move · enter pick · esc close", onClose, size, maxRows },
    models.length === 0
      ? h(Text, { dimColor: true }, "no models — is the server up?")
      : models.map((m, i) =>
          h(
            Text,
            { key: m.id, bold: i === idx },
            fit(
              (i === idx ? "❯ " : "  ") +
                (m.id === cfg.model ? "● " : "  ") +
                m.id.padEnd(30) +
                " " +
                m.name,
              Math.max(10, size.w - 4)
            )
          )
        )
  );
}

function HelpPanel({ onClose, size, maxRows }) {
  // Every entry is exactly one row, so the panel can be capped honestly
  // instead of letting Ink clip a taller-than-box frame (which mangles text).
  //
  // The row budget is tight and worth counting: at 80x24 the frame leaves 19
  // rows for this panel, and a command list that loses its tail is useless
  // exactly when it is needed (the user is reading it because they do not know
  // the commands). So the list is one row per command with no section heading —
  // "/help show help" is self-evident — and the keys are three lines.
  // The keys label shares the first key row: a heading on a row of its own
  // would push this panel one row past what a 24-row terminal holds.
  const keys = [
    "  keys   enter send · ↑↓ history · ctrl+u clear · esc close",
    "         tab build|plan · ctrl+o model · ctrl+t usage · ctrl+w account",
    "         ctrl+l login · ctrl+c twice quit · ctrl+n new chat",
  ];
  const row = (key, text, bold) =>
    h(Text, { key, bold: !!bold, dimColor: !bold }, fit(text, Math.max(10, size.w - 4)));
  return h(
    Overlay,
    { title: "help", onClose, size, maxRows },
    // padEnd(19) rather than 16: "/mode [build|plan]" is 18 characters, and
    // padding by less than that ran the name into its description.
    ...COMMANDS.map(([name, desc]) => row(name, "  /" + name.padEnd(19) + desc)),
    ...keys.map((line, i) => row(`k${i}`, line))
  );
}

/**
 * The accent a model's dot takes. The model registry states a token NAME per
 * model (lib/models.ts → theme/tokens.mjs); the CLI's generated token file
 * carries the values, because a terminal has no CSS to resolve them. An
 * unknown or absent accent falls back to the neutral dot rather than to a
 * colour invented here.
 */
export function modelAccent(accentToken) {
  return (accentToken && MODEL_ACCENTS[accentToken]) || TUI.modelDot;
}

/**
 * /skills — what this workspace teaches the agent.
 *
 * Read from the agent host rather than from the filesystem here: the host owns
 * reading `.cloudy/skills`, and the list it returns is the one the model is
 * offered. A panel that listed the directory itself could name a file the host
 * rejects (a malformed header), which is the kind of "it says it is there but
 * the agent cannot see it" gap worth avoiding.
 */
function SkillsPanel({ skills, onClose, size, maxRows }) {
  const width = Math.max(10, size.w - 4);
  const row = (key, text, dim) =>
    h(Text, { key, dimColor: dim }, fit(text, width));

  let body;
  if (!skills) {
    body = [row("loading", "  reading the workspace…", true)];
  } else if (skills.error) {
    body = [row("err", `  could not read skills: ${skills.error}`, true)];
  } else if (!skills.items?.length) {
    body = [
      row("none", "  no skills in this workspace", true),
      row("hint", "  add .cloudy/skills/<name>.md — the agent loads one when it needs it", true),
    ];
  } else {
    body = [
      row("c", `${skills.items.length} skill${skills.items.length === 1 ? "" : "s"} in this workspace`, true),
      row("gap", " "),
      ...skills.items.flatMap((s) => [
        row(`n-${s.name}`, `  ${s.name}`),
        row(`d-${s.name}`, `    ${s.description || "no description"}`, true),
      ]),
    ];
  }
  return h(Overlay, { title: "skills", onClose, size, maxRows }, ...body);
}

/**
 * /mcps — the plugin servers, and whether they are actually up.
 *
 * Listing them is what connects them, so `running` here is a measurement, not
 * a config echo: a server whose command is missing shows its error on its own
 * line instead of looking configured.
 */
function McpsPanel({ servers, onClose, size, maxRows }) {
  const width = Math.max(10, size.w - 4);
  const row = (key, text, dim) =>
    h(Text, { key, dimColor: dim }, fit(text, width));

  let body;
  if (!servers) {
    body = [row("loading", "  connecting…", true)];
  } else if (servers.error) {
    body = [row("err", `  could not list servers: ${servers.error}`, true)];
  } else if (!servers.items?.length) {
    body = [
      row("none", "  no plugin servers configured", true),
      row("hint", "  /import brings them over from Claude Code, Cursor or VS Code", true),
    ];
  } else {
    const running = servers.items.filter((s) => s.running).length;
    body = [
      row("c", `${running} of ${servers.items.length} server(s) running`, true),
      row("gap", " "),
      ...servers.items.flatMap((s) => {
        const tools = s.tools?.length ?? 0;
        const state = s.running ? `${tools} tool${tools === 1 ? "" : "s"}` : "not running";
        const target = [s.config?.command, ...(s.config?.args ?? [])].filter(Boolean).join(" ") || "no command";
        return [
          row(`n-${s.name}`, `  ${s.name}  ·  ${state}`),
          row(`t-${s.name}`, `    ${target}`, true),
          ...(s.error ? [row(`e-${s.name}`, `    ${s.error}`, true)] : []),
        ];
      }),
    ];
  }
  return h(Overlay, { title: "mcp servers", onClose, size, maxRows }, ...body);
}

function UsagePanel({ usage, onClose, size, maxRows }) {
  const width = Math.max(10, size.w - 4);
  return h(
    Overlay,
    { title: "usage", onClose, size, maxRows },
    usage
      ? // The two currencies share one line; at narrow widths it becomes two.
        usage.split("  ·  ").flatMap((part, i) =>
          part.length <= width
            ? [h(Text, { key: `u${i}` }, part)]
            : part
                .split(" · ")
                .map((piece, j) => h(Text, { key: `u${i}.${j}` }, piece.trim()))
        )
      : [h(Text, { key: "n", dimColor: true }, "no usage data — are you signed in?")]
  );
}

/**
 * SettingsPanel — the CLI's account, defaults and where they live.
 *
 * Read-only on purpose: every value here is owned by a command that already
 * exists (/model, /effort, /import, /login), so this panel reports the state
 * and names the command that changes each one instead of growing a second way
 * to set the same thing. The config file it prints is the same one the CLI's
 * stdio host reads, so the desktop app and this share one account.
 */
function SettingsPanel({ cfg, usage, effort, sessionLeft, mode, access, workspace, size, maxRows, onClose }) {
  const width = Math.max(10, size.w - 4);
  // One label column, so the values line up and the whole thing fits 80x24
  // without a "… more" cut.
  const row = (key, label, text) =>
    h(Text, { key }, fit(`${label.padEnd(9)}${text}`, width));
  const account = cfg.user?.email ? `${cfg.user.email} — free plan, funded by sponsors` : "not signed in — /login to connect";
  // ~ instead of the absolute home path: the row has to survive 80 columns.
  const home = process.env.HOME || "";
  const shorten = (p) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p);
  const shortPath = shorten(path.join(cliConfigDir(), "config.json"));
  const clock =
    sessionLeft !== null
      ? `${fmtClock(sessionLeft)} left — the hour starts with the first message`
      : "starts with your first message — each turn costs its model's price";
  return h(
    Overlay,
    { title: "settings", onClose, size, maxRows },
    row("a", "account", account),
    row("m", "model", `${cfg.model || "(server default)"} — /model to pick another`),
    row("e", "effort", `${effort} — /effort low|medium|high|max`),
    row("u", "usage", usage || "no usage data yet — /usage refreshes it"),
    row("s", "session", clock),
    row("b", "server", cfg.base),
    row("c", "config", `${shortPath} (mode 0600, owns your token)`),
    // What the next turn will be: the same mode the status row shows, and the
    // folder the agent is actually confined to (it opens on the first turn).
    row("o", "mode", `${mode} — ${MODE_HINTS[mode]} (tab toggles)`),
    row("x", "access", `${access} — ${ACCESS_HINTS[access]}`),
    // "folder", not "workspace": the label column is nine wide and a nine
    // character label leaves no gap before its value.
    row("w", "folder", shorten(workspace || process.cwd())),
    row("i", "import", "/import brings skills and MCP servers over from Claude, Cursor or VS Code")
  );
}

function WhoamiPanel({ user, onClose, size, maxRows }) {
  return h(
    Overlay,
    { title: "account", onClose, size, maxRows },
    h(
      Text,
      null,
      fit(
        user ? `${user.email} — free plan` : "not signed in — /login to connect",
        Math.max(10, size.w - 4)
      )
    )
  );
}

/**
 * The sign-in list: browser pairing, email, then one row per provider the
 * server offers.
 *
 * Keys are digits rather than initials because two providers share one
 * (Google, GitHub), and the ids come from the server — a provider configured
 * later appears here with no code change.
 */
export function providerChoices(ids) {
  return orderedProviders(ids).map((id, i) => ({
    key: String(i + 1),
    id,
    label: "continue with " + providerName(id),
  }));
}

function LoginPanel({ cfg, onDone, onClose, size, maxRows }) {
  const [stage, setStage] = useState("choose");
  const [field, setField] = useState("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // The provider chosen on the first screen, if any: it only changes the URL
  // the pairing opens, never the code or the poll behind it.
  const [provider, setProvider] = useState(null);
  const [providers, setProviders] = useState([]);
  const choices = providerChoices(providers);

  useEffect(() => {
    let live = true;
    fetchProviders(cfg).then((ids) => {
      if (live) setProviders(ids);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (stage !== "pairing") return;
    let cancelled = false;
    (async () => {
      try {
        const result = await loginPairing(cfg, (url, fmt) => {
          setCode(fmt);
          openBrowser(url);
        }, provider);
        if (cancelled) return;
        saveConfig({ token: result.token, user: result.user });
        cfg.token = result.token;
        cfg.user = result.user;
        onDone(result.user);
      } catch (err) {
        if (!cancelled) setError(err?.message ?? String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stage]);

  useInput((input, key) => {
    if (busy) return;
    if (stage === "choose") {
      const picked = choices.find((c) => c.key === input);
      if (input === "b" || input === "B") {
        setProvider(null);
        setStage("pairing");
      } else if (input === "e" || input === "E") setStage("email");
      else if (picked) {
        setProvider(picked.id);
        setStage("pairing");
      } else if (key.escape) onClose();
    } else if (stage === "email") {
      if (key.tab)
        setField((f) => (f === "email" ? "password" : "email"));
      else if (key.backspace || key.delete) {
        if (field === "email") setEmail((v) => v.slice(0, -1));
        else setPassword((v) => v.slice(0, -1));
      } else if (key.return) {
        setBusy(true);
        loginPassword(cfg, email.trim(), password)
          .then((result) => {
            saveConfig({ token: result.token, user: result.user });
            cfg.token = result.token;
            cfg.user = result.user;
            onDone(result.user);
          })
          .catch((err) => {
            setError(err?.message ?? String(err));
            setBusy(false);
          });
      } else if (input && !key.ctrl && !key.meta) {
        if (field === "email") setEmail((v) => v + input);
        else setPassword((v) => v + input);
      }
    } else if (stage === "pairing" && key.escape) {
      onClose();
    }
  });

  const width = Math.max(10, size.w - 4);
  if (stage === "choose") {
    return h(
      Overlay,
      { title: "sign in", onClose, size, maxRows },
      h(Text, { bold: true }, "  [b]  browser pairing (opens your browser)"),
      h(Text, { bold: true }, "  [e]  email + password"),
      ...choices.map((c) =>
        h(
          Text,
          { key: c.id, bold: true },
          fit(`  [${c.key}]  ${c.label}`, width)
        )
      ),
      error && h(Text, { bold: true }, fit(error, width))
    );
  }
  if (stage === "email") {
    return h(
      Overlay,
      {
        title: "sign in with email — tab to switch fields, enter to submit",
        onClose,
        size,
        maxRows,
      },
      h(
        Text,
        null,
        fit(
          "email: " + (field === "email" ? "❯ " : "  ") + email,
          width
        )
      ),
      h(
        Text,
        null,
        "password: " +
          (field === "password" ? "❯ " : "  ") +
          "•".repeat(password.length)
      ),
      error && h(Text, { bold: true }, fit(error, width)),
      busy && h(Text, { dimColor: true }, "signing in…")
    );
  }
  return h(
    Overlay,
    {
      title:
        (provider ? providerName(provider) + " sign-in" : "browser pairing") +
        " — esc to cancel",
      onClose,
      size,
      maxRows,
    },
    code && h(Text, null, fit("code: " + code + " — waiting for approval…", width)),
    !code && h(Text, { dimColor: true }, "starting pairing…"),
    error && h(Text, { bold: true }, fit(error, width))
  );
}

// ---------------------------------------------------------------------------
// Command palette — appears while draft starts with "/"
// ---------------------------------------------------------------------------

function CommandPalette({ query, onChange, onPick, onClose, size, maxRows }) {
  const [idx, setIdx] = useState(0);
  const matches = filterCommands(query).slice(0, Math.max(1, maxRows));
  useEffect(() => {
    setIdx(0);
  }, [query]);
  useInput((input, key) => {
    if (key.upArrow) setIdx((i) => Math.max(0, i - 1));
    else if (key.downArrow)
      setIdx((i) =>
        Math.min(Math.max(0, matches.length - 1), i + 1)
      );
    else if (key.tab || key.return) {
      const m = matches[idx];
      if (!m) return;
      // Tab completes to the command and leaves the palette open for its
      // argument. Enter runs what was typed: once the line has an argument in
      // it (a space), completing back to the bare name would throw that
      // argument away, which made /access full, /effort high, /model <id> and
      // /import apply impossible to type.
      const typed = "/" + query;
      onPick(key.tab ? "/" + m[0].split(" ")[0] + " " : query.includes(" ") ? typed : "/" + m[0].split(" ")[0]);
    } else if (key.escape) onClose();
    else if (key.backspace || key.delete) {
      const q = query.slice(0, -1);
      onChange(q ? "/" + q : "");
    } else if (input && !key.ctrl && !key.meta)
      onChange("/" + query + input);
  });
  return h(
    Box,
    {
      flexDirection: "column",
      borderStyle: "round",
      borderColor: TUI.border,
      paddingX: 1,
      flexShrink: 0,
    },
    h(
      Box,
      null,
      h(Text, { bold: true }, "/"),
      h(Text, null, fit(query, Math.max(10, size.w - 6))),
      h(Text, { dimColor: true }, "_")
    ),
    matches.length === 0
      ? h(
          Text,
          { dimColor: true },
          fit("  no matching command — esc to cancel", Math.max(10, size.w - 4))
        )
      : matches.map(([name, desc], i) =>
          h(
            Text,
            {
              key: name,
              bold: i === idx,
              dimColor: i !== idx,
            },
            (i === idx ? "❯ " : "  ") +
              "/" +
              name.padEnd(15) +
              desc
          )
        ),
    h(
      Text,
      { dimColor: true },
      fit("  ↑↓ move · tab complete · enter run · esc cancel", Math.max(10, size.w - 4))
    )
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

/**
 * The CLI session.
 *
 * Every turn here is an agent turn on the app-server, so the folder you launch
 * `cloudy` in is the one it works in, and how far it may go is governed by the
 * access level. `agentClient` is the seam the tests drive: the real app spawns
 * the host (`./agent.js`), and a test passes a scripted one.
 */
export function App({ cfg, agentClient = null }) {
  const { exit } = useApp();
  const [size, setSize] = useState(terminalSize());
  useEffect(() => {
    const onResize = () => setSize(terminalSize());
    process.stdout.on("resize", onResize);
    return () => process.stdout.off("resize", onResize);
  }, []);

  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [models, setModels] = useState([]);
  const [usage, setUsage] = useState(null);
  const [overlay, setOverlay] = useState("none");
  // The first-run model picker fires once per process: a user who closes it
  // with esc is not asking to see it again on the next render.
  const firstRunPicked = useRef(false);
  const [thinking, setThinking] = useState(false);
  const [ctrlC, setCtrlC] = useState(0);
  const historyRef = useRef([]);
  const busyRef = useRef(false);
  const [ad, setAd] = useState(null);
  const adRef = useRef(null);
  // The sponsor card can be hidden for the session (/sponsor off). Not
  // persisted on purpose: the card is what funds the free plan, and a setting
  // that outlives the window it was set in is a different feature (an account
  // preference), not a session control.
  const [adsOn, setAdsOn] = useState(true);
  // ↑/↓ walk what was sent this session (src/history.js). Named for the
  // composer to keep it distinct from the conversation's own historyRef.
  const draftHistoryRef = useRef(emptyHistory());
  // /skills and /mcps read the agent host on demand; null = not asked yet.
  const [skills, setSkills] = useState(null);
  const [mcpServers, setMcpServers] = useState(null);
  // Rows scrolled back from the newest line (mouse wheel). 0 = following.
  const [scroll, setScroll] = useState(0);
  // Where the sponsor card is on screen right now, so a click can be hit-tested
  // against the frame as it currently is (see adBannerRect).
  const adRectRef = useRef(null);
  // One-hour session budget, mirroring the server's rule: the clock starts on
  // the first sent message (the turn that takes the credit), not at launch.
  const sessionStartRef = useRef(null);
  const [sessionLeft, setSessionLeft] = useState(null);
  useEffect(() => {
    if (sessionStartRef.current === null) return undefined;
    const tick = () => {
      const left = SESSION_BUDGET_MS - (Date.now() - sessionStartRef.current);
      setSessionLeft(Math.max(0, left));
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [sessionStartRef.current]);
  // How far the transcript can be scrolled; MessageList publishes it.
  const maxScrollRef = useRef(0);
  // When the last wheel event arrived, so the ESC a terminal sends with it is
  // not mistaken for the user pressing escape.
  const lastWheelAt = useRef(0);
  // The terminal's original background colour, captured from the OSC 11 reply.
  const [effort, setEffort] = useState(process.env.CLOUDY_EFFORT || "medium");
  const abortRef = useRef(null);
  // Build or Plan. The SERVER decides what that means — a plan turn has every
  // tool that can write or execute withheld by the agent loop — so this is only
  // which mode the next turn asks for. Tab flips it (see the input handler).
  const [mode, setMode] = useState("build");
  // What the agent may do without asking. `ask` is the default everywhere:
  // a wrong edit is cheap to prevent and expensive to undo.
  const [access, setAccess] = useState("ask");
  // The approval the agent has stopped on, if any.
  const [pending, setPending] = useState(null);
  // The folder the agent is confined to, and its name for the status chrome.
  const workspaceRef = useRef(null);
  const [workspace, setWorkspace] = useState(null);
  // ONE id per CLI session: the server's one-hour budget and every streamed
  // event are keyed by it, so the local countdown and the server's rule are
  // counting the same thing. /new starts a new one.
  const sessionIdRef = useRef(null);
  const clientRef = useRef(null);
  // The turn being streamed, as a mutable record. It is the ONE source the
  // turn's row is painted from: every event repaints from it, and so does the
  // answer to an approval — a copy taken at approval time would be overwritten
  // by the next delta (it was, until this became the single owner).
  const turnRef = useRef({ text: "", parts: [] });
  const agentOf = () => agentClient ?? (clientRef.current ??= createAgentClient(cfg));
  useEffect(() => () => clientRef.current?.close(), []);

  // A modal owns the whole frame: the composer, hints and ad are for the chat
  // view, and leaving them on screen is what pushed the frame past the
  // terminal height and corrupted it.
  const modal = overlay !== "none";
  const splashOn =
    messages.length === 0 &&
    !modal &&
    process.env.CLOUDY_NO_SPLASH !== "1";
  const paletteOpen = !modal && draft.startsWith("/");

  useEffect(() => {
    fetchModels(cfg)
      .then((m) => {
        setModels(m);
        // Read before the default above fills it in: "has this machine ever
        // chosen a model?" is the question, and a fallback is not a choice.
        const hadModel = Boolean(cfg.model);
        if (!cfg.model && m.length) cfg.model = m[0].id;
        // First run: nothing has ever been chosen here, so ask instead of
        // quietly sending every turn to whichever model happened to be listed
        // first. An install that already has a model saved — every existing
        // user, since this flag is new — is never interrupted. Picking writes
        // `modelChosen`, so this happens once; esc closes it without choosing,
        // and the ref keeps it closed for this process.
        if (!hadModel && !cfg.modelChosen && m.length && !firstRunPicked.current) {
          firstRunPicked.current = true;
          setOverlay("model");
        }
      })
      .catch(() => setModels([]));
    if (cfg.token) {
      fetchUsage(cfg)
        .then((u) => setUsage(fmtUsage(u)))
        .catch(() => setUsage(null));
    }
  }, []);

  // Every account is the same free plan, so every signed-in account sees the
  // sponsors that fund Cloudy.
  const adEligible = Boolean(cfg.token);
  useEffect(() => {
    if (!adEligible) return;
    let cancelled = false;
    fetchAds(cfg).then((data) => {
      if (cancelled) return;
      setAd(data?.banner ?? null);
      adRef.current = data?.banner ?? null;
    });
    return () => {
      cancelled = true;
    };
  }, [adEligible]);

  /**
   * The URL a sponsor card opens: the server mints every ad's `link` as a
   * relative `/api/ads/click?token=…` for exactly this reason — the click has
   * to reach Cloudy first, or nothing is billed and neither the advertiser nor
   * the network has any record of it. So a relative link is resolved against
   * our own base, and only a link that is already absolute is followed as-is
   * (our server never mints one, but a token-less house placement is a path
   * too, and this must not turn into an open redirect if one ever is).
   */
  const openAd = (target) => {
    if (!target?.link) return;
    openBrowser(adTargetUrl(cfg.base, target.link));
    setAd(null);
    adRef.current = null;
  };

  /**
   * The mouse wheel drives the transcript, not the terminal.
   *
   * Reporting is switched on for as long as the TUI is on screen and off again
   * on exit — a shell left with mouse reporting on cannot select text, so the
   * cleanup matters as much as the setup. Any text that is NOT a wheel event is
   * left alone: Ink's own reader owns the keyboard, and this listener never
   * consumes it (it only reads).
   */
  useEffect(() => {
    if (!process.stdout.isTTY) return undefined;
    process.stdout.write(MOUSE_ENABLE);
    // Canvas: true black. Restored on exit with OSC 111 (no OSC 11 query —
    // its reply reaches Ink's stdin reader and lands in the composer).
    process.stdout.write(BG_SET);
    const onData = (chunk) => {
      routeMouseChunk(chunk, {
        // Read through refs: this listener registers once, on mount, so state
        // captured in the closure would be the state of the first frame.
        ad: adRef.current,
        rect: adRectRef.current,
        onWheel: (events) => {
          lastWheelAt.current = Date.now();
          setScroll((current) => applyWheel(current, events, maxScrollRef.current));
        },
        onAdClick: openAd,
      });
    };
    process.stdin.on("data", onData);
    // exit() bypasses React cleanups (it always has — even the mouse disable
    // never ran through this path), so the restore rides the synchronous
    // process-exit hook instead. TTY writes are synchronous there.
    const onExit = () => {
      try {
        writeSync(1, MOUSE_DISABLE);
        writeSync(1, BG_RESET);
      } catch { /* fd already closed */ }
    };
    process.once("exit", onExit);
    return () => {
      process.stdin.off("data", onData);
      process.removeListener("exit", onExit);
      try {
        writeSync(1, MOUSE_DISABLE);
        writeSync(1, BG_RESET);
      } catch { /* fd already closed */ }
    };
  }, []);

  /**
   * Leaving the app, the one way out: stop whatever is running, let Ink
   * unmount (its exit hook restores mouse mode and the canvas), and make sure
   * the PROCESS ends.
   *
   * A pending reply holds an open SSE socket, and an open socket keeps Node's
   * event loop alive — so quitting mid-stream used to unmount the TUI and then
   * just sit there, looking like a hung shell, until the stream finished. A
   * quit is a quit: abort the stream and end the process on the next tick.
   */
  /**
   * The folder the agent is confined to, opened once per session.
   *
   * Opened on demand because more than a turn needs it: skills and MCP servers
   * are read THROUGH the workspace, and the host answers "nothing here" for a
   * folder it has never been given — so listing either before the first message
   * would report an empty workspace rather than an unopened one. Same explicit
   * root as a turn uses: the directory you launched in is the one you chose.
   */
  const ensureWorkspace = async () => {
    if (workspaceRef.current) return workspaceRef.current;
    const ws = await agentOf().openWorkspace(process.cwd());
    if (!ws?.open || !ws.root) throw new Error(`could not open ${process.cwd()} as a workspace`);
    workspaceRef.current = ws.root;
    setWorkspace(ws.name || ws.root);
    return ws.root;
  };

  const quit = () => {
    try {
      abortRef.current?.abort();
    } catch { /* already settled */ }
    exit();
    setTimeout(() => process.exit(0), 40);
  };

  const send = async (text) => {
    if (busyRef.current) return;
    if (!cfg.token) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: "not signed in — /login to connect your account",
        },
      ]);
      return;
    }
    if (!cfg.model && models.length) cfg.model = models[0].id;
    if (!cfg.model) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: "no model — /model to pick one",
        },
      ]);
      return;
    }
    if (sessionStartRef.current === null) sessionStartRef.current = Date.now();
    const sendId = (sessionIdRef.current ??= `cli-${Date.now().toString(36)}`);
    busyRef.current = true;
    setThinking(true);
    // Sending is an explicit "go back to live" — reading the answer is the point.
    setScroll(0);
    setMessages((m) => [...m, { role: "user", content: text }]);
    const history = historyRef.current;
    history.push({ role: "user", content: text });
    const agent = agentOf();
    // The turn's own row, grown in place.
    const turn = (turnRef.current = { text: "", parts: [] });
    const openTurn = () => setMessages((m) => [...m, { role: "assistant", content: "", parts: [] }]);
    // esc stops THIS turn: the RPC aborts the run on the server (and resolves
    // any approval it was waiting on), which ends the turn with an error event.
    abortRef.current = {
      abort: () => {
        void agent.abort(sendId).catch(() => undefined);
      },
    };
    let turnError = null;
    try {
      // The folder the agent is confined to (see ensureWorkspace).
      await ensureWorkspace();
      openTurn();
      await agent.respond(
        {
          chatId: null,
          modelId: cfg.model,
          messages: history,
          effort,
          access,
          agentMode: mode,
          sendId,
        },
        (event) => {
          if (event.type === "delta") {
            turn.text += event.content ?? "";
            const tail = turn.parts[turn.parts.length - 1];
            if (tail?.kind === "text") tail.text += event.content ?? "";
            else turn.parts.push({ kind: "text", text: event.content ?? "" });
          } else if (event.type === "tool") {
            // The same call arrives twice — running, then ok/error — so it
            // updates its own row instead of adding a second one.
            const id = event.call?.id ?? `t${turn.parts.length}`;
            const at = turn.parts.findIndex((p) => p.kind === "tool" && p.id === id);
            const row = { kind: "tool", id, label: toolLabel(event.call), status: event.status ?? "running" };
            if (at === -1) turn.parts.push(row);
            else turn.parts[at] = { ...turn.parts[at], ...row };
          } else if (event.type === "approval") {
            setPending({ approvalId: event.approvalId, command: event.command });
            turn.parts.push({
              kind: "approval",
              approvalId: event.approvalId,
              command: event.command,
              resolved: null,
            });
          } else if (event.type === "done") {
            // The step result is authoritative over the deltas: narration from
            // a tool step is not part of the answer.
            if (event.message?.content) turn.text = event.message.content;
          } else if (event.type === "error") {
            // The turn ends here; render it the same way a thrown failure is.
            turnError = String(event.error ?? "the run failed");
          } else {
            return; // reasoning and context are not part of this transcript
          }
          flushTurn();
        }
      );
      if (turnError) throw new ChatAPIError(turnError, 502);
      history.push({ role: "assistant", content: turn.text });
    } catch (err) {
      // Nothing was written, so the turn never happened on this side either:
      // dropping the user message keeps a retry from sending it twice.
      if (!turn.text) history.pop();
      // "aborted" is the agent loop's own word for a stop, and a dead network
      // is the state a user hits most often (server down, laptop offline).
      const detail = String(err?.message ?? err);
      const aborted = err?.name === "AbortError" || /^aborted$/i.test(detail);
      const unreachable = /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|exited before answering/i.test(detail);
      const msg = aborted
        ? "stopped"
        : err instanceof ChatAPIError
          ? err.message
          : unreachable
            ? `can't reach ${cfg.base} — check your connection and try again`
            : `request failed: ${detail}`;
      setMessages((m) => {
        const next = [...m];
        const last = next[next.length - 1];
        // Keep whatever streamed before the stop — losing a half-written
        // answer because you pressed esc is its own kind of wrong.
        if (last && last.role === "assistant" && last.content) {
          next[next.length - 1] = { ...last, content: last.content + `\n\n[${msg}]` };
          return next;
        }
        next[next.length - 1] = { role: "assistant", content: msg };
        return next;
      });
    } finally {
      setPending(null);
      abortRef.current = null;
      busyRef.current = false;
      setThinking(false);
    }
    if (adEligible) {
      fetchAds(cfg).then((data) => {
        if (data?.banner) {
          adRef.current = data.banner;
          setAd(data.banner);
        }
      });
    }
  };

  /**
   * Repaint the running turn's row from `turnRef` — the only writer of the
   * last message while a turn streams.
   */
  const flushTurn = () =>
    setMessages((m) => {
      const next = [...m];
      next[next.length - 1] = {
        role: "assistant",
        content: turnRef.current.text,
        parts: turnRef.current.parts.map((p) => ({ ...p })),
      };
      return next;
    });

  /**
   * Answer the question the agent is stopped on.
   *
   * The row the approval left in the transcript is updated with the answer, so
   * the transcript still says what was run and what was declined after the bar
   * itself is gone — the record outlives the question.
   */
  const answerApproval = (approve) => {
    const question = pending;
    if (!question) return;
    setPending(null);
    // Recorded on the turn's own record, so the next event still paints the
    // answer. `resolved` is what the row shows after the bar is gone.
    const part = turnRef.current.parts.find(
      (p) => p.kind === "approval" && p.approvalId === question.approvalId
    );
    if (part) part.resolved = approve ? "ran" : "declined";
    flushTurn();
    void agentOf().approve(question.approvalId, approve).catch(() => undefined);
  };

  const handleCommand = (raw) => {
    const text = raw.trim();
    if (text === "/quit" || text === "/exit") return quit();
    if (text === "/help") return setOverlay("help");
    if (text === "/model") return setOverlay("model");
    // /skills and /mcps: the panel opens immediately and fills in when the
    // agent host answers, so the key feels instant even on a cold host (the
    // first request is what spawns it).
    if (text === "/skills") {
      setSkills(null);
      setOverlay("skills");
      // The workspace first: skills are read out of the folder, so listing them
      // before the host has one would report an empty workspace.
      ensureWorkspace()
        .then(() => agentOf().listSkills())
        .then((r) => setSkills({ items: Array.isArray(r?.skills) ? r.skills : [] }))
        .catch((err) => setSkills({ error: String(err?.message ?? err) }));
      return;
    }
    if (text === "/mcps") {
      setMcpServers(null);
      setOverlay("mcps");
      ensureWorkspace()
        .then(() => agentOf().listMcpServers())
        .then((r) => setMcpServers({ items: Array.isArray(r?.servers) ? r.servers : [] }))
        .catch((err) => setMcpServers({ error: String(err?.message ?? err) }));
      return;
    }
    // /sponsor off hides the card for this session; there is deliberately no
    // way to make it permanent from here, because the card is what keeps the
    // plan free and a per-machine opt-out is an account setting, not a
    // keystroke.
    if (text === "/sponsor" || text.startsWith("/sponsor ")) {
      const want = text.slice(8).trim().toLowerCase();
      if (!want) {
        return setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: `sponsor card: ${adsOn ? "on" : "off"} — esc dismisses one, /sponsor off hides it for the rest of this session`,
          },
        ]);
      }
      if (want !== "on" && want !== "off") {
        return setMessages((m) => [
          ...m,
          { role: "assistant", content: `unknown /sponsor \"${want}\" — on | off` },
        ]);
      }
      const on = want === "on";
      setAdsOn(on);
      if (!on) {
        setAd(null);
        adRef.current = null;
      } else {
        // Coming back means asking again: the inventory fetched at launch may
        // be long gone, and an empty slot would look like the command failed.
        fetchAds(cfg).then((data) => {
          setAd(data?.banner ?? null);
          adRef.current = data?.banner ?? null;
        });
      }
      return setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: on
            ? "sponsor card is back — it is what funds the free plan"
            : "sponsor card hidden for this session — /sponsor on brings it back",
        },
      ]);
    }
    // /effort [level] — how much reasoning the next turn is allowed to spend.
    // Bare /effort reports the current level rather than guessing a new one.
    // /import runs the CLI's own host command: the importer needs the
    // filesystem and the workspace, which live in the app-server that
    // `cloudy import` boots. Same binary, same code path, no second
    // implementation in the TUI.
    if (text === "/import" || text.startsWith("/import ")) {
      const apply = text.slice(7).trim() === "apply";
      const bin = fileURLToPath(new URL("../bin/cloudy.mjs", import.meta.url));
      setMessages((m) => [...m, { role: "assistant", content: apply ? "importing…" : "looking for skills and servers to import…" }]);
      execFile(
        process.execPath,
        [bin, "import", ...(apply ? ["--apply"] : [])],
        { maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const body = `${stdout || ""}${stderr || ""}`.trim();
          const content = body
            ? body
            : `import did not run: ${err?.message ?? "no output"}\n(run \`npm run build\` in cli/ if the host bundle is missing)`;
          setMessages((m) => {
            const next = [...m];
            next[next.length - 1] = { role: "assistant", content };
            return next;
          });
        }
      );
      return;
    }
    // /mode and /access are the same switches the status row and the approval
    // bar report. They take effect on the NEXT turn, exactly like /model — the
    // turn already on the wire was sent with the mode it started with.
    if (text === "/mode" || text.startsWith("/mode ")) {
      const want = text.slice(5).trim().toLowerCase();
      if (!want) {
        return setMessages((m) => [
          ...m,
          { role: "assistant", content: `mode: ${mode} — ${MODE_HINTS[mode]} (tab toggles it)` },
        ]);
      }
      if (want !== "build" && want !== "plan") {
        return setMessages((m) => [
          ...m,
          { role: "assistant", content: `unknown mode "${want}" — build | plan` },
        ]);
      }
      setMode(want);
      return setMessages((m) => [
        ...m,
        { role: "assistant", content: `mode: ${want} — ${MODE_HINTS[want]}` },
      ]);
    }
    if (text === "/access" || text.startsWith("/access ")) {
      const want = text.slice(7).trim().toLowerCase();
      if (!want) {
        return setMessages((m) => [
          ...m,
          { role: "assistant", content: `access: ${access} — ${ACCESS_HINTS[access]}` },
        ]);
      }
      if (!ACCESS_LEVELS.includes(want)) {
        return setMessages((m) => [
          ...m,
          { role: "assistant", content: `unknown access "${want}" — ${ACCESS_LEVELS.join(" | ")}` },
        ]);
      }
      setAccess(want);
      return setMessages((m) => [
        ...m,
        { role: "assistant", content: `access: ${want} — ${ACCESS_HINTS[want]}` },
      ]);
    }
    if (text === "/effort" || text.startsWith("/effort ")) {
      const want = text.slice(7).trim().toLowerCase();
      if (!want) {
        return setMessages((m) => [
          ...m,
          { role: "assistant", content: `effort: ${effort} — /effort low|medium|high|max to change it` },
        ]);
      }
      if (!EFFORT_LEVELS.includes(want)) {
        return setMessages((m) => [
          ...m,
          { role: "assistant", content: `unknown effort "${want}" — ${EFFORT_LEVELS.join(" | ")}` },
        ]);
      }
      setEffort(want);
      return setMessages((m) => [
        ...m,
        { role: "assistant", content: `effort set to ${want}` },
      ]);
    }
    if (text === "/usage") {
      fetchUsage(cfg)
        .then((u) => setUsage(fmtUsage(u)))
        .catch(() => {});
      return setOverlay("usage");
    }
    if (text === "/settings") {
      // Refresh first so the panel shows the account's real numbers, not
      // whatever was on screen when the session started.
      fetchUsage(cfg)
        .then((u) => setUsage(fmtUsage(u)))
        .catch(() => {});
      return setOverlay("settings");
    }
    if (text === "/whoami") return setOverlay("whoami");
    if (text === "/login") return setOverlay("login");
    if (text === "/new") {
      historyRef.current.length = 0;
      setMessages([]);
      // The server's one-hour budget is counted per sendId, so a new session
      // needs a new id — its clock starts with its own first message.
      sessionIdRef.current = null;
      sessionStartRef.current = null;
      setSessionLeft(null);
      return;
    }
    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        content: `unknown command ${text.split(" ")[0]} — /help lists them`,
      },
    ]);
  };

  const pickCommand = (pick) => {
    if (pick.endsWith(" ")) {
      setDraft(pick);
      return;
    }
    setDraft("");
    handleCommand(pick);
  };

  useInput((rawInput, key) => {
    // Mouse reports arrive here as if they were typed, so they are stripped
    // before anything reads the input. A chunk that was only a wheel event
    // leaves nothing behind and is dropped — otherwise a flick would type
    // `[<64;40;10M` into the composer.
    if (isMouseOnly(rawInput)) return;
    const input = stripMouse(rawInput);

    // A terminal sends the report as ESC + body, and Ink hands the ESC over as
    // an escape keypress. Without this, every wheel notch would also "press
    // esc" — cancelling a run or snapping the transcript back to the newest
    // line. A escape keypress within a hair of a wheel event is that ESC.
    if (key.escape && Date.now() - lastWheelAt.current < 60) return;

    if (key.ctrl && input === "c") {
      if (ctrlC > 0) quit();
      setCtrlC((n) => n + 1);
      setTimeout(() => setCtrlC(0), 1500);
      return;
    }
    if (overlay !== "none") return;
    if (paletteOpen) return;
    if (ad && !thinking) {
      // Esc dismisses the card. Enter deliberately does NOT open it: Enter is
      // the key that sends, confirms and accepts, so an empty composer plus a
      // stray Enter used to open a sponsor's link — a click nobody made, billed
      // to the advertiser. `openAd` is reached from the mouse handler below,
      // where the gesture is deliberate.
      if (key.escape) {
        setAd(null);
        adRef.current = null;
      }
    }

    // An approval outranks everything else on this screen: the agent is
    // stopped until it is answered, and y/n are answers rather than typing.
    // esc declines here instead of aborting the turn — a decline is a decision
    // the agent can act on, which a stop is not — and nothing else is consumed,
    // so no stray keystroke can resolve a pending question by accident.
    if (pending) {
      if (input === "y") return answerApproval(true);
      if (input === "n" || key.escape) return answerApproval(false);
      return;
    }

    // esc stops the turn that is running and leaves the rest of the session
    // alone; when nothing is running it scrolls back to the newest line.
    if (key.escape) {
      if (abortRef.current) {
        abortRef.current.abort();
        return;
      }
      if (scroll > 0) return setScroll(0);
      return;
    }

    // PageUp/PageDown scroll the transcript for keyboards without a wheel.
    if (key.pageUp) return setScroll((s) => applyWheel(s, [{ dir: "up", rows: 6 }], maxScrollRef.current));
    if (key.pageDown) return setScroll((s) => applyWheel(s, [{ dir: "down", rows: 6 }], maxScrollRef.current));

    // Tab flips Build/Plan, the keys' own version of the desktop's switch. It
    // is allowed mid-turn like /model is: the label and the request it
    // describes are the NEXT turn's, which is what the status row says.
    if (key.tab) return setMode((m) => (m === "build" ? "plan" : "build"));

    if (key.return) {
      const text = draft.trim();
      if (!text) {
        setDraft("");
        return;
      }
      // Commands always run, so /quit and /model still work mid-reply. They go
      // into history too: re-running yesterday's /import is exactly what ↑ is
      // for.
      if (text.startsWith("/")) {
        draftHistoryRef.current = recordSent(draftHistoryRef.current, text);
        setDraft("");
        return handleCommand(text);
      }
      // A reply already streaming must not eat what was just typed: keep the
      // draft and send it once the transcript is idle rather than clearing it
      // silently (which looked like the message had gone through).
      if (busyRef.current) return;
      draftHistoryRef.current = recordSent(draftHistoryRef.current, text);
      setDraft("");
      send(text);
      return;
    }

    if (key.backspace || key.delete)
      setDraft((v) => v.slice(0, -1));
    // ↑/↓ walk what was sent this session. A TUI has no composer scrollback, so
    // this is the only way back to "that thing I typed four messages ago"; the
    // rules (and the draft that survives the round trip) live in history.js.
    else if (key.upArrow || key.downArrow) {
      const next = recall({ ...draftHistoryRef.current, draft }, key.upArrow ? "up" : "down");
      draftHistoryRef.current = next;
      if (next.draft !== draft) setDraft(next.draft);
    } else if (key.ctrl && input === "u") setDraft("");
    else if (key.ctrl && input === "o") setOverlay("model");
    else if (key.ctrl && input === "l") setOverlay("login");
    else if (key.ctrl && input === "t") {
      fetchUsage(cfg)
        .then((u) => setUsage(fmtUsage(u)))
        .catch(() => {});
      setOverlay("usage");
    } else if (key.ctrl && input === "w") setOverlay("whoami");
    else if (key.ctrl && input === "n") {
      historyRef.current.length = 0;
      setMessages([]);
    } else if (input && !key.ctrl && !key.meta)
      setDraft((v) => v + input);
  });

  // -------------------------------------------------------------------------
  // Layout budget — the frame must never outgrow the terminal
  // -------------------------------------------------------------------------

  // Rows the input box needs: one row per visible draft line, the blank cursor
  // row and its block, plus the two border rows. It shrinks before it pushes
  // the frame off the bottom of a short terminal.
  const inputLines = Math.max(1, Math.min(5, size.h - 1 - 6));
  const inputRows = inputLines + 4;
  // Optional chrome disappears as the terminal shrinks, in this order.
  const showAd =
    Boolean(ad) && adsOn && !splashOn && !paletteOpen && !modal && size.h >= 18;
  // Key hints live only before the first message — once the user is talking
  // they know the keys, and the bottom chrome is one status row.
  const showHints = !paletteOpen && !modal && messages.length === 0 && size.h >= 13;
  // An unanswered approval adds a row above the composer. It is counted here
  // like every other chrome row, so the transcript gives up the row instead of
  // the frame pushing past the bottom of the terminal.
  const showApproval = Boolean(pending) && !modal && !paletteOpen;
  // Everything below the sponsor card, in the order it renders: the approval
  // row, the composer, the status row and the key hints.
  const adRowsBelow =
    (showApproval ? 1 : 0) + inputRows + 1 + (showHints ? 1 : 0);
  const chromeRows =
    (showAd ? AD_BANNER_ROWS : 0) +
    (paletteOpen ? 0 : inputRows) +
    (paletteOpen ? 0 : 1) + // status row
    (showHints ? 1 : 0) +
    (showApproval ? 1 : 0);

  // Hit-testing is the one thing the render cannot derive from its own output:
  // Ink has no click regions, so the card's rows are computed here, from the
  // same budget that decides whether it is drawn at all, and published to the
  // mouse listener through a ref (the listener registers once, on mount).
  adRectRef.current = showAd
    ? adBannerRect({ rows: size.h, cols: size.w, below: adRowsBelow })
    : null;

  const inner = Math.max(4, size.h - 1);
  // The palette lives under the transcript, so it takes its rows first.
  const paletteRows = paletteOpen ? 2 + 1 + 1 : 0;
  const transcriptRows = Math.max(2, inner - chromeRows - paletteRows);
  // Overlay content rows: the frame, minus the overlay host's marginTop, the
  // two border rows, the title, and the inner box's own marginTop. That last
  // row was missing from this sum, so a panel that filled its budget got one
  // row too many and Ink sliced the text to fit — the help panel's first
  // command rendered as "/login sign inlp".
  const overlayRows = Math.max(3, inner - 5);

  // -------------------------------------------------------------------------
  // Render — opencode layout
  // -------------------------------------------------------------------------
  // The root box paints the true-black canvas (theme/tokens.mjs owns the
  // value); OSC 11 asks the terminal for the same canvas. Without the root
  // fill, the app's own rows would sit on the user's terminal theme.
  return h(
    Box,
    { flexDirection: "column", height: Math.max(10, size.h - 1), backgroundColor: TUI.bg },

    // === Main area (transcript or overlay) ===
    modal
      ? h(
          Box,
          {
            key: "overlay-host",
            flexDirection: "column",
            flexGrow: 1,
            flexShrink: 1,
            marginTop: 1,
          },
          overlay === "model" &&
            h(ModelPicker, {
              models,
              cfg,
              size,
              maxRows: overlayRows,
              onClose: () => setOverlay("none"),
            }),
          overlay === "help" &&
            h(HelpPanel, {
              size,
              maxRows: overlayRows,
              onClose: () => setOverlay("none"),
            }),
          overlay === "usage" &&
            h(UsagePanel, {
              usage,
              size,
              maxRows: overlayRows,
              onClose: () => setOverlay("none"),
            }),
          overlay === "settings" &&
            h(SettingsPanel, {
              cfg,
              usage,
              effort,
              sessionLeft,
              mode,
              access,
              workspace,
              size,
              maxRows: overlayRows,
              onClose: () => setOverlay("none"),
            }),
          overlay === "skills" &&
            h(SkillsPanel, {
              skills,
              size,
              maxRows: overlayRows,
              onClose: () => setOverlay("none"),
            }),
          overlay === "mcps" &&
            h(McpsPanel, {
              servers: mcpServers,
              size,
              maxRows: overlayRows,
              onClose: () => setOverlay("none"),
            }),
          overlay === "whoami" &&
            h(WhoamiPanel, {
              user: cfg.user,
              size,
              maxRows: overlayRows,
              onClose: () => setOverlay("none"),
            }),
          overlay === "login" &&
            h(LoginPanel, {
              cfg,
              size,
              maxRows: overlayRows,
              onDone: () => setOverlay("none"),
              onClose: () => setOverlay("none"),
            })
        )
      : h(
          Box,
          {
            key: "chat-host",
            flexDirection: "column",
            flexGrow: 1,
            flexShrink: 1,
            minHeight: 0,
          },
          splashOn
            ? h(Splash, { key: "splash" })
            : h(MessageList, {
                messages,
                thinking,
                size,
                budget: transcriptRows - paletteRows,
                scroll,
                maxScrollRef,
              }),
          paletteOpen &&
            h(CommandPalette, {
              query: draft.slice(1),
              size,
              maxRows: Math.max(1, inner - 5),
              onChange: setDraft,
              onPick: pickCommand,
              onClose: () => setDraft(""),
            })
        ),

    // === Ad banner (above input) ===
    showAd && h(AdBanner, { ad, hidden: false, size }),

    // === Approval bar (above input) ===
    showApproval && h(ApprovalBar, { pending, size }),

    // === Input box ===
    !paletteOpen &&
      !modal &&
      h(InputBox, {
        value: draft,
        placeholder: 'Ask anything... "What is the tech stack of this project?"',
        disabled: thinking,
        maxVisible: inputLines,
        size,
      }),

    // === Model indicator ===
    !paletteOpen &&
      !modal &&
      h(ModelIndicator, {
        mode,
        model: cfg.model,
        // The model's own dot colour, resolved from the registry's token name.
        accent: modelAccent(models.find((m) => m.id === cfg.model)?.accent),
        effort,
        size,
        sessionLeft,
      }),

    // === Key hints ===
    showHints && !modal && h(KeyHints, { size }),

  );
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

export function runTui(cfg) {
  return new Promise((resolve) => {
    const instance = render(h(App, { cfg }), {
      exitOnCtrlC: false,
      alternateScreen: true,
    });
    instance.waitUntilExit().then(resolve);
  });
}

/**
 * Zero-dep terminal UI: prompt loop, spinner, markdown-ish rendering.
 *
 * Node 18+ built-ins only. The web app's MessageList renders markdown;
 * the CLI renders the same stream as plain text with a light renderer:
 * fenced code blocks, inline code, bold/italic, headings. Code blocks
 * are kept intact on one line so a single write() paints them whole —
 * the prompt loop is paused across assistant turns, so output never
 * interleaves with input echoes.
 */

import readline from "node:readline";
import { ANSI } from "./tokens.js";

const isTTY = process.stdout.isTTY;

// Monochrome palette — every code comes from the shared token set
// (cli/src/tokens.js), so the CLI cannot drift from the other surfaces.
// Ink's \`dimColor\` prop is the same "dim" role for the full-screen TUI.
export const C = {
  reset: ANSI.reset,
  dim: ANSI.dim,
  bold: ANSI.bold,
};

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Inline markdown → terminal text (code, bold, italic; links keep their URL). */
function inline(md) {
  let s = esc(md);
  s = s.replace(/`([^`]+)`/g, (_, code) => `${C.dim}${code}${C.reset}`);
  s = s.replace(/\*\*([^*]+)\*\*/g, `${C.bold}$1${C.reset}`);
  s = s.replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, "$1$2");
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "$1 ($2)");
  return s;
}

/**
 * Render assistant markdown to terminal text. Code fences become indented
 * blocks (kept on one output line so a single write paints them whole).
 */
export function renderMarkdown(md) {
  const out = [];
  const parts = String(md).split(/```/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      // Fence content: optional language on the first line.
      const nl = parts[i].indexOf("\n");
      const body = nl === -1 ? parts[i] : parts[i].slice(nl + 1);
      const clean = body.replace(/\n$/, "");
      out.push(
        C.dim +
          clean
            .split("\n")
            .map((l) => "  │ " + l)
            .join("\n") +
          C.reset
      );
    } else {
      for (const line of parts[i].split("\n")) {
        const h = /^(#{1,6})\s+(.*)$/.exec(line);
        if (h) out.push(`${C.bold}${inline(h[2])}${C.reset}`);
        else out.push(inline(line));
      }
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/** Spinner on the current line; returns { stop(finalText) }. */
export function spinner(text) {
  if (!isTTY) return { stop: () => {} };
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const timer = setInterval(() => {
    process.stdout.write(`\r${C.dim}${frames[i++ % frames.length]}${C.reset} ${text}  `);
  }, 80);
  return {
    stop(finalText) {
      clearInterval(timer);
      process.stdout.write("\r\x1b[K" + (finalText ? finalText + "\n" : ""));
    },
  };
}

/**
 * The prompt loop: reads a line, awaits onLine, repeats. Between turns the
 * readline is paused so streamed replies never interleave with echoes.
 * `onReady(rl)` receives the interface before the first read — the paste
 * path uses it to pre-fill the input buffer.
 */
export async function promptLoop(onLine, onReady) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${C.dim}you ›${C.reset} `,
    terminal: !!process.stdin.isTTY,
  });
  onReady?.(rl);

  // Ctrl+C exits cleanly instead of dumping a stack.
  rl.on("SIGINT", () => {
    process.stdout.write("\n");
    rl.close();
    process.exit(0);
  });

  for (;;) {
    const line = await new Promise((resolve) => {
      rl.once("line", resolve);
      rl.prompt();
    });
    const trimmed = line.trim();
    if (!trimmed) continue;
    rl.pause();
    try {
      await onLine(trimmed, rl);
    } finally {
      rl.resume();
    }
  }
}

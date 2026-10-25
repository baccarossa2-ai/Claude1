/**
 * Mouse input — the wheel scrolls the transcript, a click opens a sponsor card.
 *
 * Why clicks are read at all: the ad banner used to open on Enter, with an empty
 * composer. Enter is the key a user presses to send, to confirm and to get past
 * a prompt — so the banner was being opened by accident, which spends money and
 * reports a click nobody made. A click is a deliberate gesture, so the banner
 * waits for one and nothing else opens it.
 *
 * Mouse wheel — the terminal's own scrollback stays where it is.
 *
 * The TUI runs in the alternate screen, so nothing the app draws enters the
 * user's scrollback. What is left is the wheel: without mouse tracking a wheel
 * gesture scrolls the TERMINAL's viewport, which slides the whole frame
 * (transcript, composer, chrome) off the screen and back — the frame "moves"
 * even though the app never redrew it.
 *
 * Enabling SGR mouse reporting hands those gestures to the app instead: the
 * wheel becomes input, and the app scrolls the transcript while the composer and
 * the rest of the frame stay exactly where they are. That is the whole point of
 * the mode — "scroll the chat, not the terminal".
 *
 * Only the wheel is interpreted. Clicks and other buttons are parsed and
 * ignored (never forwarded as text), so enabling reporting cannot inject
 * characters into the draft.
 */

/** Turn on button-event reporting with SGR extended coordinates. */
export const MOUSE_ENABLE = "\u001b[?1000h\u001b[?1006h";
/** Turn it back off — always on the way out, including on a crash. */
export const MOUSE_DISABLE = "\u001b[?1000l\u001b[?1006l";

/** How many transcript rows one wheel notch moves. Three reads as "a line or two". */
export const WHEEL_ROWS = 3;

/**
 * Pull wheel events out of a raw stdin chunk.
 *
 * SGR form: ESC [ < button ; x ; y (M press | m release).
 * Wheel up is button 64, wheel down is 65 — for both, press and release. A chunk
 * may hold several events (a fast flick), which is why this returns a list.
 *
 * Returns [] for anything that is not a wheel event, so the caller can decide
 * whether the remaining bytes are keyboard input instead of guessing here.
 */
export function parseWheel(chunk) {
  const text = String(chunk ?? "");
  if (!text.includes("\u001b[<")) return [];
  const events = [];
  const re = /\u001b\[<(\d+);\d+;\d+([Mm])/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const button = Number(match[1]);
    if (button === 64) events.push({ dir: "up", rows: WHEEL_ROWS });
    else if (button === 65) events.push({ dir: "down", rows: WHEEL_ROWS });
    // Buttons 0-2 (click/drag) and 32-34 (motion) are not wheel events.
  }
  return events;
}

/**
 * Pull left-button presses out of a raw stdin chunk.
 *
 * SGR form is the same as the wheel's: ESC [ < button ; x ; y (M press | m
 * release), coordinates 1-based with (1,1) at the top-left of the screen. A
 * press is `M`; the `m` that follows a real click is the release and is not a
 * second click.
 *
 * Only button 0 with no modifier is a click. The low two bits are the button,
 * bit 6 is motion, and bits 2-4 are the shift/alt/ctrl held while pressing — a
 * drag (motion) or a modifier-chord is a different gesture, and treating one as
 * a click would open a sponsor's link for a gesture the user made for another
 * reason. A click with X10 trailing junk (button 2, right-click) is dropped for
 * the same reason.
 */
export function parseClicks(chunk) {
  const text = String(chunk ?? "");
  if (!text.includes("\u001b[<")) return [];
  const clicks = [];
  const re = /\u001b\[<(\d+);(\d+);(\d+)([Mm])/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match[4] !== "M") continue;
    if (Number(match[1]) !== 0) continue;
    clicks.push({ x: Number(match[2]), y: Number(match[3]) });
  }
  return clicks;
}

/**
 * Remove mouse reports from a chunk of terminal input.
 *
 * Enabling mouse reporting does not stop the sequences from ALSO arriving as
 * ordinary stdin bytes, and Ink hands those to `useInput` as typed text — so
 * without this a wheel flick types `[<64;40;10M` into the composer. Every key
 * handler therefore runs its input through here first and ignores what is left
 * when nothing is.
 */
export function stripMouse(text) {
  // The leading ESC is optional: a real terminal sends it, but Ink splits a
  // report into an escape keypress plus the body, so the body arrives here on
  // its own as literal text.
  return String(text ?? "").replace(/\u001b?\[<\d+;\d+;\d+[Mm]/g, "");
}

/** True when the chunk is nothing but mouse reports (so it is not input). */
export function isMouseOnly(text) {
  const raw = String(text ?? "");
  return raw.length > 0 && stripMouse(raw).length === 0;
}

/**
 * Apply wheel events to a scroll offset measured in rows from the BOTTOM.
 *
 * 0 means "following the newest line"; the offset can never go below 0 (there is
 * no content past the end) nor above `max` (the rows above the viewport). Pure,
 * so the clamping rules are testable without a terminal.
 */
export function applyWheel(offset, events, max) {
  let next = offset;
  for (const event of events) {
    next += event.dir === "up" ? event.rows : -event.rows;
  }
  return Math.min(Math.max(0, max), Math.max(0, next));
}

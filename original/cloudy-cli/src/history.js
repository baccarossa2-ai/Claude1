/**
 * Composer history — what ↑ and ↓ walk.
 *
 * A terminal chat has no scrollback inside the composer, so the only way to
 * re-send "that thing I typed four messages ago" is for the app to keep it. This
 * is the state that makes the arrow keys work, kept pure and separate because
 * the interesting behaviour is all edge cases: what happens at the oldest entry,
 * what happens when you press ↓ one time too many, and where the half-typed
 * draft goes while you are browsing.
 *
 * The shape is deliberately small:
 *
 *   entries  every non-empty message sent this session, oldest first
 *   index    how many entries back from the newest we are showing, or null when
 *            the user is editing their own draft
 *   draft    what to put back in the composer when browsing ends
 *   stashed  the half-typed draft, saved the moment browsing begins
 *
 * Nothing here touches the network or the terminal, so every rule below is
 * testable directly (tests/history.test.js).
 */

/** A fresh history. */
export function emptyHistory() {
  return { entries: [], index: null, draft: "", stashed: "" };
}

/**
 * Record a message that was actually sent. Blank sends are not history — the
 * composer already refuses to send an empty draft, and an empty entry would be
 * a ↑ press that appears to do nothing.
 *
 * Browsing ends here: the draft is gone, so there is nothing to return to, and
 * the newest entry is what the next ↑ should offer.
 */
export function recordSent(state, text) {
  const entry = String(text ?? "").trim();
  if (!entry) return { ...state, index: null, draft: "", stashed: "" };
  return {
    entries: [...state.entries, entry],
    index: null,
    draft: "",
    stashed: "",
  };
}

/** Forget where we were browsing without touching the entries. */
export function stopBrowsing(state) {
  return { ...state, index: null, stashed: "" };
}

/**
 * One arrow press. Returns the next state with `draft` already set to what the
 * composer should show, so the caller is a two-liner.
 *
 * ↑ from the draft stashes it and shows the newest entry; further presses walk
 * back and stop at the oldest (pressing ↑ again is a no-op rather than a wrap —
 * wrapping silently jumps from "the beginning of this session" to "the last
 * thing I said", which reads as a lost keystroke).
 *
 * ↓ walks forward, and the press AFTER the newest entry restores the stashed
 * draft and leaves browsing, so the arrow keys are a round trip.
 */
export function recall(state, direction) {
  const { entries } = state;
  if (!entries.length) return state;

  if (direction === "up") {
    const index = state.index === null ? 0 : Math.min(state.index + 1, entries.length - 1);
    return {
      ...state,
      index,
      // Only the first ↑ saves the draft; later presses must not overwrite it
      // with an entry we were just showing.
      stashed: state.index === null ? state.draft : state.stashed,
      draft: entries[entries.length - 1 - index],
    };
  }

  if (direction !== "down") return state;
  // ↓ does nothing while you are editing your own draft: there is no "newer"
  // than the thing you are typing.
  if (state.index === null) return state;

  const index = state.index - 1;
  if (index < 0) return { ...state, index: null, draft: state.stashed };
  return { ...state, index, draft: entries[entries.length - 1 - index] };
}

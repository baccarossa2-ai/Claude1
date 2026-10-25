/**
 * The one-hour session budget — one owner of the number, so the CLI mirrors
 * the server (core/src/app-server/methods/sessions.ts) without a second
 * hand-written constant drifting apart from it.
 */
export const SESSION_BUDGET_MS = 60 * 60_000;

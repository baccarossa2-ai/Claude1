# cloudy CLI

Chat with Cloudy models from your terminal. The TUI has no runtime
dependencies beyond `ink` + `react` (installed by the repo's workspaces); the
stdio host is bundled so an editor can spawn it under plain Node 18+. It talks
to the same API as the web and desktop apps, so the same account, models, and
quota limits apply.

## Install it

```bash
npm install -g cloudy-cli          # puts `cloudy` on your PATH
cloudy login                       # approve the code in your browser
```

Node 18 or newer. The published tarball carries the TUI sources, the bundled
stdio hosts and the two runtime dependencies (`ink`, `react`) — nothing else,
and no dependency on this repository. The bundles' source maps stay out of the
tarball on purpose: they inline the full source of `cloudy-core`, which is a
private workspace package. MIT licensed (`cli/LICENSE`).

## Run it from the checkout

For work on the CLI itself:

```bash
node cli/bin/cloudy.mjs            # from the repo root
```

Or link it:

```bash
cd cli && npm link                 # installs `cloudy` on your PATH
```

Publishing is `cd cli && npm publish`: `prepublishOnly` rebuilds `dist/`, which
is not committed, so a tarball can never ship without the stdio host. Check the
exact file list first with `npm publish --dry-run` (18 files, ~99 kB).

## Updates

An **installed** copy (a global npm install) checks the registry once a day and
installs a newer version in place; the new version runs on the next launch, and
the launch says which happened. What it will not do:

- It never updates a **source checkout** — `node cli/bin/cloudy.mjs` is someone's
  working tree, so a registry copy is never installed over it.
- It never runs in a **script**: a non-TTY run (or `CI`) is not a person waiting.
- It never **escalates**: if the npm global prefix is not writable, it prints the
  `npm install -g …` command instead of asking for a password.
- It never leaves you without a CLI: an unreachable registry, a slow npm, a
  failed install — all are a line of text, and the retry is tomorrow.

`CLOUDY_NO_UPDATE=1` turns the whole thing off. The policy is pure and lives in
`src/update.js` (`tests/update.test.js` covers every refusal above).

`cloudy serve --stdio` and `cloudy import` load bundled artifacts, so build once
first (this is also what `vscode`'s build does for its bundled host):

```bash
npm run build --workspace=cloudy-cli   # → cli/dist/serve.cjs, cli/dist/import.cjs
```

## Sign in

```bash
cloudy login                       # browser pairing (default)
cloudy login                       # then choose [e]mail for password login
```

Browser pairing prints a code and opens `https://…/link?code=XXXX-XXXX`;
approve it in your signed-in browser session and the CLI lands a device
token (stored at `~/.config/cloudy/config.json`, mode 0600).

## Commands

| command        | what it does                                  |
| -------------- | --------------------------------------------- |
| `cloudy`       | interactive chat loop                         |
| `cloudy ask …` | one question, print the answer, exit          |
| `cloudy login` | sign in (browser pairing or email+password)   |
| `cloudy models`| list the model registry                       |
| `cloudy usage` | today + this week's quota                     |
| `cloudy whoami`| the signed-in account                         |
| `cloudy serve --stdio` | JSON-RPC host editors spawn (VS Code) |

In the chat loop: `/model [name]` switch, `/new` fresh conversation,
`/effort [level]` reasoning effort, `/skills` what this workspace teaches the
agent, `/mcps` the plugin servers and whether they are running,
`/sponsor [on|off]` hide the sponsor card for this session,
`/import [apply]` bring skills and plugin servers over from Claude Code, Cursor
or VS Code, `/usage`, `/whoami`, `/help`, `/quit`.

Keys: **↑ / ↓ recall what you have sent** (the draft you were typing comes back
when you walk past the newest entry), `ctrl+o` model, `ctrl+t` usage, `ctrl+w`
account, `ctrl+n` new chat, `ctrl+l` login, `ctrl+u` clear, `ctrl+c` twice to
quit.

Two things the card does deliberately:

- **It opens on a click, never on Enter.** Enter is the key that sends and
  confirms, so binding the card to it reported clicks nobody made — and a
  sponsor is billed for those. Click the card to open it, `esc` to dismiss it.
- **It is the only coloured thing on screen.** The border and the CTA strip take
  the advertiser's accent, and the model dot in the status row takes the active
  model's. Both come from the token set (`theme/tokens.mjs` → the generated
  `src/tokens.js`), so the CLI has no colour of its own and the design-system
  check still owns every literal.

A first run with no model chosen opens the model picker instead of silently
picking the first one on the list; the choice is remembered in the config.

## Configuration

`~/.config/cloudy/config.json` (override the directory with
`XDG_CONFIG_HOME`):

```json
{ "token": "cdy_…", "base": "http://localhost:3000", "model": "glm-5.3-flash" }
```

`base` defaults to `CLOUDY_API_URL` or `http://localhost:3000`. The chat
loop remembers the last `/model` pick here too.

## Tests

```bash
cd cli && npm test                 # node --test, no framework
```

Covers the parts that have shipped bugs or carry a contract: usage and
credit formatting (`tests/usage.test.js`), argument dispatch including
`serve` (`tests/args.test.js`), the stdio host's newline JSON-RPC framing
and error path (`tests/serve.test.js`), the composer's ↑/↓ rules
(`tests/history.test.js`), every update refusal (`tests/update.test.js`), and
the TUI's rendering at 80x24 and 120x40 (`tests/tui.test.js`).

`tests/pty.test.js` runs the TUI in a **real PTY** and replays the captured
bytes through a screen model, asserting the frame never wraps and is never
pushed off the top. It drives the PTY with `tests/pty-capture.py` and skips
itself when `python3` is unavailable; `CLOUDY_PTY_DEBUG=1` dumps each
captured stage to `/tmp/cloudy-pty-*.txt`.

## Quota

The CLI is metered exactly like the web app: 25 messages a day (125 a week),
and the server's 429 copy — including the reset time — is printed as-is. Agent
turns spend agent credits instead — each turn costs the model's own price
(`lib/models.ts`, 2–20 credits; 70 a day · 350 a week). Both caps come from `lib/plans.ts` —
the CLI holds no numbers of its own. Failed sends are refunded server-side,
never retried by the CLI.

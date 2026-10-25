#!/usr/bin/env node
/**
 * cloudy — chat with Cloudy models from your terminal.
 *
 * Three entry points, loaded lazily so each pays only for what it needs:
 *   cloudy                    the chat TUI (ink + react)
 *   cloudy serve --stdio      the app-server host editors spawn (no UI deps)
 *   cloudy import             host-side cross-agent import (no UI deps)
 *
 * Same auth and API as the desktop app: device tokens via email+password or
 * the browser pairing flow, Bearer on every request, quota walls surfaced as-is.
 */

const argv = process.argv.slice(2);

try {
  if (argv[0] === "serve" || argv[0] === "import") {
    // Built artifacts: both bundle the shared app-server, which is TypeScript.
    const { run } = await import(`../dist/${argv[0]}.cjs`);
    await run(argv.slice(1));
  } else {
    const { main } = await import("../src/main.js");
    await main(argv);
  }
} catch (err) {
  const message = err?.message ?? String(err);
  if ((argv[0] === "serve" || argv[0] === "import") && /Cannot find module|ERR_MODULE_NOT_FOUND/.test(String(err?.code) + message)) {
    console.error("cloudy: the stdio host is not built — run `npm run build` in cli/");
  } else {
    console.error("cloudy: " + message);
  }
  process.exit(1);
}

// Bundles the renderer (app/) into www/ — the folder Electron loads and
// Capacitor ships inside the APK. `--serve` starts a dev server on :5173.
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "www");
const serve = process.argv.includes("--serve");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const engine = JSON.parse(fs.readFileSync(path.join(root, "original/cloudy-cli/package.json"), "utf8"));

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(root, "app/assets"), path.join(out, "assets"), { recursive: true });
fs.copyFileSync(path.join(root, "app/index.html"), path.join(out, "index.html"));

const options = {
  entryPoints: { app: path.join(root, "app/src/main.jsx"), styles: path.join(root, "app/styles/index.css") },
  outdir: out,
  bundle: true,
  format: "esm",
  splitting: false,
  target: ["chrome120"],
  jsx: "automatic",
  minify: !serve && !process.argv.includes("--dev"),
  sourcemap: serve || process.argv.includes("--dev") ? "inline" : false,
  legalComments: "none",
  loader: { ".woff2": "file", ".woff": "file", ".svg": "file", ".png": "file", ".md": "text" },
  assetNames: "assets/fonts/[name]-[hash]",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __ENGINE_VERSION__: JSON.stringify(engine.version),
    "process.env.NODE_ENV": JSON.stringify(serve ? "development" : "production"),
    // original/cloudy-cli/src/tokens.js gates ANSI on the TTY; the GUI has none.
    "process.stdout.isTTY": "false",
  },
  // v86 and the Cloudee runtime are loaded at runtime from assets/vendor,
  // never bundled: the emulator is 2 MB of wasm glue the chat must not wait for.
  external: ["/assets/*", "./assets/*"],
  logLevel: "info",
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: out, port: 5173 });
  console.log(`dev server: http://localhost:${port}`);
} else {
  await esbuild.build(options);
  const size = (f) => (fs.statSync(path.join(out, f)).size / 1024).toFixed(0) + " kB";
  console.log("www/app.js", size("app.js"), "· www/styles.css", size("styles.css"));
}

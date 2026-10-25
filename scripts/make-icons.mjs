// Renders the real Cloudee mascot (the avatar runtime shipped by cloudy.chat)
// into every icon and installer graphic the desktop and Android builds need.
// Needs Playwright's Chromium and ImageMagick (`convert`).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(root, "build");
fs.mkdirSync(buildDir, { recursive: true });

const MIME = { ".mjs": "text/javascript", ".js": "text/javascript", ".html": "text/html", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(root) || !fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// One page that can draw any of our compositions; `mode` picks the layout.
const page_html = (mode, w, h) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:transparent;font-family:"Segoe UI",Inter,Arial,sans-serif}
  .tile{position:absolute;inset:0;border-radius:${Math.round(w * 0.22)}px;
    background:radial-gradient(120% 90% at 30% 15%,#3b4a7a 0%,#1a2038 45%,#0b0d16 100%);
    box-shadow:inset 0 0 0 ${Math.max(1, w * 0.01)}px rgba(255,255,255,.08)}
  .glow{position:absolute;left:15%;top:22%;width:70%;height:60%;border-radius:50%;
    background:radial-gradient(closest-side,rgba(150,180,255,.35),transparent);filter:blur(${w * 0.03}px)}
  .full{position:absolute;inset:0;background:linear-gradient(165deg,#22294a 0%,#11152a 55%,#07080f 100%)}
  .stars{position:absolute;inset:0;background-image:radial-gradient(1px 1px at 20% 30%,#fff8,transparent),radial-gradient(1px 1px at 70% 20%,#fff6,transparent),radial-gradient(1.5px 1.5px at 40% 75%,#fff5,transparent),radial-gradient(1px 1px at 85% 60%,#fff7,transparent),radial-gradient(1px 1px at 10% 85%,#fff5,transparent)}
  #av{position:absolute}
  .word{position:absolute;color:#f2f3f5;font-weight:700;letter-spacing:.5px}
  .sub{position:absolute;color:#9aa6c8;font-size:11px}
</style></head><body>
  ${mode === "tile" ? '<div class="tile"></div><div class="glow"></div>' : ""}
  ${mode === "sidebar" || mode === "header" || mode === "splash" ? '<div class="full"></div><div class="stars"></div>' : ""}
  <div id="av"></div>
  ${mode === "sidebar" ? `<div class="word" style="left:0;right:0;text-align:center;top:${h * 0.62}px;font-size:26px">Cloudy</div><div class="sub" style="left:0;right:0;text-align:center;top:${h * 0.62 + 36}px">Chat · Code · Cowork</div>` : ""}
  ${mode === "header" ? `<div class="word" style="left:58px;top:16px;font-size:20px">Cloudy</div>` : ""}
  ${mode === "splash" ? `<div class="word" style="left:0;right:0;text-align:center;top:${h * 0.6}px;font-size:${w * 0.07}px">Cloudy</div>` : ""}
  <script type="module">
    import { createAvatar } from "${base}/app/assets/vendor/cloudee-avatar.mjs";
    const el = document.getElementById("av");
    const layout = ${JSON.stringify({ mode, w, h })};
    let size, x, y;
    if (layout.mode === "tile") { size = layout.w * 0.78; x = (layout.w - size) / 2; y = (layout.h - size) / 2 + layout.h * 0.02; }
    else if (layout.mode === "bare" || layout.mode === "fg") { size = layout.w * (layout.mode === "fg" ? 0.62 : 0.98); x = (layout.w - size) / 2; y = (layout.h - size) / 2; }
    else if (layout.mode === "sidebar") { size = layout.w * 0.8; x = (layout.w - size) / 2; y = layout.h * 0.2; }
    else if (layout.mode === "header") { size = 50; x = 4; y = 4; }
    else { size = layout.w * 0.38; x = (layout.w - size) / 2; y = layout.h * 0.2; }
    Object.assign(el.style, { left: x + "px", top: y + "px", width: size + "px", height: size + "px" });
    const api = createAvatar(el, { animation: "idle", autoplay: false, size: "100%" });
    api.holdRest();
    setTimeout(() => (document.title = "ready"), 900);
  </script></body></html>`;

const browser = await chromium.launch();
async function shot(mode, w, h, out) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  const file = path.join(buildDir, `_tmp_${mode}.html`);
  fs.writeFileSync(file, page_html(mode, w, h));
  await p.goto(`${base}/build/_tmp_${mode}.html`);
  await p.waitForFunction(() => document.title === "ready");
  await p.screenshot({ path: out, omitBackground: true });
  await p.close();
  fs.rmSync(file);
}

await shot("tile", 1024, 1024, path.join(buildDir, "icon.png"));
await shot("bare", 1024, 1024, path.join(buildDir, "cloudee.png"));
await shot("fg", 432, 432, path.join(buildDir, "android-foreground.png"));
await shot("sidebar", 164, 314, path.join(buildDir, "installerSidebar.png"));
await shot("header", 150, 57, path.join(buildDir, "installerHeader.png"));
await shot("splash", 1280, 1280, path.join(buildDir, "splash.png"));
await browser.close();
server.close();

const cv = (...args) => execFileSync("convert", args, { stdio: "inherit" });
cv(path.join(buildDir, "icon.png"), "-define", "icon:auto-resize=256,128,64,48,32,24,16", path.join(buildDir, "icon.ico"));
// NSIS wants 24-bit BMPs with no alpha.
for (const n of ["installerSidebar", "installerHeader"]) {
  cv(path.join(buildDir, `${n}.png`), "-background", "#11152a", "-flatten", "-type", "TrueColor", `BMP3:${path.join(buildDir, n + ".bmp")}`);
}
fs.copyFileSync(path.join(buildDir, "installerSidebar.bmp"), path.join(buildDir, "uninstallerSidebar.bmp"));
cv(path.join(buildDir, "icon.png"), "-resize", "512x512", path.join(root, "app/assets/logos/cloudy-app.png"));
cv(path.join(buildDir, "cloudee.png"), "-resize", "256x256", path.join(root, "app/assets/logos/cloudee-256.png"));
console.log("icons written to", buildDir);

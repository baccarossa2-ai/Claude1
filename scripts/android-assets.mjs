// Launcher icons (legacy, round, adaptive foreground) and splash screens for
// the Android project, from the Cloudee renders in build/ (scripts/make-icons.mjs).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const res = path.join(root, "android/app/src/main/res");
const build = path.join(root, "build");
const cv = (...a) => execFileSync("convert", a, { stdio: "inherit" });

const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENS)) {
  const dir = path.join(res, `mipmap-${d}`);
  fs.mkdirSync(dir, { recursive: true });
  const icon = Math.round(48 * k);
  const fg = Math.round(108 * k);
  cv(path.join(build, "icon.png"), "-resize", `${icon}x${icon}`, path.join(dir, "ic_launcher.png"));
  cv(path.join(build, "icon.png"), "-resize", `${icon}x${icon}`, "(", "+clone", "-alpha", "extract", "-fill", "black", "-colorize", "100", "-fill", "white", "-draw", `circle ${icon / 2},${icon / 2} ${icon / 2},0`, ")", "-alpha", "off", "-compose", "CopyOpacity", "-composite", path.join(dir, "ic_launcher_round.png"));
  cv(path.join(build, "android-foreground.png"), "-resize", `${fg}x${fg}`, path.join(dir, "ic_launcher_foreground.png"));
}

const PORT = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
// WebP keeps the gradients smooth at a fraction of PNG's size (Android reads it natively).
const splash = (w, h, out) => {
  cv("-size", `${w}x${h}`, "xc:#07080f", "(", path.join(build, "splash.png"), "-resize", `${Math.round(Math.min(w, h) * 0.92)}x`, ")", "-gravity", "center", "-composite", "-quality", "86", out.replace(/\.png$/, ".webp"));
  fs.rmSync(out, { force: true });
};
for (const [d, [w, h]] of Object.entries(PORT)) {
  for (const [orient, W, H] of [["port", w, h], ["land", h, w]]) {
    const dir = path.join(res, `drawable-${orient}-${d}`);
    fs.mkdirSync(dir, { recursive: true });
    splash(W, H, path.join(dir, "splash.png"));
  }
}
splash(480, 800, path.join(res, "drawable", "splash.png"));
console.log("android assets written");

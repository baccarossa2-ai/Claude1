// Copies the v86 emulator build from node_modules and downloads the BIOS files
// and the Buildroot Linux kernel the AI's own Linux computer boots from.
// Usage: node scripts/fetch-v86.mjs [--from <dir-with-already-downloaded-files>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "app/assets/vendor/v86");
fs.mkdirSync(out, { recursive: true });

for (const f of ["libv86.mjs", "v86.wasm"]) {
  fs.copyFileSync(path.join(root, "node_modules/v86/build", f), path.join(out, f));
}
fs.copyFileSync(path.join(root, "node_modules/v86/LICENSE"), path.join(out, "LICENSE.v86.txt"));

const remote = {
  "seabios.bin": "https://copy.sh/v86/bios/seabios.bin",
  "vgabios.bin": "https://copy.sh/v86/bios/vgabios.bin",
  "linux.bin": "https://i.copy.sh/buildroot-bzimage68.bin",
};
const fromIdx = process.argv.indexOf("--from");
const fromDir = fromIdx > 0 ? process.argv[fromIdx + 1] : null;

for (const [name, url] of Object.entries(remote)) {
  const dest = path.join(out, name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) continue;
  const local = fromDir && [name, path.basename(url)].map((n) => path.join(fromDir, n)).find((p) => fs.existsSync(p));
  if (local) {
    fs.copyFileSync(local, dest);
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed ${url}: ${res.status}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
  console.log("ok", name, fs.statSync(dest).size);
}
console.log("v86 assets in", out);

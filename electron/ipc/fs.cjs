// Workspace file access. The renderer names a root and a relative path; this
// module only touches roots the user picked in a folder dialog (remembered in
// userData/workspaces.json) and refuses any path — symlinks included — that
// resolves outside the root.
const { app, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const rootsFile = () => path.join(app.getPath("userData"), "workspaces.json");
let roots = null;

function approvedRoots() {
  if (!roots) {
    try {
      roots = new Set(JSON.parse(fs.readFileSync(rootsFile(), "utf8")));
    } catch {
      roots = new Set();
    }
  }
  return roots;
}

function approveRoot(dir) {
  const real = fs.realpathSync(dir);
  approvedRoots().add(real);
  fs.mkdirSync(path.dirname(rootsFile()), { recursive: true });
  fs.writeFileSync(rootsFile(), JSON.stringify([...approvedRoots()], null, 2));
  return real;
}

function checkRoot(root) {
  if (!root) throw new Error("Nessuna cartella di lavoro");
  let real;
  try {
    real = fs.realpathSync(root);
  } catch {
    throw new Error(`La cartella di lavoro non esiste più: ${root}`);
  }
  if (!approvedRoots().has(real)) throw new Error("Cartella non autorizzata: sceglila di nuovo con il pulsante della cartella.");
  return real;
}

function inside(base, target) {
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function resolve(root, rel) {
  const base = checkRoot(root);
  const target = path.resolve(base, rel || ".");
  if (!inside(base, target)) throw new Error(`"${rel}" è fuori dalla cartella di lavoro`);
  // Follow symlinks for anything that already exists (and for the parent of
  // anything about to be created) and re-check confinement.
  let probe = target;
  while (!fs.existsSync(probe) && probe !== base) probe = path.dirname(probe);
  if (!inside(base, fs.realpathSync(probe))) throw new Error(`"${rel}" punta fuori dalla cartella di lavoro`);
  return target;
}

const MAX_READ = 50 * 1024 * 1024;

function register() {
  // End-to-end tests pre-approve their fixture folder (no dialog to click).
  if (process.env.CLOUDY_TEST_WORKSPACE) approveRoot(process.env.CLOUDY_TEST_WORKSPACE);
  ipcMain.handle("dialog:pickFolder", async (e) => {
    const res = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"], title: "Scegli la cartella di lavoro" });
    if (res.canceled || !res.filePaths[0]) return null;
    return approveRoot(res.filePaths[0]);
  });

  ipcMain.handle("fs:list", async (_e, root, rel) => {
    const dir = resolve(root, rel);
    const out = [];
    for (const d of await fs.promises.readdir(dir, { withFileTypes: true })) {
      let size = 0;
      let mtime = 0;
      try {
        const st = await fs.promises.stat(path.join(dir, d.name));
        size = st.size;
        mtime = st.mtimeMs;
      } catch {
        /* broken link */
      }
      out.push({ name: d.name, type: d.isDirectory() ? "dir" : "file", size, mtime });
    }
    return out;
  });

  ipcMain.handle("fs:read", async (_e, root, rel, encoding = "utf8") => {
    const file = resolve(root, rel);
    const st = await fs.promises.stat(file);
    if (st.isDirectory()) throw new Error(`"${rel}" è una cartella`);
    if (st.size > MAX_READ) throw new Error(`"${rel}" è troppo grande (${Math.round(st.size / 1048576)} MB)`);
    const buf = await fs.promises.readFile(file);
    return encoding === "base64" ? buf.toString("base64") : buf.toString("utf8");
  });

  ipcMain.handle("fs:write", async (_e, root, rel, data, encoding = "utf8") => {
    const file = resolve(root, rel);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, encoding === "base64" ? Buffer.from(data, "base64") : String(data));
    return true;
  });

  ipcMain.handle("fs:mkdir", async (_e, root, rel) => {
    await fs.promises.mkdir(resolve(root, rel), { recursive: true });
    return true;
  });

  ipcMain.handle("fs:remove", async (_e, root, rel) => {
    const target = resolve(root, rel);
    if (target === checkRoot(root)) throw new Error("Non posso eliminare la cartella di lavoro stessa");
    await fs.promises.rm(target, { recursive: true, force: false });
    return true;
  });

  ipcMain.handle("fs:move", async (_e, root, from, to) => {
    const a = resolve(root, from);
    const b = resolve(root, to);
    await fs.promises.mkdir(path.dirname(b), { recursive: true });
    await fs.promises.rename(a, b);
    return true;
  });

  ipcMain.handle("fs:stat", async (_e, root, rel) => {
    try {
      const st = await fs.promises.stat(resolve(root, rel));
      return { type: st.isDirectory() ? "dir" : "file", size: st.size, mtime: st.mtimeMs };
    } catch {
      return null;
    }
  });

  ipcMain.handle("fs:reveal", async (_e, root, rel) => {
    const target = resolve(root, rel);
    if (fs.statSync(target).isDirectory()) await shell.openPath(target);
    else shell.showItemInFolder(target);
    return true;
  });
}

module.exports = { register, checkRoot, approveRoot, approvedRoots };

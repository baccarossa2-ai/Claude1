// Shell commands for the agent (run_command / self_test) and the WSL bridge.
// Windows runs PowerShell, everything else the user's login shell. The cwd is
// always an approved workspace root.
const { ipcMain } = require("electron");
const { spawn, execFile } = require("node:child_process");
const os = require("node:os");
const { checkRoot } = require("./fs.cjs");

const CAP = 400 * 1024;
const running = new Map();

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {});
  else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

function register() {
  ipcMain.handle("shell:exec", (e, { command, cwd, timeoutMs = 120000, wsl = false, id }) => {
    return new Promise((resolve) => {
      let file;
      let args;
      if (wsl) {
        file = "wsl.exe";
        args = ["-e", "bash", "-lc", command];
      } else if (process.platform === "win32") {
        file = "powershell.exe";
        args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; " + command];
      } else {
        file = process.env.SHELL || "/bin/bash";
        args = ["-lc", command];
      }
      let dir = os.homedir();
      if (cwd) {
        try {
          dir = checkRoot(cwd);
        } catch (err) {
          return resolve({ code: 1, stdout: "", stderr: err.message, timedOut: false });
        }
      }
      let child;
      try {
        child = spawn(file, args, { cwd: dir, env: { ...process.env, CLOUDY_DESKTOP: "1" }, windowsHide: true, detached: process.platform !== "win32" });
      } catch (err) {
        return resolve({ code: 127, stdout: "", stderr: err.message, timedOut: false });
      }
      if (id) running.set(id, child);
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const push = (which, d) => {
        const s = d.toString("utf8");
        if (which === "out") stdout = (stdout + s).slice(-CAP);
        else stderr = (stderr + s).slice(-CAP);
        if (id && !e.sender.isDestroyed()) e.sender.send("shell:output", { id, stream: which, chunk: s });
      };
      child.stdout.on("data", (d) => push("out", d));
      child.stderr.on("data", (d) => push("err", d));
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, timeoutMs);
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ code: 127, stdout, stderr: stderr + err.message, timedOut });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (id) running.delete(id);
        resolve({ code, stdout, stderr, timedOut });
      });
    });
  });

  ipcMain.handle("shell:kill", (_e, id) => {
    killTree(running.get(id));
    running.delete(id);
    return true;
  });
}

module.exports = { register, killTree };

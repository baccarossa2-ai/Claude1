// The AI's own Linux computer: a real Linux 6.8 (Buildroot, i686) booted by
// the v86 emulator inside the app — no install, no network needed, the same
// on Windows and Android. The serial console is the terminal the user watches;
// exec() types commands into it and reads the output back between markers.
// /mnt is a 9p share whose files are saved to IndexedDB, so the AI's home
// folder survives restarts.
import { dbGet, dbSet } from "../lib/db.js";
import { b64ToBytes, bytesToB64 } from "../platform/http.js";
import { invoke, isDesktop, osName } from "../platform/native.js";

const ASSETS = "assets/vendor/v86/";
const PROMPT_RE = /(?:~|\/[^\s]*)\s?[%#$] $/;
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][A-Z0-9]|\x1b[=>]/g;
const FILES_KEY = "linux:mnt";
const MAX_SAVED_BYTES = 40 * 1024 * 1024;

/**
 * What the user sees in the terminal: the raw console minus the plumbing.
 * Marker lines (__CS_/__CE_) vanish and the typed `__c <id>` becomes a
 * coloured "▶ command" header, so the console reads like a person typing.
 */
class DisplayFilter {
  constructor(emit) {
    this.emit = emit;
    this.pending = "";
    this.heldBlank = false;
    this.labels = new Map();
    this.timer = null;
  }
  label(id, command) {
    const first = String(command).split("\n").find((l) => l.trim()) || command;
    this.labels.set(id, first.length > 160 ? first.slice(0, 157) + "…" : first);
  }
  line(raw) {
    const plain = raw.replace(ANSI_RE, "").replace(/\r/g, "");
    if (/^\s*__C[SE]_[a-z0-9]+(?: \d+)?\s*$/.test(plain)) {
      this.heldBlank = false;
      return;
    }
    const echo = /__c ([a-z0-9]+)\s*$/.exec(plain);
    if (this.heldBlank) {
      this.heldBlank = false;
      this.emit("\r\n");
    }
    if (echo) {
      const before = plain.slice(0, echo.index);
      this.emit(`${before.replace(/\s+$/, "") ? "" : ""}\x1b[38;5;111m▶ ${this.labels.get(echo[1]) || "comando"}\x1b[0m\r\n`);
      this.labels.delete(echo[1]);
      return;
    }
    if (!plain.trim()) {
      this.heldBlank = true;
      return;
    }
    this.emit(raw.replace(/\r?$/, "") + "\r\n");
  }
  push(text) {
    this.pending += text;
    let nl;
    while ((nl = this.pending.indexOf("\n")) !== -1) {
      this.line(this.pending.slice(0, nl));
      this.pending = this.pending.slice(nl + 1);
    }
    clearTimeout(this.timer);
    const tail = this.pending.replace(ANSI_RE, "");
    // A tail that could still become plumbing waits a moment; anything else
    // (a prompt, the user's own typing) shows immediately.
    if (/(^|\s)_{1,2}(c|C|c [a-z0-9]*)?$/.test(tail) || /__C[SE]?_?[a-z0-9]*$/.test(tail)) {
      this.timer = setTimeout(() => this.flushTail(), 400);
    } else this.flushTail();
  }
  flushTail() {
    if (!this.pending) return;
    if (this.heldBlank) {
      this.heldBlank = false;
      this.emit("\r\n");
    }
    this.emit(this.pending);
    this.pending = "";
  }
}

class LinuxComputer {
  constructor() {
    this.status = "off"; // off | booting | ready | error
    this.error = null;
    this.emulator = null;
    this.listeners = new Set(); // filtered console output (terminal)
    this.display = "";
    this.filter = new DisplayFilter((t) => {
      this.display = (this.display + t).slice(-200000);
      for (const fn of this.listeners) fn(t);
    });
    this.statusListeners = new Set();
    this.buffer = "";
    this.queue = Promise.resolve();
    this.bootedAt = 0;
    this.options = { memoryMB: 128, network: "none", relayUrl: "" };
    this.dirty = false;
  }

  configure(opts) {
    this.options = { ...this.options, ...opts };
  }

  onOutput(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn) {
    this.statusListeners.add(fn);
    fn(this.status, this.error);
    return () => this.statusListeners.delete(fn);
  }

  setStatus(s, err = null) {
    this.status = s;
    this.error = err;
    for (const fn of this.statusListeners) fn(s, err);
  }

  /** Raw keystrokes from the terminal UI. */
  input(text) {
    this.emulator?.serial0_send(text);
  }

  async boot() {
    if (this.status === "ready" || this.status === "booting") return this.ready;
    this.setStatus("booting");
    this.ready = (async () => {
      try {
        const base = new URL(ASSETS, location.href).href;
        const { V86 } = await import(/* webpackIgnore: true */ base + "libv86.mjs");
        const net =
          this.options.network === "fetch"
            ? { net_device: { type: "virtio", relay_url: "fetch" } }
            : this.options.network === "relay" && this.options.relayUrl
              ? { net_device: { type: "virtio", relay_url: this.options.relayUrl } }
              : {};
        const emulator = new V86({
          wasm_path: base + "v86.wasm",
          memory_size: this.options.memoryMB * 1024 * 1024,
          vga_memory_size: 2 * 1024 * 1024,
          bios: { url: base + "seabios.bin" },
          vga_bios: { url: base + "vgabios.bin" },
          bzimage: { url: base + "linux.bin" },
          cmdline: "tsc=reliable mitigations=off random.trust_cpu=on console=ttyS0",
          filesystem: {},
          autostart: true,
          disable_keyboard: true,
          disable_mouse: true,
          disable_speaker: true,
          ...net,
        });
        this.emulator = emulator;
        const decoder = new TextDecoder();
        let pending = [];
        let flush = null;
        emulator.add_listener("serial0-output-byte", (byte) => {
          pending.push(byte);
          if (!flush)
            flush = setTimeout(() => {
              const text = decoder.decode(new Uint8Array(pending), { stream: true });
              pending = [];
              flush = null;
              this.buffer = (this.buffer + text).slice(-400000);
              this.filter.push(text);
              this.waiters?.forEach((w) => w());
            }, 4);
        });
        await this.waitFor(() => PROMPT_RE.test(this.buffer.replace(ANSI_RE, "")), 180000, "avvio di Linux");
        await this.restoreShared();
        // __c <id>: run the queued script between two markers (see run()).
        this.emulator.serial0_send(`__c() { printf '\\n__C%s_%s\\n' S "$1"; . /mnt/.cloudy/cmd.sh; printf '\\n__C%s_%s %s\\n' E "$1" $?; }\n`);
        // A friendlier shell: a home folder on the persistent share.
        await this.run("mkdir -p /mnt/home && export HOME=/mnt/home PS1='cloudy@linux:\\w# ' && cd /mnt/home && clear", 15000, true);
        this.bootedAt = Date.now();
        this.setStatus("ready");
        this.autosave = setInterval(() => this.dirty && this.saveShared(), 30000);
      } catch (e) {
        this.setStatus("error", e?.message || String(e));
        throw e;
      }
    })();
    return this.ready;
  }

  waitFor(pred, timeoutMs, what) {
    return new Promise((resolve, reject) => {
      this.waiters = this.waiters || new Set();
      const check = () => {
        if (pred()) {
          this.waiters.delete(check);
          clearTimeout(t);
          resolve();
        }
      };
      const t = setTimeout(() => {
        this.waiters.delete(check);
        reject(new Error(`Tempo scaduto durante ${what}`));
      }, timeoutMs);
      this.waiters.add(check);
      check();
    });
  }

  /**
   * Type a command into the shell and capture its output. The markers are
   * printed with printf so the echoed command line never contains them.
   */
  run(command, timeoutMs = 120000, internal = false) {
    const job = this.queue.then(async () => {
      const id = Math.random().toString(36).slice(2, 10);
      const start = `__CS_${id}`;
      const endRe = new RegExp(`__CE_${id} (\\d+)`);
      const startAt = this.buffer.length;
      // The command travels through the 9p share as a script and is SOURCED,
      // so multi-line commands and heredocs work and `cd`/`export` persist;
      // the one line typed into the console is short and holds no marker.
      this.mkdirp("/.cloudy");
      await this.emulator.create_file("/.cloudy/cmd.sh", new TextEncoder().encode(command + "\n"));
      if (!internal) this.filter.label(id, command);
      this.emulator.serial0_send(`__c ${id}\n`);
      let timedOut = false;
      try {
        await this.waitFor(() => endRe.test(this.buffer.slice(startAt)), timeoutMs, "l'esecuzione del comando");
      } catch {
        timedOut = true;
        this.emulator.serial0_send("\x03");
        await new Promise((r) => setTimeout(r, 300));
      }
      const chunk = this.buffer.slice(startAt).replace(ANSI_RE, "").replace(/\r/g, "");
      const s = chunk.indexOf(start);
      const m = endRe.exec(chunk);
      let out = s >= 0 ? chunk.slice(s + start.length, m ? m.index : undefined) : chunk;
      out = out.replace(/^\n/, "").replace(/\n$/, "");
      if (!internal) this.dirty = true;
      return { output: out, code: m ? Number(m[1]) : null, timedOut };
    });
    this.queue = job.catch(() => {});
    return job;
  }

  async exec(command, timeoutMs) {
    await this.boot();
    return this.run(command, timeoutMs);
  }

  // ---- the /mnt share (9p) ----

  fs() {
    return this.emulator?.fs9p;
  }

  mkdirp(dir) {
    const fs = this.fs();
    let parent = 0;
    let path = "";
    for (const seg of dir.split("/").filter(Boolean)) {
      path += "/" + seg;
      const found = fs.SearchPath(path);
      parent = found.id === -1 ? fs.CreateDirectory(seg, parent) : found.id;
    }
    return parent;
  }

  /** Write a file into the share; `path` is relative to /mnt. */
  async writeFile(path, data) {
    await this.boot();
    const clean = "/" + String(path).replace(/^\/?mnt\/?/, "").replace(/^\/+/, "");
    const dir = clean.slice(0, clean.lastIndexOf("/"));
    if (dir) this.mkdirp(dir);
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    await this.emulator.create_file(clean, bytes);
    this.dirty = true;
    return "/mnt" + clean;
  }

  async readFile(path) {
    await this.boot();
    const clean = "/" + String(path).replace(/^\/?mnt\/?/, "").replace(/^\/+/, "");
    return this.emulator.read_file(clean);
  }

  listShared(dir = "/") {
    const fs = this.fs();
    if (!fs) return [];
    const out = [];
    const walk = (d) => {
      const names = fs.read_dir(d) || [];
      for (const n of names) {
        const p = (d === "/" ? "" : d) + "/" + n;
        const info = fs.SearchPath(p);
        if (info.id === -1) continue;
        if (fs.IsDirectory(info.id)) {
          out.push({ path: p, dir: true });
          walk(p);
        } else out.push({ path: p, dir: false, size: fs.GetInode(info.id).size });
      }
    };
    walk(dir);
    return out;
  }

  async saveShared() {
    if (!this.emulator) return;
    this.dirty = false;
    try {
      const files = {};
      let total = 0;
      for (const e of this.listShared()) {
        if (e.dir) {
          files[e.path] = null;
          continue;
        }
        if (total + e.size > MAX_SAVED_BYTES) continue;
        const bytes = await this.emulator.read_file(e.path);
        total += bytes.length;
        files[e.path] = bytesToB64(bytes);
      }
      await dbSet(FILES_KEY, files);
    } catch {
      this.dirty = true;
    }
  }

  async restoreShared() {
    const files = (await dbGet(FILES_KEY)) || {};
    for (const [p, b64] of Object.entries(files)) {
      try {
        if (b64 === null) this.mkdirp(p);
        else {
          const dir = p.slice(0, p.lastIndexOf("/"));
          if (dir) this.mkdirp(dir);
          await this.emulator.create_file(p, b64ToBytes(b64));
        }
      } catch {
        /* one bad entry must not stop the boot */
      }
    }
  }

  async shutdown() {
    clearInterval(this.autosave);
    await this.saveShared();
    try {
      this.emulator?.stop();
      this.emulator?.destroy?.();
    } catch {
      /* already gone */
    }
    this.emulator = null;
    this.buffer = "";
    this.display = "";
    this.setStatus("off");
  }

  async reset() {
    await this.shutdown();
    return this.boot();
  }
}

export const linux = new LinuxComputer();

/**
 * Which Linux the agent's `linux_exec` uses: the built-in VM everywhere, or
 * on desktop the user's WSL (Windows) / the host shell (Linux).
 */
export async function linuxExec(backend, command, timeoutMs) {
  if (isDesktop && backend === "wsl" && osName === "windows") {
    return invoke("shell:exec", { command, wsl: true, timeoutMs });
  }
  if (isDesktop && backend === "host" && osName !== "windows") {
    return invoke("shell:exec", { command, timeoutMs });
  }
  const r = await linux.exec(command, timeoutMs);
  return { stdout: r.output, stderr: "", code: r.code, timedOut: r.timedOut };
}

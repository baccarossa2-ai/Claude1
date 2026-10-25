export const uid = (p = "") => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function truncate(s, n) {
  const str = String(s ?? "");
  return str.length <= n ? str : str.slice(0, n - 1) + "…";
}

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

export function timeAgo(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return "adesso";
  if (d < 3600) return Math.floor(d / 60) + " min fa";
  if (d < 86400) return Math.floor(d / 3600) + " h fa";
  if (d < 86400 * 7) return Math.floor(d / 86400) + " g fa";
  return new Date(ts).toLocaleDateString("it-IT");
}

export function dayGroup(ts) {
  const now = new Date();
  const d = new Date(ts);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startToday) return "Oggi";
  if (ts >= startToday - 86400000) return "Ieri";
  if (ts >= startToday - 86400000 * 7) return "Ultimi 7 giorni";
  if (ts >= startToday - 86400000 * 30) return "Ultimi 30 giorni";
  return d.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/** Text files we can inline into a prompt, by extension or mime. */
const TEXT_EXT = /\.(txt|md|markdown|json|jsonc|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|kts|c|h|cpp|hpp|cc|cs|php|swift|scala|sh|bash|zsh|ps1|bat|cmd|yml|yaml|toml|ini|cfg|conf|env|xml|html|htm|css|scss|less|sql|csv|tsv|log|lua|r|m|pl|vue|svelte|astro|gradle|properties|dockerfile|makefile|gitignore|tex|srt|vtt)$/i;
export function isTextFile(name, mime = "") {
  return mime.startsWith("text/") || /json|xml|javascript|yaml|csv|sql/.test(mime) || TEXT_EXT.test(name) || /^(dockerfile|makefile|readme|license)$/i.test(name);
}

export function readFileAsAttachment(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    const mime = file.type || "";
    const base = { id: uid("f_"), name: file.name, mime, size: file.size };
    if (mime.startsWith("image/")) {
      r.onload = () => resolve({ ...base, kind: "image", data: String(r.result).split(",")[1] });
      r.readAsDataURL(file);
    } else if (mime === "application/pdf" || /\.pdf$/i.test(file.name)) {
      r.onload = () => resolve({ ...base, mime: "application/pdf", kind: "pdf", data: String(r.result).split(",")[1] });
      r.readAsDataURL(file);
    } else if (isTextFile(file.name, mime)) {
      r.onload = () => resolve({ ...base, kind: "text", data: String(r.result) });
      r.readAsText(file);
    } else {
      r.onload = () => resolve({ ...base, kind: "binary", data: String(r.result).split(",")[1] });
      r.readAsDataURL(file);
    }
    r.onerror = () => reject(r.error);
  });
}

export function safeJson(s, fallback = null) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export function copyText(text) {
  try {
    return navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return Promise.resolve();
  }
}

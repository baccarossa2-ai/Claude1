// Real provider logos (downloaded from cloudy.chat into assets/logos) and the
// per-model accent colours from the original design tokens.
import { MODEL_ACCENTS, TUI } from "../../../original/cloudy-cli/src/tokens.js";

const L = (f) => `assets/logos/${f}`;

const BY_PREFIX = [
  [/^muse|^llama|meta/i, L("meta.png"), "Meta"],
  [/^mimo|xiaomi/i, L("mimo.png"), "Xiaomi"],
  [/^glm|zhipu|z-ai/i, L("zhipu.png"), "Zhipu AI"],
  [/^ling|inclusion/i, L("ling.png"), "InclusionAI"],
  [/^gpt|^o\d|openai|chatgpt/i, L("gpt.svg"), "OpenAI"],
  [/deepseek/i, L("deepseek.png"), "DeepSeek"],
  [/^solar|upstage/i, L("solar.png"), "Upstage"],
];

export const CLAUDE_COLOR = "#d97757";

/** The Claude spark, drawn as SVG so it stays crisp at every size. */
export const CLAUDE_SPARK_SVG = (() => {
  const rays = [];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (i % 2 ? 0.08 : -0.05);
    const len = i % 3 === 0 ? 46 : i % 3 === 1 ? 40 : 43;
    const w = 5.4;
    const x = Math.cos(a);
    const y = Math.sin(a);
    const px = -y * w;
    const py = x * w;
    const tip = [50 + x * len, 50 + y * len];
    const b1 = [50 + px * 0.55, 50 + py * 0.55];
    const b2 = [50 - px * 0.55, 50 - py * 0.55];
    const m1 = [50 + x * len * 0.55 + px, 50 + y * len * 0.55 + py];
    const m2 = [50 + x * len * 0.55 - px, 50 + y * len * 0.55 - py];
    const f = (p) => p.map((v) => v.toFixed(1)).join(" ");
    rays.push(`<path d="M${f(b1)} L${f(m1)} Q${f([tip[0] + px * 0.2, tip[1] + py * 0.2])} ${f(tip)} Q${f([tip[0] - px * 0.2, tip[1] - py * 0.2])} ${f(m2)} L${f(b2)} Z"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="${CLAUDE_COLOR}">${rays.join("")}<circle cx="50" cy="50" r="7"/></svg>`;
})();
export const CLAUDE_LOGO = "data:image/svg+xml;utf8," + encodeURIComponent(CLAUDE_SPARK_SVG);

export const CLOUDY_LOGO = L("cloudee-256.png");

/** Logo + vendor for a model reference ("cloudy:glm-5.3-flash", "claude:…", "custom:…"). */
export function modelLogo(ref, model) {
  const [kind] = String(ref || "").split(":");
  if (kind === "claude") return { src: CLAUDE_LOGO, vendor: "Anthropic", claude: true };
  const id = model?.id || String(ref || "").split(":").pop();
  const hay = `${id} ${model?.detail || ""} ${model?.providerName || ""}`;
  for (const [re, src, vendor] of BY_PREFIX) if (re.test(id) || re.test(hay)) return { src, vendor, invertOnLight: src.endsWith("gpt.svg") };
  if (/claude|anthropic/i.test(hay)) return { src: CLAUDE_LOGO, vendor: "Anthropic", claude: true };
  return { src: null, vendor: model?.providerName || "", monogram: (model?.providerName || id || "?").charAt(0).toUpperCase() };
}

export function modelAccent(ref, model) {
  if (String(ref).startsWith("claude:")) return CLAUDE_COLOR;
  if (model?.accent && MODEL_ACCENTS[model.accent]) return MODEL_ACCENTS[model.accent];
  return MODEL_ACCENTS["--model-accent-default"] || TUI.modelDot;
}

export { MODEL_ACCENTS, TUI };

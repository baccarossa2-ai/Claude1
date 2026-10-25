// Markdown → sanitised HTML, with highlighted code blocks.
import { Marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import shell from "highlight.js/lib/languages/shell";
import powershell from "highlight.js/lib/languages/powershell";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import java from "highlight.js/lib/languages/java";
import kotlin from "highlight.js/lib/languages/kotlin";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import php from "highlight.js/lib/languages/php";
import ruby from "highlight.js/lib/languages/ruby";
import swift from "highlight.js/lib/languages/swift";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import lua from "highlight.js/lib/languages/lua";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import ini from "highlight.js/lib/languages/ini";
import diff from "highlight.js/lib/languages/diff";

const LANGS = { javascript, typescript, python, bash, shell, powershell, json, xml, css, scss, sql, java, kotlin, c, cpp, csharp, go, rust, php, ruby, swift, yaml, markdown, lua, dockerfile, ini, diff };
for (const [name, lang] of Object.entries(LANGS)) hljs.registerLanguage(name, lang);
hljs.registerAliases(["js", "jsx", "mjs", "cjs"], { languageName: "javascript" });
hljs.registerAliases(["ts", "tsx"], { languageName: "typescript" });
hljs.registerAliases(["py"], { languageName: "python" });
hljs.registerAliases(["sh", "zsh", "console"], { languageName: "bash" });
hljs.registerAliases(["ps1", "ps"], { languageName: "powershell" });
hljs.registerAliases(["html", "htm", "svg", "vue"], { languageName: "xml" });
hljs.registerAliases(["yml"], { languageName: "yaml" });
hljs.registerAliases(["md"], { languageName: "markdown" });
hljs.registerAliases(["cs"], { languageName: "csharp" });
hljs.registerAliases(["toml"], { languageName: "ini" });

export function highlight(code, lang) {
  try {
    if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    return hljs.highlightAuto(code).value;
  } catch {
    return code.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]);
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }) {
      const language = (lang || "").trim().split(/\s+/)[0].toLowerCase();
      const runnable = ["sh", "bash", "shell", "lua", "awk", "console"].includes(language);
      const previewable = ["html", "htm", "svg"].includes(language);
      return `<div class="codeblock" data-lang="${esc(language)}"><div class="codeblock-head"><span class="codeblock-lang">${esc(language || "testo")}</span><span class="codeblock-actions">${
        runnable ? '<button class="cb-btn" data-act="run" title="Esegui nel computer Linux">▶ Esegui</button>' : ""
      }${previewable ? '<button class="cb-btn" data-act="preview" title="Apri come artefatto">◧ Anteprima</button>' : ""}<button class="cb-btn" data-act="save" title="Salva come file">⤓ Salva</button><button class="cb-btn" data-act="copy" title="Copia">⧉ Copia</button></span></div><pre><code class="hljs">${highlight(text, language)}</code></pre></div>`;
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      return `<a href="${esc(href)}" target="_blank" rel="noreferrer noopener"${title ? ` title="${esc(title)}"` : ""}>${text}</a>`;
    },
  },
});

export function renderMarkdown(md) {
  const html = marked.parse(String(md || ""));
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target", "data-act", "data-lang"] });
}

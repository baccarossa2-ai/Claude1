// End-to-end test of the desktop app: launches the real Electron build and
// drives it through the same state functions the UI calls.
//
//   xvfb-run -a node tests/e2e/electron.e2e.mjs [outDir] [--exe path/to/app]
//
// Network checks (Cloudy API, live MCP connector) run only when the machine
// is online; everything else uses local mocks (tests/e2e/mocks.mjs).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startMocks, writeFakeClaude } from "./mocks.mjs";

const require = createRequire(import.meta.url);
const { _electron } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = process.argv[2] && !process.argv[2].startsWith("--") ? path.resolve(process.argv[2]) : path.join(root, "test-results");
const exeIdx = process.argv.indexOf("--exe");
const exe = exeIdx > 0 ? process.argv[exeIdx + 1] : null;
fs.mkdirSync(outDir, { recursive: true });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cloudy-e2e-"));
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(tmp, "ws-")));
fs.writeFileSync(path.join(workspace, "README.md"), "# Progetto di prova\n");
const modelsFile = path.join(tmp, "claude-models.json");
const claudeLog = path.join(tmp, "claude.log");
const setModels = (ids) => fs.writeFileSync(modelsFile, JSON.stringify([{ value: "default", resolvedModel: ids[1] }, ...ids.map((id) => ({ value: id.split("-")[1], resolvedModel: id, displayName: id, description: id }))]));
setModels(["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
const fakeClaude = writeFakeClaude(tmp);
const mocks = await startMocks();

const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, detail });
    console.log(`  ✓ ${name}${detail ? " — " + detail : ""}`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: e.message });
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const args = exe ? [] : [root];
args.push("--no-sandbox");
if (proxy) args.push(`--proxy-server=${proxy.replace(/^https?:\/\//, "http://")}`, "--ignore-certificate-errors", "--proxy-bypass-list=127.0.0.1;localhost");
const app = await _electron.launch({
  executablePath: exe || path.join(root, "node_modules/electron/dist/electron"),
  args,
  env: { ...process.env, CLOUDY_TEST_WORKSPACE: workspace, MOCK_CLAUDE_MODELS: modelsFile, MOCK_CLAUDE_LOG: claudeLog, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
});
const page = await app.firstWindow();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/CORS|ERR_FAILED|favicon/.test(m.text()) && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: path.join(outDir, n + ".png") });
const ev = (fn, arg) => page.evaluate(fn, arg);
const waitFor = async (fn, arg, ms = 30000, what = "condizione") => {
  const t0 = Date.now();
  for (;;) {
    const v = await ev(fn, arg).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`);
    await page.waitForTimeout(250);
  }
};
// Answer dialogs / approvals the way a user clicking would.
const answerDialog = (type, value) => waitFor(({ type, value }) => {
  const d = window.cloudyDebug.store.get().dialog;
  if (d?.type === type && d.resolve) {
    d.resolve(value === "__to__" ? d.to.ref : value);
    return true;
  }
  return false;
}, { type, value }, 30000, `dialog ${type}`);
const approveNext = (answer = true) => waitFor((a) => {
  const ap = window.cloudyDebug.store.get().approvals[0];
  if (ap) {
    ap.resolve(a);
    return ap.tool;
  }
  return false;
}, answer, 30000, "richiesta di approvazione");
const lastAssistant = () => ev(() => {
  const c = window.cloudyDebug.store.get().current;
  const m = [...c.messages].reverse().find((x) => x.role === "assistant");
  return m && { status: m.status, content: m.content, error: m.error, parts: m.parts.map((p) => ({ type: p.type, name: p.name, status: p.status, path: p.path })), reasoning: m.reasoning, providerKind: m.providerKind };
});
const waitDone = () => waitFor(() => {
  const s = window.cloudyDebug.store.get();
  const c = s.current;
  const m = c && c.messages[c.messages.length - 1];
  return m && m.role === "assistant" && !s.streaming[c.id] && m.status !== "streaming";
}, null, 90000, "fine della risposta");

console.log("Cloudy Desktop — test end-to-end");

await step("avvio dell'app e splash", async () => {
  await waitFor(() => window.cloudyDebug?.store.get().ready, null, 30000, "app pronta");
  await page.waitForTimeout(2600);
  await shot("01-avvio");
});

const online = await ev(async () => {
  await window.cloudyDebug.models.refreshCloudy();
  return window.cloudyDebug.store.get().cloudy.models.length > 0;
});

await step("modelli Cloudy dal vero server (HTTP nativo, niente CORS)", async () => {
  if (!online) return "offline: saltato";
  const ids = await ev(() => window.cloudyDebug.store.get().cloudy.models.map((m) => m.id));
  assert(ids.length >= 3, "nessun modello");
  return ids.join(", ");
});

await step("Claude Code (finto) rilevato e tabella modelli dal suo initialize", async () => {
  await ev((p) => window.cloudyDebug.updateSettings((s) => ({ claude: { ...s.claude, codePath: p, via: "code", enabled: { "claude-opus-5-5": true, "claude-sonnet-5-5": true } } })), fakeClaude);
  await ev(() => window.cloudyDebug.models.refreshClaudeModels({ silent: true }));
  const c = await ev(() => window.cloudyDebug.store.get().claude);
  assert(c.code?.installed && c.code.version === "9.9.9", "claude non rilevato: " + JSON.stringify(c.code));
  const ids = c.table.map((m) => m.id);
  assert(ids.includes("claude-opus-5-5"), "tabella: " + ids);
  return ids.join(", ");
});

await step("nuovo modello: Opus 5.5 sparisce, Opus 6 compare al suo posto (stato 'attivo' trasferito)", async () => {
  setModels(["claude-fable-5-1", "claude-opus-6", "claude-sonnet-5-5", "claude-haiku-5-5"]);
  // Claude Code's model list is cached for 10 minutes in main; the test restarts the cache by changing the path.
  await ev((p) => window.cloudyDebug.updateSettings((s) => ({ claude: { ...s.claude, codePath: p } })), fakeClaude + "");
  const diff = await ev(async () => {
    const d = await window.cloudyDebug.models.refreshClaudeModels();
    return d;
  });
  let ids = await ev(() => window.cloudyDebug.store.get().claude.table.map((m) => m.id));
  if (!ids.includes("claude-opus-6")) {
    // cache still warm: expire it through a different (symlinked) path
    const alias = fakeClaude + "-2";
    if (!fs.existsSync(alias)) fs.symlinkSync(fakeClaude, alias);
    await ev((p) => window.cloudyDebug.updateSettings((s) => ({ claude: { ...s.claude, codePath: p } })), alias);
    await ev(() => window.cloudyDebug.models.refreshClaudeModels());
    ids = await ev(() => window.cloudyDebug.store.get().claude.table.map((m) => m.id));
  }
  assert(ids.includes("claude-opus-6") && !ids.includes("claude-opus-5-5"), "tabella dopo aggiornamento: " + ids);
  const enabled = await ev(() => window.cloudyDebug.store.get().settings.claude.enabled);
  assert(enabled["claude-opus-6"] && !enabled["claude-opus-5-5"], "attivazione non trasferita: " + JSON.stringify(enabled));
  return ids.join(", ");
});

await step("la conversazione su Opus 5.5 CHIEDE prima di passare a Opus 6, poi Claude Code risponde con la cronologia completa", async () => {
  await ev(() => {
    const d = window.cloudyDebug;
    const c = d.conversations.newConversation("chat", { model: "cloudy:glm-5.3-flash" });
    c.messages.push({ id: "u0", role: "user", content: "Ciao, ricordati che mi chiamo Marco.", attachments: [], createdAt: Date.now() });
    c.messages.push({ id: "a0", role: "assistant", content: "Piacere Marco!", parts: [{ type: "text", text: "Piacere Marco!" }], steps: [], providerKind: "cloudy", modelRef: "cloudy:glm-5.3-flash", status: "done", createdAt: Date.now() });
    c.model = "claude:claude-opus-5-5";
    d.conversations.saveConversation(c, true);
  });
  const sending = ev(() => window.cloudyDebug.sendMessage("Esegui echo hi"));
  await answerDialog("model-replaced", "__to__");
  const tool = await approveNext(true);
  await sending;
  await waitDone();
  const m = await lastAssistant();
  assert(m.status === "done", "stato: " + m.status + " " + m.error);
  assert(/Comando eseguito/.test(m.content), "risposta: " + m.content);
  assert(/cronologia precedente/.test(m.content), "la cronologia non è arrivata a Claude Code");
  const model = await ev(() => window.cloudyDebug.store.get().current.model);
  assert(model === "claude:claude-opus-6", "modello: " + model);
  const argv = fs.readFileSync(claudeLog, "utf8").split("\n").filter((l) => l.startsWith("[")).map((l) => JSON.parse(l)).pop();
  assert(argv.includes("claude-opus-6") && argv.includes("--permission-prompt-tool"), "argomenti claude: " + argv);
  await shot("02-claude-code");
  return `tool approvato: ${tool}; modello ${model}`;
});

await step("provider personalizzato OpenAI: l'agente Code scrive davvero un file nella cartella di lavoro", async () => {
  const pid = await ev(async (base) => {
    const p = await window.cloudyDebug.account.saveProvider({ name: "Mock OpenAI", baseUrl: base + "/openai/v1", format: "openai", models: [{ id: "mock-coder", name: "mock-coder", enabled: true }] }, "sk-test");
    return p.id;
  }, mocks.base);
  await ev(({ pid, ws }) => {
    const c = window.cloudyDebug.conversations.newConversation("code", { model: `custom:${pid}:mock-coder`, workspace: ws });
    c.access = "ask";
  }, { pid, ws: workspace });
  const sending = ev(() => window.cloudyDebug.sendMessage("Crea hello.txt"));
  const tool = await approveNext(true);
  await sending;
  await waitDone();
  const m = await lastAssistant();
  assert(m.status === "done", "stato " + m.status + " " + m.error);
  const file = path.join(workspace, "hello.txt");
  assert(fs.existsSync(file) && fs.readFileSync(file, "utf8") === "Ciao dal mock!", "hello.txt non creato");
  assert(m.parts.some((p) => p.type === "file" && p.path === "hello.txt"), "manca la scheda diff");
  assert(m.reasoning.includes("Devo creare"), "ragionamento non mostrato");
  await shot("03-agente-code");
  return `approvato ${tool}; risposta: ${m.content}`;
});

await step("confinamento: l'agente non può uscire dalla cartella di lavoro", async () => {
  const r = await ev(async (ws) => {
    try {
      await window.cloudyNative.invoke("fs:read", ws, "../../../../etc/passwd");
      return "LETTO!";
    } catch (e) {
      return e.message;
    }
  }, workspace);
  assert(r !== "LETTO!", "path traversal riuscito");
  const r2 = await ev(async () => {
    try {
      await window.cloudyNative.invoke("fs:list", "/", "");
      return "LISTATO!";
    } catch (e) {
      return e.message;
    }
  });
  assert(r2 !== "LISTATO!", "radice non autorizzata accessibile");
  return "bloccato";
});

await step("provider personalizzato formato Anthropic (SDK ufficiale): thinking + tool calculator", async () => {
  const pid = await ev(async (base) => (await window.cloudyDebug.account.saveProvider({ name: "Mock Anthropic", baseUrl: base + "/anthropic", format: "anthropic", models: [{ id: "claude-mock-1", name: "Mock Claude", enabled: true }] }, "sk-ant-test")).id, mocks.base);
  await ev((pid) => window.cloudyDebug.conversations.newConversation("chat", { model: `custom:${pid}:claude-mock-1` }), pid);
  await ev(() => window.cloudyDebug.sendMessage("Quanto fa 21*2?"));
  await waitDone();
  const m = await lastAssistant();
  assert(m.status === "done", "stato " + m.status + " " + m.error);
  assert(/42/.test(m.content), "risposta: " + m.content);
  assert(m.parts.some((p) => p.type === "tool" && p.name === "calculator" && p.status === "ok"), "tool non eseguito");
  const req = mocks.log.filter((l) => l.kind === "anthropic").pop().body;
  assert(req.tools.every((t) => t.eager_input_streaming === true), "eager_input_streaming mancante");
  const replayed = req.messages.find((x) => x.role === "assistant");
  assert(replayed.content.some((b) => b.type === "thinking"), "i blocchi thinking non sono stati rispediti invariati");
  return m.content;
});

await step("computer Linux integrato (v86): avvio e comandi reali", async () => {
  const r = await ev(async () => {
    const t0 = Date.now();
    const out = await window.cloudyDebug.linux.exec("uname -sr; echo $((6*7)); cd /mnt/home && echo persistente > prova.txt && cat prova.txt", 120000);
    return { ...out, secs: (Date.now() - t0) / 1000 };
  });
  assert(/Linux 6\.8/.test(r.output), "uname: " + r.output);
  assert(/\b42\b/.test(r.output) && /persistente/.test(r.output), "output: " + r.output);
  const multi = await ev(() => window.cloudyDebug.linux.exec("for i in 1 2 3; do\n  echo riga$i\ndone\nlua -e 'print(2^10)'", 60000));
  assert(/riga3/.test(multi.output) && /1024/.test(multi.output), "multilinea: " + multi.output);
  await ev(() => window.cloudyDebug.store.set({ panel: "linux" }));
  await page.waitForTimeout(1200);
  await shot("04-linux");
  return `avvio+comando in ${r.secs.toFixed(1)} s`;
});

await step("motore originale cloudy-cli: `cloudy import --json` (Claude Code / Cursor / VS Code)", async () => {
  const res = await ev((ws) => window.cloudyNative.invoke("engine:import", { root: ws, apply: false }), workspace);
  assert(res && typeof res === "object", "risultato: " + JSON.stringify(res));
  return Object.keys(res).join(", ");
});

await step("connettore MCP reale senza chiave (DeepWiki)", async () => {
  if (!online) return "offline: saltato";
  const n = await ev(async () => (await window.cloudyDebug.connectors.connect("deepwiki")).tools.length);
  assert(n > 0, "nessuno strumento");
  return `${n} strumenti`;
});

await step("chat reale con un modello Cloudy (prova anonima)", async () => {
  if (!online) return "offline: saltato";
  await ev(() => window.cloudyDebug.conversations.newConversation("chat", { model: "cloudy:glm-5.3-flash" }));
  await ev(() => window.cloudyDebug.sendMessage("Rispondi solo con la parola: pronto"));
  // A 429 (trial used up) is the "limits" dialog — that is the flow too.
  const t0 = Date.now();
  for (;;) {
    const s = await ev(() => ({ d: window.cloudyDebug.store.get().dialog?.type, streaming: Object.keys(window.cloudyDebug.store.get().streaming).length }));
    if (s.d === "limits") {
      await shot("05-limiti");
      await answerDialog("limits", null);
      return "quota di prova esaurita → finestra «limiti» mostrata (ok)";
    }
    if (!s.streaming && Date.now() - t0 > 1500) break;
    if (Date.now() - t0 > 90000) throw new Error("timeout");
    await page.waitForTimeout(300);
  }
  const m = await lastAssistant();
  if (m.status === "error") return "errore dal server: " + m.error;
  assert(m.content.trim().length > 0, "risposta vuota");
  await shot("05-cloudy-reale");
  return JSON.stringify(m.content.trim().slice(0, 60));
});

await step("interfaccia: selettore modelli, impostazioni Claude, app e artefatto", async () => {
  await ev(() => {
    const c = window.cloudyDebug.store.get().current;
    c.artifacts = [{ id: "art1", title: "Demo animata", kind: "html", content: "<html><body style='margin:0;display:grid;place-items:center;height:100vh;background:linear-gradient(135deg,#7c9cff,#b38cff);font:700 40px system-ui;color:#fff'><div id=t>Ciao!</div><script>document.getElementById('t').textContent='Script OK ✓'</script></body></html>", createdAt: Date.now() }];
    window.cloudyDebug.store.set({ panel: "artifacts", panelArtifact: "art1" });
  });
  await page.waitForTimeout(1500);
  const frameText = await page.frames().find((f) => f.url().includes("artifact-host"))?.evaluate(() => document.body.innerText).catch(() => null);
  assert(frameText && frameText.includes("Script OK"), "lo script dell'artefatto non è stato eseguito: " + frameText);
  await shot("06-artefatto");
  await ev(() => window.cloudyDebug.store.set({ panel: null, dialog: { type: "settings", section: "claude" } }));
  await page.waitForTimeout(900);
  await shot("07-impostazioni-claude");
  await ev(() => window.cloudyDebug.store.set({ dialog: { type: "settings", section: "plugins" } }));
  await page.waitForTimeout(700);
  await shot("08-plugin");
  await ev(() => window.cloudyDebug.store.set({ dialog: { type: "apps" } }));
  await page.waitForTimeout(900);
  await shot("09-app");
  await ev(() => window.cloudyDebug.store.set({ dialog: null }));
  await page.click(".pill .name");
  await page.waitForTimeout(600);
  await shot("10-selettore-modelli");
  await page.keyboard.press("Escape");
  return "artefatto con script eseguito in sandbox";
});

await step("nessun errore JavaScript durante il test", async () => {
  assert(!errors.length, errors.slice(0, 5).join(" | "));
});

await app.close();
mocks.server.close();
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} controlli superati`);
process.exit(failed.length ? 1 : 0);

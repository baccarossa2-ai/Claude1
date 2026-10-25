// Running one turn: route the conversation's model to its provider, stream
// into the assistant message, run tools, and handle the walls (quota, auth,
// a model that left the table) by ASKING — this module never moves a
// conversation to another model on its own.
import { SESSION_BUDGET_MS } from "../../../original/cloudy-cli/src/session.js";
import { recordSent } from "../../../original/cloudy-cli/src/history.js";
import { invoke, isDesktop, onNative, secrets } from "../platform/native.js";
import { sendChat, CloudyError } from "../providers/cloudy.js";
import { sendAnthropic } from "../providers/anthropic.js";
import { sendOpenAI } from "../providers/openai.js";
import { runClaudeCodeTurn } from "../providers/claudecode.js";
import { runAgent } from "../agent/loop.js";
import { toolsForTurn } from "../agent/tools.js";
import { buildHistory, buildSystemPrompt, transcriptForHandoff } from "../agent/prompt.js";
import { openWorkspace } from "../agent/workspace.js";
import { collectSkills, workspaceSkills } from "../skills/index.js";
import { linux } from "../linux/vm.js";
import { uid } from "../lib/util.js";
import { askDialog, bump, getSettings, requestApproval, store, toast, updateSettings } from "./store.js";
import { allModels, claudeRoute, cloudyCfg, modelInfo, refreshAd, refreshUsage, replacementFor } from "./models.js";
import { autoTitle, newConversation, saveConversation } from "./conversations.js";
import { connectorTools } from "./connectors.js";
import { pluginPrompts, pluginSkills } from "./plugins.js";

const controllers = new Map(); // convId -> AbortController
export let composerHistory = { entries: [], index: null, draft: "", stashed: "" };
export const setComposerHistory = (h) => (composerHistory = h);

let raf = 0;
function scheduleBump() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    bump();
  });
}

function setStreaming(convId, on) {
  store.set((s) => {
    const streaming = { ...s.streaming };
    if (on) streaming[convId] = true;
    else delete streaming[convId];
    return { streaming };
  });
}

function pushText(msg, d) {
  if (!d) return;
  const last = msg.parts[msg.parts.length - 1];
  if (last?.type === "text") last.text += d;
  else msg.parts.push({ type: "text", text: d });
  scheduleBump();
}

function upsertTool(msg, ev) {
  const at = msg.parts.findIndex((p) => p.type === "tool" && p.id === ev.id);
  const part = { type: "tool", id: ev.id, name: ev.name, args: ev.args, status: ev.status, output: ev.output };
  if (at === -1) msg.parts.push(part);
  else msg.parts[at] = { ...msg.parts[at], ...Object.fromEntries(Object.entries(part).filter(([, v]) => v !== undefined)) };
  scheduleBump();
}

export function resolveRoute(ref) {
  const [kind, ...rest] = String(ref).split(":");
  if (kind === "claude") {
    const via = claudeRoute();
    return { kind: via === "code" ? "claude-code" : via === "api" ? "claude-api" : "claude-none", model: rest.join(":") };
  }
  if (kind === "custom") {
    const [pid, ...mid] = rest;
    const provider = getSettings().providers.find((p) => p.id === pid);
    return { kind: provider ? "custom" : "custom-missing", provider, model: mid.join(":") };
  }
  return { kind: "cloudy", model: rest.join(":") || ref };
}

/** Before sending: a Claude model that left the table, or no Claude connection, is a question. */
async function confirmModel(conv) {
  const route = resolveRoute(conv.model);
  if (conv.model.startsWith("claude:")) {
    const id = conv.model.slice(7);
    const exists = store.get().claude.table.some((m) => m.id === id);
    if (!exists) {
      const repl = replacementFor(id);
      const answer = await askDialog({ type: "model-replaced", from: modelInfo(conv.model), to: repl ? modelInfo(`claude:${repl.id}`) : null });
      if (!answer) return false;
      conv.model = answer;
      saveConversation(conv);
      bump();
    }
    if (route.kind === "claude-none") {
      const answer = await askDialog({ type: "claude-connect" });
      if (answer !== "retry" || !claudeRoute()) return false;
    }
  }
  if (route.kind === "custom-missing") {
    toast("Il provider di questo modello è stato rimosso: scegli un altro modello.", "error");
    return false;
  }
  return true;
}

export async function sendMessage(text, attachments = [], opts = {}) {
  let conv = store.get().current || newConversation("chat");
  if (store.get().streaming[conv.id]) return;
  const content = String(text || "").trim();
  if (!content && !attachments.length) return;
  if (!(await confirmModel(conv))) return;
  composerHistory = recordSent(composerHistory, content);

  const user = { id: uid("m_"), role: "user", content, attachments, createdAt: Date.now() };
  if (!conv.messages.length) conv.title = autoTitle(content || attachments[0]?.name);
  conv.messages.push(user);
  saveConversation(conv, true);
  store.set({ current: conv });
  bump();
  await runTurn(conv, opts);
}

export async function regenerate() {
  const conv = store.get().current;
  if (!conv || store.get().streaming[conv.id]) return;
  while (conv.messages.length && conv.messages[conv.messages.length - 1].role === "assistant") conv.messages.pop();
  if (!conv.messages.length) return;
  if (!(await confirmModel(conv))) return;
  bump();
  await runTurn(conv);
}

/** Edit an earlier user message: everything after it goes, then the turn runs again. */
export async function editAndResend(msgId, text) {
  const conv = store.get().current;
  if (!conv || store.get().streaming[conv.id]) return;
  const i = conv.messages.findIndex((m) => m.id === msgId);
  if (i === -1) return;
  conv.messages = conv.messages.slice(0, i + 1);
  conv.messages[i] = { ...conv.messages[i], content: text };
  conv.claudeSession = null; // history changed: Claude Code gets the whole transcript again
  saveConversation(conv, true);
  bump();
  if (!(await confirmModel(conv))) return;
  await runTurn(conv);
}

export function stopTurn(convId = store.get().current?.id) {
  controllers.get(convId)?.abort();
}

async function runTurn(conv, opts = {}) {
  const settings = getSettings();
  const route = resolveRoute(conv.model);
  const info = modelInfo(conv.model);
  const msg = {
    id: uid("m_"),
    role: "assistant",
    content: "",
    reasoning: "",
    parts: [],
    steps: [],
    model: route.model,
    modelRef: conv.model,
    modelName: info.name,
    providerKind: { cloudy: "cloudy", "claude-api": "anthropic", "claude-code": "claude-code", custom: route.provider?.format === "anthropic" ? "anthropic" : "openai" }[route.kind] || route.kind,
    status: "streaming",
    createdAt: Date.now(),
  };
  conv.messages.push(msg);
  const ctrl = new AbortController();
  controllers.set(conv.id, ctrl);
  setStreaming(conv.id, true);
  bump();
  const startedAt = Date.now();
  const budget = setTimeout(() => ctrl.abort("budget"), SESSION_BUDGET_MS);

  try {
    const ws = conv.mode !== "chat" && conv.workspace ? await openWorkspace(conv.workspace) : null;
    if (route.kind === "claude-code") await runViaClaudeCode(conv, msg, ws, ctrl.signal);
    else if (route.kind === "cloudy" && settings.useOriginalEngine && isDesktop && conv.mode !== "chat" && ws) await runViaOriginalEngine(conv, msg, ws, ctrl.signal);
    else await runViaAgent(conv, msg, route, ws, ctrl.signal);
    msg.status = "done";
    if (route.kind === "cloudy") {
      refreshUsage();
      if (conv.messages.filter((m) => m.role === "assistant").length % 3 === 1) refreshAd();
    }
  } catch (e) {
    const aborted = e?.name === "AbortError" || ctrl.signal.aborted;
    if (aborted) {
      msg.status = "stopped";
      if (ctrl.signal.reason === "budget") msg.error = "Questa sessione ha raggiunto il limite di un'ora: avvia un nuovo turno per continuare.";
    } else {
      msg.status = "error";
      msg.error = e?.message || String(e);
      msg.errorKind = e?.kind || "error";
    }
  } finally {
    clearTimeout(budget);
    controllers.delete(conv.id);
    setStreaming(conv.id, false);
    msg.durationMs = Date.now() - startedAt;
    saveConversation(conv, true);
    bump();
  }

  if (msg.status === "error") await handleWall(conv, msg, route);
  return msg;
}

/** Quota, auth and refusals end in a question to the user — never a silent switch. */
async function handleWall(conv, msg, route) {
  const kind = msg.errorKind;
  if (kind === "quota" || kind === "refusal" || kind === "model") {
    const choice = await askDialog({ type: kind === "quota" ? "limits" : "switch-model", message: msg.error, fromRef: conv.model, route: route.kind });
    if (choice && choice !== conv.model) {
      conv.model = choice;
      conv.messages = conv.messages.filter((m) => m.id !== msg.id);
      saveConversation(conv, true);
      bump();
      if (await confirmModel(conv)) await runTurn(conv);
    }
  } else if (kind === "auth" && route.kind === "cloudy") {
    await secrets.set("cloudy.token", null);
    store.set((s) => ({ cloudy: { ...s.cloudy, token: null, user: null } }));
    askDialog({ type: "login", reason: "La sessione Cloudy è scaduta: accedi di nuovo." });
  } else if (kind === "auth" && route.kind === "claude-code") {
    askDialog({ type: "claude-connect", reason: msg.error });
  }
}

async function turnContext(conv, ws, signal, msg) {
  const settings = getSettings();
  const wsSkills = ws ? await workspaceSkills(ws) : [];
  const skills = collectSkills({ user: settings.userSkills, plugins: pluginSkills(), workspace: wsSkills, disabled: settings.disabledSkills });
  linux.configure({ memoryMB: settings.linuxMemory, network: settings.linuxNetwork, relayUrl: settings.linuxRelayUrl });
  return {
    skills,
    ctx: {
      ws,
      skills,
      convId: conv.id,
      linuxBackend: settings.linuxBackend,
      signal,
      emit: (ev) => handleToolEvent(conv, msg, ev),
    },
  };
}

function handleToolEvent(conv, msg, ev) {
  if (ev.type === "artifact") {
    conv.artifacts = [...(conv.artifacts || []), ev.artifact];
    msg.parts.push({ type: "artifact", id: ev.artifact.id, title: ev.artifact.title, kind: ev.artifact.kind });
    store.set({ panel: "artifacts", panelArtifact: ev.artifact.id });
  } else if (ev.type === "todos") {
    conv.todos = ev.todos;
    const at = msg.parts.findIndex((p) => p.type === "todos");
    if (at === -1) msg.parts.push({ type: "todos" });
  } else if (ev.type === "file") {
    msg.parts.push({ type: "file", path: ev.path, before: ev.before, after: ev.after });
  } else if (ev.type === "image") {
    msg.parts.push({ type: "image", mime: ev.mime, data: ev.data, prompt: ev.prompt });
  } else if (ev.type === "memory") {
    updateSettings((s) => ({ memories: [...s.memories, { id: uid("mem_"), text: ev.text, at: Date.now() }].slice(-200) }));
    toast("Ho memorizzato: " + ev.text.slice(0, 80), "success");
  } else if (ev.type === "linux") {
    if (!store.get().panel) store.set({ panel: "linux" });
  }
  scheduleBump();
}

const approve = (conv) => async (req) => {
  if (conv.alwaysAllow?.includes(req.tool)) return true;
  const answer = await requestApproval({ ...req, convId: conv.id });
  if (answer === "always") {
    conv.alwaysAllow = [...(conv.alwaysAllow || []), req.tool];
    return true;
  }
  return !!answer;
};

async function runViaAgent(conv, msg, route, ws, signal) {
  const settings = getSettings();
  const target = msg.providerKind;
  const { skills, ctx } = await turnContext(conv, ws, signal, msg);
  const isCloudy = route.kind === "cloudy";
  // Cloudy bills a plain chat in messages and an agent turn in credits, so its
  // chat mode stays a plain chat; other providers get tools in chat too.
  const useTools = !(isCloudy && conv.mode === "chat");
  const extra = useTools ? await connectorTools({ workspaceRoot: ws?.kind === "desktop" ? ws.root : null }) : [];
  const tools = useTools ? toolsForTurn({ mode: conv.mode, agentMode: conv.agentMode, hasWorkspace: !!ws, extra, chatTools: settings.chatTools }) : [];
  const system = buildSystemPrompt({
    mode: conv.mode,
    agentMode: conv.agentMode,
    workspace: ws,
    skills,
    memories: settings.memories,
    customInstructions: settings.customInstructions,
    pluginPrompts: pluginPrompts(),
    modelName: msg.modelName,
    linuxBackend: settings.linuxBackend,
    hasTools: tools.length > 0,
  });
  // Cloudy's server brings its own persona for plain chat: only the user's
  // own instructions and memories travel there.
  const cloudyChatNote = [settings.customInstructions?.trim() && `Istruzioni dell'utente: ${settings.customInstructions.trim()}`, settings.memories.length && "Ricordi sull'utente:\n" + settings.memories.map((m) => `- ${m.text}`).join("\n")].filter(Boolean).join("\n\n");
  const history = buildHistory(conv.messages.filter((m) => m.id !== msg.id), { target, model: route.model });
  const effort = conv.effort || settings.effort;
  const onText = (d) => pushText(msg, d);
  const onReasoning = (d) => {
    msg.reasoning += d;
    scheduleBump();
  };
  const vision = !!allModels().find((m) => m.ref === conv.model)?.vision;

  let send;
  if (isCloudy) {
    const cfg = cloudyCfg();
    send = ({ messages, tools: t, step, finalAnswer }) =>
      sendChat(cfg, { model: route.model, messages, system: useTools ? system : cloudyChatNote, tools: t, agent: useTools ? { step, finalAnswer } : null, effort, vision, signal, onText, onReasoning });
  } else if (route.kind === "claude-api") {
    const apiKey = await secrets.get("anthropic.apiKey");
    send = ({ messages, tools: t }) => sendAnthropic({ apiKey, model: route.model, system, messages, tools: t, effort, signal, onText, onReasoning, fallbacks: settings.claude.fallbacks });
  } else {
    const p = route.provider;
    const apiKey = await secrets.get(`provider.${p.id}`);
    send =
      p.format === "anthropic"
        ? ({ messages, tools: t }) => sendAnthropic({ apiKey, baseURL: p.baseUrl, model: route.model, system, messages, tools: t, effort, signal, onText, onReasoning, fallbacks: false, firstParty: false })
        : ({ messages, tools: t }) => sendOpenAI({ baseUrl: p.baseUrl, apiKey, model: route.model, system, messages, tools: p.noTools ? [] : t, effort, signal, onText, onReasoning });
  }

  const result = await runAgent({
    send,
    tools,
    history,
    access: conv.access || settings.access,
    maxSteps: settings.maxSteps,
    ctx,
    signal,
    approve: approve(conv),
    onEvent: (ev) => {
      if (ev.type === "tool") upsertTool(msg, ev);
      else if (ev.type === "usage") msg.usage = ev.usage;
    },
  });
  msg.steps = result.steps;
  msg.content = result.text;
  if (!msg.parts.some((p) => p.type === "text") && result.text) msg.parts.push({ type: "text", text: result.text });
}

function attachmentBlocks(atts = []) {
  const out = [];
  for (const a of atts) {
    if (a.kind === "image") out.push({ type: "image", source: { type: "base64", media_type: a.mime, data: a.data } });
    else if (a.kind === "pdf") out.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } });
    else if (a.kind === "text") out.push({ type: "text", text: `<file name="${a.name}">\n${a.data}\n</file>` });
    else out.push({ type: "text", text: `[Allegato binario "${a.name}" (${a.mime}, ${a.size} byte)]` });
  }
  return out;
}

async function runViaClaudeCode(conv, msg, ws, signal) {
  const settings = getSettings();
  const userIdx = conv.messages.length - 2;
  const user = conv.messages[userIdx];
  const seen = conv.claudeSession?.seen ?? 0;
  const prior = conv.messages.slice(seen, userIdx);
  const content = [];
  // Whatever Claude Code has not seen yet — earlier turns with other models,
  // and every file attached along the way — travels with this message.
  if (prior.length) {
    content.push({ type: "text", text: `<cronologia_precedente>\nQuesta è la conversazione avvenuta finora (anche con altri modelli). Continua da qui.\n\n${transcriptForHandoff(prior)}\n</cronologia_precedente>` });
    for (const m of prior) content.push(...attachmentBlocks((m.attachments || []).filter((a) => a.kind === "image" || a.kind === "pdf")));
  }
  content.push(...attachmentBlocks(user.attachments));
  content.push({ type: "text", text: user.content || "(vedi allegati)" });

  const { skills } = await turnContext(conv, ws, signal, msg);
  const systemAppend = buildSystemPrompt({ mode: conv.mode, agentMode: conv.agentMode, workspace: ws, skills: [], memories: settings.memories, customInstructions: settings.customInstructions, pluginPrompts: pluginPrompts(), modelName: msg.modelName, hasTools: false }) +
    (skills.length ? `\n\nSkill di Cloudy disponibili (testo completo su richiesta dell'utente): ${skills.map((s) => s.name).join(", ")}` : "");

  const res = await runClaudeCodeTurn({
    key: `cc_${conv.id}`,
    cwd: ws?.kind === "desktop" ? ws.root : null,
    model: msg.model,
    effort: conv.effort || settings.effort,
    access: conv.access || settings.access,
    chatOnly: conv.mode === "chat",
    resume: conv.claudeSession?.id || null,
    systemAppend,
    content,
    customPath: settings.claude.codePath,
    signal,
    onText: (d) => pushText(msg, d),
    onReasoning: (d) => {
      msg.reasoning += d;
      scheduleBump();
    },
    onTool: (ev) => upsertTool(msg, ev),
    onApproval: (req) => approve(conv)({ tool: req.tool, args: req.args, kind: "exec", description: req.reason }),
    onSession: (s) => (msg.session = s),
  });
  msg.content = res.text;
  msg.costUsd = res.costUsd;
  conv.claudeSession = { id: res.sessionId, seen: conv.messages.length };
  msg.steps = [];
}

/** The untouched original agent host (dist/serve.cjs), for Cloudy models on desktop. */
async function runViaOriginalEngine(conv, msg, ws, signal) {
  const settings = getSettings();
  const sendId = uid("s_");
  await invoke("engine:ensure", { token: store.get().cloudy.token, base: settings.cloudyBase, root: ws.root });
  const history = conv.messages
    .filter((m) => m.id !== msg.id && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role, content: m.role === "user" ? [m.content, ...(m.attachments || []).filter((a) => a.kind === "text").map((a) => `<file name="${a.name}">\n${a.data}\n</file>`)].join("\n\n") : m.content || "" }));
  await new Promise((resolve, reject) => {
    const off = onNative("engine:event", async ({ sendId: id, event }) => {
      if (id !== sendId) return;
      if (event.type === "delta") pushText(msg, event.content || "");
      else if (event.type === "reasoning") {
        msg.reasoning += event.content || "";
        scheduleBump();
      } else if (event.type === "tool") upsertTool(msg, { id: event.call?.id, name: event.call?.name, args: event.call?.args, status: event.status, output: event.output });
      else if (event.type === "approval") {
        const ok = await approve(conv)({ tool: "run_command", args: { command: event.command }, kind: "exec" });
        invoke("engine:approve", event.approvalId, ok).catch(() => {});
      } else if (event.type === "done") {
        off();
        msg.content = event.message?.content || msg.parts.filter((p) => p.type === "text").map((p) => p.text).join("");
        resolve();
      } else if (event.type === "error") {
        off();
        reject(event.error === "aborted" ? Object.assign(new Error("aborted"), { name: "AbortError" }) : new CloudyError(String(event.error), 502, /limit|quota|credit/i.test(String(event.error)) ? "quota" : "error"));
      }
    });
    signal.addEventListener("abort", () => invoke("engine:abort", sendId).catch(() => {}));
    invoke("engine:respond", { sendId, chatId: null, modelId: msg.model, messages: history, effort: conv.effort || settings.effort, access: conv.access || settings.access, agentMode: conv.agentMode }).catch((e) => {
      off();
      reject(e);
    });
  });
}

// System prompt and the history every provider receives. History is the WHOLE
// conversation — every message and every attached file — so switching from a
// Cloudy model to Claude mid-thread loses nothing.
import { osName } from "../platform/native.js";
import { skillsPromptBlock } from "../skills/index.js";
import { truncate } from "../lib/util.js";

const MODE_TEXT = {
  chat: "Modalità Chat: rispondi in modo utile e conversazionale. Usa gli strumenti (ricerca web, calcolatrice, artefatti, il tuo computer Linux) solo quando aiutano davvero.",
  code: "Modalità Code: sei un agente di programmazione come Claude Code. Lavori nella cartella di lavoro dell'utente con gli strumenti file e shell. Leggi prima di modificare, fai modifiche mirate (edit_file), verifica con test o comandi, e alla fine riassumi cosa hai cambiato.",
  cowork:
    "Modalità Cowork: sei un collega che porta a termine compiti completi (documenti, analisi, ricerche, file, automazioni). Prima pianifica con todo_write, poi esegui passo passo aggiornando la lista, salva i risultati come file nella cartella di lavoro o come artefatti, e chiudi con un riepilogo e i file prodotti.",
};

export function buildSystemPrompt({ mode, agentMode, workspace, skills, memories, customInstructions, pluginPrompts, modelName, linuxBackend, hasTools }) {
  const now = new Date();
  const parts = [
    `Sei Cloudy, l'assistente AI di Cloudy Desktop (modello in uso: ${modelName}). Rispondi nella lingua dell'utente (di default italiano), in modo chiaro e onesto: se non sai qualcosa dillo, non inventare.`,
    MODE_TEXT[mode] || MODE_TEXT.chat,
    `Data di oggi: ${now.toLocaleDateString("it-IT", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}. Sistema dell'utente: ${osName}.`,
  ];
  if (agentMode === "plan") parts.push("Piano (sola lettura): puoi leggere e cercare ma NON modificare file né eseguire comandi. Proponi un piano dettagliato di ciò che faresti.");
  if (workspace) parts.push(`Cartella di lavoro: ${workspace.root} — tutti i percorsi dei tool file sono relativi a questa cartella.`);
  if (hasTools) {
    parts.push(
      `Hai un computer Linux tutto tuo (tool linux_exec${linuxBackend === "wsl" ? ", tramite WSL" : ""}): usalo per eseguire codice, provare comandi, calcoli e script. /mnt/home è la tua cartella persistente.`,
      "Per pagine web, app, giochi, grafici o documenti lunghi usa create_artifact: l'utente li vede subito nel pannello Artefatti."
    );
  }
  if (memories?.length) parts.push("Cose che ricordi dell'utente:\n" + memories.map((m) => `- ${m.text}`).join("\n"));
  if (pluginPrompts?.length) parts.push(...pluginPrompts);
  if (customInstructions?.trim()) parts.push("Istruzioni personalizzate dell'utente:\n" + customInstructions.trim());
  return parts.join("\n\n") + (hasTools ? skillsPromptBlock(skills || []) : "");
}

/** One compact line per tool call, used when replaying history to another provider. */
function summarizeSteps(steps = []) {
  const lines = [];
  for (const s of steps) {
    for (const r of s.toolResults || []) {
      const call = (s.toolCalls || []).find((c) => c.id === r.id);
      const args = call ? JSON.stringify(call.args).slice(0, 300) : "";
      lines.push(`[strumento ${r.name}(${args}) → ${r.isError ? "ERRORE: " : ""}${truncate(r.output, 1200)}]`);
    }
  }
  return lines.join("\n");
}

/**
 * Normalised history for a provider of kind `target` ("cloudy" | "anthropic"
 * | "openai") and model id. Steps of the same provider kind are replayed as
 * structured tool calls (Anthropic raw blocks only when the model matches,
 * which keeps thinking blocks valid); anything else is replayed as text.
 */
export function buildHistory(messages, { target, model }) {
  const out = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", text: m.content || "", attachments: m.attachments || [] });
      continue;
    }
    if (m.role !== "assistant" || m.error === "aborted-empty") continue;
    const generated = (m.parts || []).filter((p) => p.type === "image");
    const imageNote = generated.length ? `\n[${generated.length} immagine/i generata/e e mostrata/e all'utente]` : "";
    if (m.providerKind === target && m.steps?.length) {
      m.steps.forEach((s, i) => {
        const last = i === m.steps.length - 1;
        out.push({ role: "assistant", text: s.text || (last ? m.content || "" : ""), toolCalls: s.toolCalls || [], raw: target === "anthropic" && m.model === model ? s.raw : undefined });
        if (s.toolResults?.length) out.push({ role: "tool", results: s.toolResults });
      });
      if (imageNote) out.push({ role: "assistant", text: imageNote.trim() });
      continue;
    }
    const tools = summarizeSteps(m.steps);
    const text = [tools, m.content || ""].filter(Boolean).join("\n\n") + imageNote;
    if (text.trim()) out.push({ role: "assistant", text });
  }
  // Providers reject an assistant turn left dangling without a reply after it,
  // and two adjacent user turns are fine — nothing else to fix up.
  return out;
}

/** The full transcript as text — what Claude Code receives when it takes over a thread. */
export function transcriptForHandoff(messages) {
  const lines = [];
  for (const m of messages) {
    if (m.role === "user") {
      lines.push(`### Utente\n${m.content || ""}`);
      for (const a of m.attachments || []) if (a.kind === "text") lines.push(`<file name="${a.name}">\n${a.data}\n</file>`);
    } else if (m.role === "assistant") {
      const tools = summarizeSteps(m.steps);
      lines.push(`### Assistente (${m.modelName || m.model || "modello"})\n${[tools, m.content || ""].filter(Boolean).join("\n\n")}`);
    }
  }
  return lines.join("\n\n");
}

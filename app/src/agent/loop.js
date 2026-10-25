// The agent loop — provider-agnostic. `send` is one model call (Cloudy,
// Claude API or a custom provider); the loop executes tool calls, asks for
// approval where the access level says so, and stops when the model answers
// in prose. Like the original host, the last step withholds tools so the model
// must summarise instead of being cut off.
import { approvalFor, validateArgs } from "./tools.js";

export const DEFAULT_MAX_STEPS = 30;

function refusal(name, access) {
  if (access === "readonly") {
    return `Rifiutato: questa sessione è in SOLA LETTURA, quindi ${name} non può essere eseguito. Letture e ricerche sono permesse. Spiega all'utente cosa cambieresti e che può passare il livello di accesso a "Chiedi" o "Accesso completo".`;
  }
  return `L'utente ha rifiutato ${name}. Non riprovare; chiedi come preferisce procedere.`;
}

/**
 * @returns {Promise<{ text, steps }>} steps = [{ text, reasoning, toolCalls, toolResults, raw }]
 */
export async function runAgent({ send, tools, history, access = "ask", maxSteps = DEFAULT_MAX_STEPS, ctx, onEvent, signal, approve }) {
  const messages = [...history];
  const steps = [];
  const byName = new Map(tools.map((t) => [t.name, t]));
  let final = "";

  for (let step = 0; step <= maxSteps; step++) {
    if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    const withhold = step === maxSteps;
    onEvent({ type: "step", step });
    const res = await send({ messages, tools: withhold ? [] : tools, step, finalAnswer: withhold });
    if (res.usage) onEvent({ type: "usage", usage: res.usage, step });
    const record = { text: res.text || "", reasoning: res.reasoning || "", toolCalls: res.toolCalls || [], toolResults: [], raw: res.raw };
    steps.push(record);

    if (!record.toolCalls.length || withhold) {
      final = record.text || (withhold ? "Ho raggiunto il limite di passi a metà compito. Ecco a che punto siamo — chiedimi di continuare." : "");
      break;
    }

    messages.push({ role: "assistant", text: record.text, toolCalls: record.toolCalls, raw: record.raw });
    for (const call of record.toolCalls) {
      if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      const tool = byName.get(call.name);
      let output;
      let isError = false;
      onEvent({ type: "tool", id: call.id, name: call.name, args: call.args, status: "running" });
      if (!tool) {
        output = `Tool sconosciuto "${call.name}". Tool disponibili: ${[...byName.keys()].join(", ")}`;
        isError = true;
      } else {
        const invalid = validateArgs(tool.schema, call.args);
        if (invalid) {
          output = JSON.stringify({ INVALID_JSON: invalid });
          isError = true;
        } else {
          const decision = approvalFor(tool, call.args, access);
          let allowed = decision === "allow";
          if (decision === "ask") {
            onEvent({ type: "tool", id: call.id, name: call.name, args: call.args, status: "waiting" });
            allowed = await approve({ tool: call.name, args: call.args, kind: tool.kind, description: tool.description });
          }
          if (!allowed) {
            output = refusal(call.name, decision === "deny" ? "readonly" : access);
            isError = true;
          } else {
            onEvent({ type: "tool", id: call.id, name: call.name, args: call.args, status: "running" });
            try {
              output = await tool.run(call.args, { ...ctx, signal });
              if (typeof output !== "string") output = JSON.stringify(output, null, 2);
            } catch (e) {
              if (e?.name === "AbortError") throw e;
              output = `Errore: ${e?.message || e}`;
              isError = true;
            }
          }
        }
      }
      record.toolResults.push({ id: call.id, name: call.name, output, isError });
      onEvent({ type: "tool", id: call.id, name: call.name, args: call.args, status: isError ? "error" : "ok", output });
    }
    messages.push({ role: "tool", results: record.toolResults });
  }
  return { text: final, steps };
}

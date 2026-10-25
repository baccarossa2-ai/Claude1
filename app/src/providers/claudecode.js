// "Collegamento Claude Code": drives the user's own `claude` CLI (their Claude
// subscription) in headless stream-json mode from the desktop main process.
// Claude Code runs its own agent loop and tools; we render its stream and
// answer its permission prompts (`can_use_tool`) with our approval dialog.
import { invoke, isDesktop, onNative } from "../platform/native.js";

export const claudeCodeAvailable = isDesktop;

export function detectClaudeCode(customPath) {
  if (!isDesktop) return Promise.resolve({ installed: false, reason: "solo desktop" });
  return invoke("claudecode:detect", customPath || null);
}

/** Live model list from Claude Code itself (control request `initialize`, no tokens spent). */
export function claudeCodeModels(customPath) {
  if (!isDesktop) return Promise.resolve([]);
  return invoke("claudecode:models", customPath || null);
}

export function claudeCodeLogin(customPath) {
  return invoke("claudecode:login", customPath || null);
}

const ACCESS_TO_MODE = { readonly: "plan", ask: "default", full: "bypassPermissions" };

/**
 * One user turn on a (possibly resumed) Claude Code session. `key` names the
 * long-lived process (one per conversation). Returns when Claude Code emits
 * its `result` for this turn.
 */
export function runClaudeCodeTurn({ key, cwd, model, effort, access, chatOnly, resume, systemAppend, content, customPath, signal, onText, onReasoning, onTool, onApproval, onSession }) {
  return new Promise((resolve, reject) => {
    let finished = false;
    let sawPartialText = false;
    let text = "";
    const tools = new Map();

    const done = (fn, v) => {
      if (finished) return;
      finished = true;
      offEvent();
      offExit();
      signal?.removeEventListener?.("abort", onAbort);
      fn(v);
    };

    const onAbort = () => {
      invoke("claudecode:interrupt", key).catch(() => {});
      done(reject, Object.assign(new Error("aborted"), { name: "AbortError" }));
    };

    const offExit = onNative("claudecode:exit", (ev) => {
      if (ev.key !== key) return;
      done(reject, Object.assign(new Error(ev.stderr?.trim() || `Claude Code si è chiuso (codice ${ev.code})`), { kind: /login|auth|log in/i.test(ev.stderr || "") ? "auth" : "error" }));
    });

    const offEvent = onNative("claudecode:event", async (ev) => {
      if (ev.key !== key) return;
      const msg = ev.msg;
      switch (msg.type) {
        case "system":
          if (msg.subtype === "init") onSession?.({ sessionId: msg.session_id, model: msg.model, tools: msg.tools });
          break;
        case "stream_event": {
          const e = msg.event;
          if (e?.type === "content_block_delta") {
            if (e.delta?.type === "text_delta") {
              sawPartialText = true;
              text += e.delta.text;
              onText?.(e.delta.text);
            } else if (e.delta?.type === "thinking_delta") onReasoning?.(e.delta.thinking);
          } else if (e?.type === "message_start") sawPartialText = false;
          break;
        }
        case "assistant": {
          for (const b of msg.message?.content || []) {
            if (b.type === "text" && !sawPartialText && !msg.parent_tool_use_id) {
              text += b.text;
              onText?.(b.text);
            } else if (b.type === "tool_use") {
              tools.set(b.id, b);
              onTool?.({ id: b.id, name: b.name, args: b.input, status: "running" });
            }
          }
          break;
        }
        case "user": {
          const blocks = Array.isArray(msg.message?.content) ? msg.message.content : [];
          for (const b of blocks) {
            if (b.type !== "tool_result") continue;
            const t = tools.get(b.tool_use_id);
            const output = Array.isArray(b.content) ? b.content.map((c) => c.text || (c.type === "image" ? "[immagine]" : "")).join("\n") : String(b.content ?? "");
            onTool?.({ id: b.tool_use_id, name: t?.name || "tool", args: t?.input, status: b.is_error ? "error" : "ok", output });
          }
          break;
        }
        case "control_request": {
          const req = msg.request || {};
          if (req.subtype === "can_use_tool") {
            const approved = await onApproval?.({ tool: req.tool_name, args: req.input, reason: req.decision_reason || req.description || "" });
            invoke("claudecode:respond", key, msg.request_id, approved ? { behavior: "allow", updatedInput: req.input } : { behavior: "deny", message: "L'utente ha rifiutato questa azione." }).catch(() => {});
          } else {
            invoke("claudecode:respond", key, msg.request_id, {}).catch(() => {});
          }
          break;
        }
        case "result": {
          if (msg.is_error || (msg.subtype && msg.subtype !== "success")) {
            const reason = msg.result || (Array.isArray(msg.errors) ? msg.errors.join("; ") : msg.subtype);
            done(reject, Object.assign(new Error(reason || "Claude Code ha restituito un errore"), { kind: /limit|usage|quota/i.test(reason || "") ? "quota" : "error" }));
          } else {
            if (!text && msg.result) {
              text = msg.result;
              onText?.(msg.result);
            }
            done(resolve, { text, sessionId: msg.session_id, costUsd: msg.total_cost_usd, usage: msg.usage, turns: msg.num_turns });
          }
          break;
        }
        default:
          break;
      }
    });

    if (signal?.aborted) return onAbort();
    signal?.addEventListener?.("abort", onAbort);

    invoke("claudecode:turn", key, {
      cwd,
      model,
      effort,
      permissionMode: ACCESS_TO_MODE[access] || "default",
      chatOnly: !!chatOnly,
      resume: resume || null,
      systemAppend: systemAppend || "",
      customPath: customPath || null,
      content,
    }).catch((e) => done(reject, e));
  });
}

export function stopClaudeCode(key) {
  return isDesktop ? invoke("claudecode:stop", key).catch(() => {}) : Promise.resolve();
}

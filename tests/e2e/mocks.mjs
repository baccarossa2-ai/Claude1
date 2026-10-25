// Mock backends for the end-to-end test: an OpenAI-compatible provider, an
// Anthropic-compatible provider, and a fake `claude` CLI speaking stream-json.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const sse = (res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  return (obj, event) => res.write((event ? `event: ${event}\n` : "") + `data: ${typeof obj === "string" ? obj : JSON.stringify(obj)}\n\n`);
};

const body = (req) => new Promise((r) => {
  let b = "";
  req.on("data", (d) => (b += d));
  req.on("end", () => r(b ? JSON.parse(b) : {}));
});

export async function startMocks() {
  const log = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    // ---------------- OpenAI-compatible ----------------
    if (url.pathname === "/openai/v1/models") return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ data: [{ id: "mock-coder" }, { id: "mock-chat" }] }));
    if (url.pathname === "/openai/v1/chat/completions") {
      const b = await body(req);
      log.push({ kind: "openai", body: b });
      const send = sse(res);
      const last = b.messages[b.messages.length - 1];
      if (last.role === "tool") {
        for (const piece of ["Ho creato ", "hello.txt ", "✅"]) send({ choices: [{ delta: { content: piece } }] });
      } else {
        // Tool call split over several chunks, like real providers stream it.
        send({ choices: [{ delta: { reasoning: "Devo creare il file." } }] });
        send({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "write_file", arguments: "" } }] } }] });
        send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"hello.txt",' } }] } }] });
        send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"content":"Ciao dal mock!"}' } }] } }] });
      }
      send("[DONE]");
      return res.end();
    }
    // ---------------- Anthropic-compatible ----------------
    if (url.pathname === "/anthropic/v1/models") return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ data: [{ id: "claude-mock-1", display_name: "Mock Claude", created_at: "2026-01-01T00:00:00Z", type: "model" }], has_more: false, first_id: "claude-mock-1", last_id: "claude-mock-1" }));
    if (url.pathname === "/anthropic/v1/messages") {
      const b = await body(req);
      log.push({ kind: "anthropic", body: b });
      const send = sse(res);
      const last = b.messages[b.messages.length - 1];
      const hasResult = Array.isArray(last.content) && last.content.some((c) => c.type === "tool_result");
      const msg = (stop, content) => ({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: b.model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } });
      send(msg(), "message_start");
      if (hasResult) {
        send({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, "content_block_start");
        for (const t of ["Il risultato ", "è 42."]) send({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } }, "content_block_delta");
        send({ type: "content_block_stop", index: 0 }, "content_block_stop");
        send({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }, "message_delta");
      } else {
        send({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }, "content_block_start");
        send({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Uso la calcolatrice." } }, "content_block_delta");
        send({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } }, "content_block_delta");
        send({ type: "content_block_stop", index: 0 }, "content_block_stop");
        send({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "calculator", input: {} } }, "content_block_start");
        send({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"expression":' } }, "content_block_delta");
        send({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"21*2"}' } }, "content_block_delta");
        send({ type: "content_block_stop", index: 1 }, "content_block_stop");
        send({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } }, "message_delta");
      }
      send({ type: "message_stop" }, "message_stop");
      return res.end();
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${server.address().port}`, log };
}

/** A fake `claude` executable. Its model list is read from MOCK_CLAUDE_MODELS each time. */
export function writeFakeClaude(dir) {
  const file = path.join(dir, "fake-claude");
  fs.writeFileSync(
    file,
    `#!/usr/bin/env node
const fs = require("fs");
const argv = process.argv.slice(2);
if (argv.includes("--version")) { console.log("9.9.9 (Claude Code)"); process.exit(0); }
if (argv[0] === "auth" && argv[1] === "status") { console.log(JSON.stringify({ loggedIn: true, subscriptionType: "max" })); process.exit(0); }
fs.appendFileSync(process.env.MOCK_CLAUDE_LOG || "/dev/null", JSON.stringify(argv) + "\\n");
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const sid = "sess-mock-1";
let buf = "", waiting = null;
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    fs.appendFileSync(process.env.MOCK_CLAUDE_LOG || "/dev/null", line + "\\n");
    if (m.type === "control_request" && m.request.subtype === "initialize") {
      const models = JSON.parse(fs.readFileSync(process.env.MOCK_CLAUDE_MODELS, "utf8"));
      out({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: { models, account: { subscriptionType: "max" } } } });
    } else if (m.type === "control_response" && waiting) { const w = waiting; waiting = null; w(m.response.response); }
    else if (m.type === "user") turn(m);
  }
});
async function turn(m) {
  out({ type: "system", subtype: "init", session_id: sid, model: argv[argv.indexOf("--model") + 1], tools: ["Bash", "Read"] });
  const text = m.message.content.map((c) => c.text || "").join(" ");
  const sawHistory = text.includes("<cronologia_precedente>");
  out({ type: "stream_event", event: { type: "message_start" }, session_id: sid });
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Eseguo un comando. " } }, session_id: sid });
  out({ type: "assistant", message: { content: [{ type: "text", text: "Eseguo un comando. " }, { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "echo hi" } }] }, session_id: sid });
  out({ type: "control_request", request_id: "perm_1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "echo hi" } } });
  const decision = await new Promise((r) => (waiting = r));
  out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu_1", content: decision.behavior === "allow" ? "hi" : "denied", is_error: decision.behavior !== "allow" }] }, session_id: sid });
  out({ type: "stream_event", event: { type: "message_start" }, session_id: sid });
  const final = (decision.behavior === "allow" ? "Comando eseguito." : "Comando rifiutato.") + (sawHistory ? " Ho letto la cronologia precedente." : "");
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: final } }, session_id: sid });
  out({ type: "assistant", message: { content: [{ type: "text", text: final }] }, session_id: sid });
  out({ type: "result", subtype: "success", is_error: false, result: final, session_id: sid, total_cost_usd: 0.0012, num_turns: 2 });
}
`,
    { mode: 0o755 }
  );
  return file;
}

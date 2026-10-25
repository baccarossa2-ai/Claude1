// Unit tests for the pure parts: the Claude model table rules, the agent's
// argument validation and calculator, path confinement, globbing, skills.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTable, diffTables, latestPerFamily, parseClaudeId, fromClaudeCodeModels } from "../../app/src/providers/claude-models.js";
import { parseSkill } from "../../app/src/skills/index.js";
import { cleanRel, globToRegExp } from "../../app/src/agent/workspace.js";
import { calculate, validateArgs, toolsForTurn, approvalFor, BASE_TOOLS } from "../../app/src/agent/tools.js";
import { buildHistory } from "../../app/src/agent/prompt.js";

test("parseClaudeId reads new, dated and legacy ids", () => {
  assert.deepEqual(parseClaudeId("claude-opus-5-5"), { family: "opus", major: 5, minor: 5, date: 0 });
  assert.deepEqual(parseClaudeId("claude-opus-5"), { family: "opus", major: 5, minor: 0, date: 0 });
  assert.equal(parseClaudeId("claude-haiku-4-5-20251001").date, 20251001);
  assert.equal(parseClaudeId("claude-3-5-sonnet-20241022").family, "sonnet");
  assert.equal(parseClaudeId("gpt-6"), null);
});

test("the table keeps only the newest model of each family", () => {
  const t = latestPerFamily([{ id: "claude-opus-5" }, { id: "claude-opus-5-5" }, { id: "claude-sonnet-5" }, { id: "claude-sonnet-5-5" }, { id: "claude-haiku-4-5-20251001" }, { id: "claude-haiku-5-5" }, { id: "claude-fable-5-1" }]);
  assert.deepEqual(t.map((m) => m.id), ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
  assert.equal(t[1].name, "Claude Opus 5.5");
});

test("Opus 5 → Opus 5.5: the old row disappears and the new one takes its place", () => {
  const before = buildTable({ code: [{ id: "claude-opus-5" }, { id: "claude-sonnet-5-5" }] });
  const after = buildTable({ code: [{ id: "claude-opus-5-5" }, { id: "claude-sonnet-5-5" }] });
  assert.ok(!after.some((m) => m.id === "claude-opus-5"));
  assert.equal(after.find((m) => m.family === "opus").id, "claude-opus-5-5");
  const d = diffTables(before, after);
  assert.equal(d.replaced.length, 1);
  assert.equal(d.replaced[0].from.id, "claude-opus-5");
  assert.equal(d.replaced[0].to.id, "claude-opus-5-5");
  assert.equal(diffTables(after, after).changed, false);
});

test("Claude Code's initialize list maps aliases to resolved models", () => {
  const list = fromClaudeCodeModels([
    { value: "default", resolvedModel: "claude-sonnet-5-5" },
    { value: "opus", resolvedModel: "claude-opus-5-5", description: "Opus 5.5" },
    { value: "fable", resolvedModel: "claude-fable-5-1", description: "Fable 5.1 · Requires usage credits" },
  ]);
  assert.deepEqual(list.map((m) => m.id), ["claude-opus-5-5", "claude-fable-5-1"]);
  assert.equal(list[1].needsCredits, true);
});

test("cleanRel confines model paths to the workspace", () => {
  assert.equal(cleanRel("src/./a/../b.js"), "src/b.js");
  assert.equal(cleanRel("a\\b\\c.txt"), "a/b/c.txt");
  assert.throws(() => cleanRel("../etc/passwd"));
  assert.throws(() => cleanRel("/etc/passwd"));
  assert.throws(() => cleanRel("C:\\Windows\\x"));
});

test("globs", () => {
  assert.ok(globToRegExp("**/*.js").test("src/a/b.js"));
  assert.ok(globToRegExp("**/*.js").test("b.js"));
  assert.ok(!globToRegExp("*.js").test("src/b.js"));
  assert.ok(globToRegExp("src/**/test_*.{py,js}").test("src/x/y/test_a.py"));
});

test("calculator", () => {
  assert.equal(calculate("2+3*4"), 14);
  assert.equal(calculate("2^3^2"), 512);
  assert.equal(calculate("5!"), 120);
  assert.ok(Math.abs(calculate("sqrt(2)*sqrt(2)") - 2) < 1e-12);
  assert.equal(calculate("(1,5+0,5)*2"), 4);
  assert.throws(() => calculate("alert(1)"));
});

test("argument validation", () => {
  const schema = BASE_TOOLS.find((t) => t.name === "edit_file").schema;
  assert.equal(validateArgs(schema, { path: "a", old_string: "x", new_string: "y" }), null);
  assert.match(validateArgs(schema, { path: "a" }), /old_string/);
  assert.match(validateArgs(schema, { path: 3, old_string: "x", new_string: "y" }), /string/);
  assert.match(validateArgs(schema, { __invalid_json: "{" }), /JSON/);
});

test("plan mode offers only read tools; access levels gate writes", () => {
  const plan = toolsForTurn({ mode: "code", agentMode: "plan", hasWorkspace: true });
  assert.ok(plan.every((t) => ["read", "meta", "net", "sandbox"].includes(t.kind)));
  assert.ok(!plan.some((t) => t.name === "write_file"));
  const w = BASE_TOOLS.find((t) => t.name === "write_file");
  assert.equal(approvalFor(w, {}, "readonly"), "deny");
  assert.equal(approvalFor(w, {}, "ask"), "ask");
  assert.equal(approvalFor(w, {}, "full"), "allow");
  const http = BASE_TOOLS.find((t) => t.name === "http_request");
  assert.equal(approvalFor(http, { method: "GET" }, "ask"), "allow");
  assert.equal(approvalFor(http, { method: "POST" }, "ask"), "ask");
  assert.ok(!toolsForTurn({ mode: "chat", hasWorkspace: false }).some((t) => t.name === "write_file"));
});

test("skills front matter", () => {
  const s = parseSkill("---\nname: demo\ndescription: \"does things\"\n---\n\n# Body\nx");
  assert.deepEqual(s, { name: "demo", description: "does things", content: "# Body\nx" });
  assert.equal(parseSkill("just text", "file").name, "file");
});

test("history hands a Cloudy thread to Claude as text, replays same-provider steps", () => {
  const msgs = [
    { role: "user", content: "ciao", attachments: [{ kind: "text", name: "a.txt", data: "file!" }] },
    { role: "assistant", providerKind: "cloudy", model: "glm", content: "fatto", steps: [{ text: "", toolCalls: [{ id: "c1", name: "read_file", args: { path: "a" } }], toolResults: [{ id: "c1", name: "read_file", output: "contenuto" }] }, { text: "fatto", toolCalls: [], toolResults: [] }] },
  ];
  const toClaude = buildHistory(msgs, { target: "anthropic", model: "claude-opus-5-5" });
  assert.equal(toClaude.length, 2);
  assert.equal(toClaude[0].attachments[0].data, "file!");
  assert.match(toClaude[1].text, /read_file/);
  assert.match(toClaude[1].text, /fatto/);
  const toCloudy = buildHistory(msgs, { target: "cloudy", model: "glm" });
  assert.equal(toCloudy.filter((m) => m.role === "tool").length, 1);
  assert.equal(toCloudy[1].toolCalls[0].name, "read_file");
});

// Conversations: an index in IndexedDB plus one record per conversation.
import { dbDel, dbGet, dbSet } from "../lib/db.js";
import { debounce, uid } from "../lib/util.js";
import { isDesktop } from "../platform/native.js";
import { defaultModelRef } from "./models.js";
import { getSettings, store, updateSettings } from "./store.js";

const INDEX_KEY = "conv-index";
const convKey = (id) => `conv:${id}`;

export async function loadIndex() {
  const index = (await dbGet(INDEX_KEY)) || [];
  store.set({ conversations: index.sort((a, b) => b.updatedAt - a.updatedAt) });
  return index;
}

function indexEntry(c) {
  return { id: c.id, title: c.title, mode: c.mode, model: c.model, updatedAt: c.updatedAt, pinned: !!c.pinned, workspace: c.workspace || null };
}

async function writeIndex() {
  await dbSet(INDEX_KEY, store.get().conversations);
}

export function newConversation(mode = "chat", opts = {}) {
  const s = getSettings();
  const conv = {
    id: uid("c_"),
    title: "Nuova conversazione",
    mode,
    model: opts.model || store.get().current?.model || defaultModelRef(),
    access: s.access,
    agentMode: s.agentMode,
    effort: s.effort,
    workspace: mode === "chat" ? null : opts.workspace || s.lastWorkspace || (isDesktop ? null : "Progetto"),
    messages: [],
    artifacts: [],
    todos: [],
    claudeSession: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    draft: true,
  };
  store.set({ current: conv, panel: mode === "cowork" ? "tasks" : null });
  return conv;
}

export async function openConversation(id) {
  const conv = await dbGet(convKey(id));
  if (!conv) return null;
  store.set({ current: conv, panel: conv.artifacts?.length ? store.get().panel : store.get().panel === "artifacts" ? null : store.get().panel });
  return conv;
}

const persistNow = async (conv) => {
  if (!conv || conv.draft) return;
  await dbSet(convKey(conv.id), conv);
  store.set((s) => {
    const others = s.conversations.filter((c) => c.id !== conv.id);
    return { conversations: [indexEntry(conv), ...others].sort((a, b) => (b.pinned - a.pinned) || b.updatedAt - a.updatedAt) };
  });
  await writeIndex();
};
const persistLater = debounce((c) => persistNow(c), 400);

/** Save a conversation (debounced unless `now`). Drafts become real on first message. */
export function saveConversation(conv, now = false) {
  conv.updatedAt = Date.now();
  if (conv.draft && conv.messages.length) delete conv.draft;
  return now ? persistNow(conv) : persistLater(conv);
}

export async function deleteConversation(id) {
  await dbDel(convKey(id));
  store.set((s) => ({ conversations: s.conversations.filter((c) => c.id !== id), current: s.current?.id === id ? null : s.current }));
  await writeIndex();
}

export async function renameConversation(id, title) {
  const conv = store.get().current?.id === id ? store.get().current : await dbGet(convKey(id));
  if (!conv) return;
  conv.title = title.trim() || conv.title;
  await saveConversation(conv, true);
  store.set((s) => ({ rev: s.rev + 1 }));
}

export async function togglePin(id) {
  const conv = store.get().current?.id === id ? store.get().current : await dbGet(convKey(id));
  if (!conv) return;
  conv.pinned = !conv.pinned;
  await persistNow(conv);
}

export function setCurrentField(field, value) {
  const conv = store.get().current;
  if (!conv) return;
  conv[field] = value;
  if (field === "workspace" && value) updateSettings({ lastWorkspace: value });
  saveConversation(conv);
  store.set((s) => ({ rev: s.rev + 1 }));
}

/** A short title from the first message (no model call — instant and free). */
export function autoTitle(text) {
  const line = String(text || "").replace(/\s+/g, " ").trim();
  if (!line) return "Nuova conversazione";
  return line.length > 48 ? line.slice(0, 46).replace(/\s+\S*$/, "") + "…" : line;
}

export async function exportAll() {
  const out = [];
  for (const c of store.get().conversations) out.push(await dbGet(convKey(c.id)));
  return { app: "cloudy-desktop", version: 2, exportedAt: new Date().toISOString(), conversations: out.filter(Boolean) };
}

export async function importAll(data) {
  const list = Array.isArray(data?.conversations) ? data.conversations : [];
  for (const c of list) if (c?.id && Array.isArray(c.messages)) await dbSet(convKey(c.id), c);
  const merged = new Map(store.get().conversations.map((c) => [c.id, c]));
  for (const c of list) if (c?.id) merged.set(c.id, indexEntry(c));
  store.set({ conversations: [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt) });
  await writeIndex();
  return list.length;
}

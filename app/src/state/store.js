// The app's single store, its persisted settings, and small UI actions
// (toasts, dialogs, approvals) every other state module uses.
import { createStore } from "../lib/store.js";
import { lsGet, lsSet } from "../lib/db.js";
import { uid } from "../lib/util.js";
import { DEFAULT_BASE } from "../providers/cloudy.js";

export const DEFAULT_SETTINGS = {
  theme: "dark", // dark | light | auto
  accent: "#7c9cff",
  motion: "full", // full | reduced
  fontScale: 1,
  mascot: true,
  sponsor: true,
  defaultModel: null,
  effort: "medium",
  access: "ask", // readonly | ask | full
  agentMode: "build", // build | plan
  maxSteps: 30,
  chatTools: true,
  customInstructions: "",
  linuxBackend: "v86", // v86 | wsl | host
  linuxMemory: 128,
  linuxNetwork: "none", // none | fetch | relay
  linuxRelayUrl: "",
  useOriginalEngine: false,
  cloudyBase: DEFAULT_BASE,
  claude: {
    via: "auto", // auto | code | api
    codePath: "",
    enabled: {}, // model id -> true (shown in the picker)
    fallbacks: false, // server-side refusal fallback — off: never switch models without asking
  },
  providers: [], // custom providers (keys live in secrets)
  connectors: {}, // id -> { enabled, token?, url?, ... }
  customConnectors: [],
  plugins: {}, // id -> true
  customPlugins: [],
  userSkills: [],
  disabledSkills: [],
  memories: [],
  lastWorkspace: null,
  onboarded: false,
  sidebarOpen: true,
};

function loadSettings() {
  const saved = lsGet("cloudy.settings", {});
  return { ...DEFAULT_SETTINGS, ...saved, claude: { ...DEFAULT_SETTINGS.claude, ...(saved.claude || {}) } };
}

export const store = createStore({
  ready: false,
  settings: loadSettings(),
  cloudy: { token: null, user: null, models: [], defaultModel: null, usage: null, providers: [], ad: null, offline: false },
  claude: { table: [], updatedAt: 0, history: [], code: null, hasKey: false, refreshing: false, error: null },
  providerModels: {}, // providerId -> [{id,name}]
  conversations: [], // index: {id,title,mode,model,updatedAt,pinned}
  current: null, // full conversation object
  rev: 0, // bumped when the current conversation is mutated in place
  streaming: {}, // convId -> true
  dialog: null,
  approvals: [],
  toasts: [],
  panel: null, // artifacts | linux | files | tasks | null
  panelArtifact: null,
  windows: [],
  connectorState: {}, // id -> { status, tools, error }
  palette: false,
  sponsorHidden: false,
});

export const getSettings = () => store.get().settings;

export function updateSettings(patch) {
  const prev = store.get().settings;
  const next = { ...prev, ...(typeof patch === "function" ? patch(prev) : patch) };
  lsSet("cloudy.settings", next);
  store.set({ settings: next });
  return next;
}

export function toast(text, kind = "info", ms = 4200) {
  const id = uid("t");
  store.set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
  return id;
}

export function openDialog(dialog) {
  store.set({ dialog });
}

export function closeDialog() {
  store.set({ dialog: null });
}

/** Ask the user something through a dialog; resolves with their answer. */
export function askDialog(dialog) {
  return new Promise((resolve) => {
    store.set({
      dialog: {
        ...dialog,
        resolve: (v) => {
          store.set({ dialog: null });
          resolve(v);
        },
      },
    });
  });
}

/** Queue an approval request; resolves true/false when the user answers. */
export function requestApproval(req) {
  return new Promise((resolve) => {
    const id = uid("apr_");
    store.set((s) => ({
      approvals: [
        ...s.approvals,
        {
          id,
          ...req,
          resolve: (v) => {
            store.set((st) => ({ approvals: st.approvals.filter((a) => a.id !== id) }));
            resolve(v);
          },
        },
      ],
    }));
  });
}

export const bump = () => store.set((s) => ({ rev: s.rev + 1 }));

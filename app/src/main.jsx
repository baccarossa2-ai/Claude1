import { createRoot } from "react-dom/client";
import { App } from "./ui/App.jsx";
import { initApp } from "./state/init.js";
import { loadCloudee } from "./ui/Cloudee.jsx";
import { isAndroid } from "./platform/native.js";
import { store, updateSettings } from "./state/store.js";
import { sendMessage } from "./state/send.js";
import { linux } from "./linux/vm.js";
import * as models from "./state/models.js";
import * as conversations from "./state/conversations.js";
import * as account from "./state/init.js";
import * as connectors from "./state/connectors.js";

// A handle for the end-to-end tests (tests/e2e) and for curious users in the
// devtools console. It exposes the app's own state functions, nothing native.
window.cloudyDebug = { store, updateSettings, sendMessage, linux, models, conversations, account, connectors };

loadCloudee().catch(() => {});
createRoot(document.getElementById("root")).render(<App />);
initApp().catch((e) => console.error("init failed", e));

if (isAndroid) {
  import("./platform/android.js").then((m) => m.setupAndroid()).catch(() => {});
}

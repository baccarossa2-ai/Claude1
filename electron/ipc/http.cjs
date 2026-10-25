// HTTP for the renderer, streamed back chunk by chunk (SSE renders live).
// Uses Chromium's network stack (net.fetch): system proxy settings and the
// OS certificate store apply, exactly like a browser — but without CORS.
const { ipcMain, net } = require("electron");

const active = new Map();

function register() {
  ipcMain.handle("http:start", (e, id, req) => {
    const ctrl = new AbortController();
    active.set(id, ctrl);
    const send = (msg) => {
      if (!e.sender.isDestroyed()) e.sender.send("http:event", { id, ...msg });
    };
    (async () => {
      try {
        const res = await net.fetch(req.url, {
          method: req.method || "GET",
          headers: req.headers || {},
          body: req.body == null || req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
          signal: ctrl.signal,
          redirect: "follow",
          bypassCustomProtocolHandlers: true,
        });
        const headers = {};
        res.headers.forEach((v, k) => (headers[k] = v));
        send({ type: "head", status: res.status, statusText: res.statusText, headers, url: res.url });
        if (res.body) {
          const reader = res.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            send({ type: "chunk", data: value });
          }
        }
        send({ type: "end" });
      } catch (err) {
        send({ type: "error", message: err?.name === "AbortError" ? "aborted" : err?.cause?.message || err?.message || String(err) });
      } finally {
        active.delete(id);
      }
    })();
    return true;
  });

  ipcMain.handle("http:abort", (_e, id) => {
    active.get(id)?.abort();
    active.delete(id);
    return true;
  });
}

module.exports = { register };

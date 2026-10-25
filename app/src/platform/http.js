// A fetch() that works the same on every host and is never blocked by CORS.
//
// Cloudy's API only allows `Content-Type` cross-origin, so a browser fetch with
// `Authorization` dies at the preflight. The desktop routes requests through
// the Electron main process (Node fetch), Android through a small native
// plugin (HttpURLConnection) — both stream the body back chunk by chunk, so SSE
// replies render token by token. What comes back is a real `Response`, which
// is why the same function can be handed to the Anthropic SDK as its `fetch`.
import { CloudyAndroid, invoke, isAndroid, isDesktop, onNative } from "./native.js";

let seq = 0;
const NULL_BODY = new Set([101, 103, 204, 205, 304]);

function normalizeHeaders(h) {
  const out = {};
  if (!h) return out;
  if (typeof Headers !== "undefined" && h instanceof Headers) {
    h.forEach((v, k) => (out[k] = v));
  } else if (Array.isArray(h)) {
    for (const [k, v] of h) out[k] = v;
  } else {
    for (const [k, v] of Object.entries(h)) if (v != null) out[k] = String(v);
  }
  return out;
}

async function normalizeBody(body) {
  if (body == null) return null;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (typeof Blob !== "undefined" && body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (body instanceof ReadableStream) return new Uint8Array(await new Response(body).arrayBuffer());
  return String(body);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

/**
 * Shared plumbing: `start(id)` kicks the native side off, events arrive through
 * `subscribe`, and the promise resolves with a streaming Response at `head`.
 */
function nativeFetch({ url, init, start, abort, subscribe }) {
  return new Promise((resolve, reject) => {
    const id = `h${++seq}_${Math.random().toString(36).slice(2, 8)}`;
    let controller = null;
    let settled = false;
    let finished = false;
    const stream = new ReadableStream({
      start(c) {
        controller = c;
      },
      cancel() {
        if (!finished) abort(id);
      },
    });
    const cleanup = () => {
      finished = true;
      off();
      init?.signal?.removeEventListener?.("abort", onAbort);
    };
    const off = subscribe((ev) => {
      if (!ev || ev.id !== id) return;
      if (ev.type === "head") {
        settled = true;
        const status = ev.status || 200;
        const res = new Response(NULL_BODY.has(status) ? null : stream, {
          status: status < 200 || status > 599 ? 200 : status,
          statusText: ev.statusText || "",
          headers: ev.headers || {},
        });
        Object.defineProperty(res, "url", { value: ev.url || url });
        resolve(res);
      } else if (ev.type === "chunk") {
        const bytes = ev.data instanceof Uint8Array ? ev.data : ev.base64 ? b64ToBytes(ev.base64) : new TextEncoder().encode(ev.text || "");
        try {
          controller.enqueue(bytes);
        } catch {
          /* reader went away */
        }
      } else if (ev.type === "end") {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        cleanup();
      } else if (ev.type === "error") {
        const err = new TypeError(ev.message || "network error");
        if (!settled) reject(err);
        else
          try {
            controller.error(err);
          } catch {
            /* closed */
          }
        cleanup();
      }
    });
    const onAbort = () => {
      abort(id);
      const err = new DOMException("The operation was aborted.", "AbortError");
      if (!settled) reject(err);
      try {
        controller.error(err);
      } catch {
        /* closed */
      }
      cleanup();
    };
    if (init?.signal?.aborted) return onAbort();
    init?.signal?.addEventListener?.("abort", onAbort);
    start(id).catch((e) => {
      if (!settled) reject(new TypeError(e?.message || String(e)));
      cleanup();
    });
  });
}

export async function httpFetch(input, init = {}) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!isDesktop && !isAndroid) return fetch(input, init);
  const method = (init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
  const headers = normalizeHeaders(init.headers || (typeof input === "object" && input.headers));
  const body = await normalizeBody(init.body);

  if (isDesktop) {
    return nativeFetch({
      url,
      init,
      start: (id) => invoke("http:start", id, { url, method, headers, body }),
      abort: (id) => invoke("http:abort", id).catch(() => {}),
      subscribe: (cb) => onNative("http:event", cb),
    });
  }
  return nativeFetch({
    url,
    init,
    start: (id) =>
      CloudyAndroid.httpStart({
        id,
        url,
        method,
        headers,
        bodyBase64: body == null ? null : typeof body === "string" ? bytesToB64(new TextEncoder().encode(body)) : bytesToB64(body),
      }),
    abort: (id) => CloudyAndroid.httpAbort({ id }).catch(() => {}),
    subscribe: (cb) => {
      let handle = null;
      let dead = false;
      CloudyAndroid.addListener("httpEvent", cb).then((h) => {
        handle = h;
        if (dead) h.remove();
      });
      return () => {
        dead = true;
        handle?.remove();
      };
    },
  });
}

/** JSON helper: { ok, status, body } and never throws on a non-2xx. */
export async function httpJson(url, init = {}) {
  const res = await httpFetch(url, {
    ...init,
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body, headers: res.headers };
}

/**
 * Read an SSE body line by line: calls onData(payloadString) for each `data:`
 * line (and onEvent(name) for `event:` lines). Resolves when the stream ends.
 */
export async function readSSE(res, onData, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line.startsWith("data:")) {
        if (onData(line.slice(5).trim()) === true) {
          reader.cancel().catch(() => {});
          return;
        }
      } else if (line.startsWith("event:")) onEvent?.(line.slice(6).trim());
    }
  }
  if (buf.startsWith("data:")) onData(buf.slice(5).trim());
}

export { bytesToB64, b64ToBytes };

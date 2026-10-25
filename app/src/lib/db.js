// IndexedDB key/value store (conversations, Linux files, notes) with a
// localStorage fallback for hosts that refuse IndexedDB.
const DB_NAME = "cloudy";
const STORE = "kv";
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export async function dbGet(key) {
  const db = await open();
  if (!db) {
    try {
      const v = localStorage.getItem("cloudy.db." + key);
      return v ? JSON.parse(v) : undefined;
    } catch {
      return undefined;
    }
  }
  return tx(db, "readonly", (s) => s.get(key));
}

export async function dbSet(key, value) {
  const db = await open();
  if (!db) {
    try {
      localStorage.setItem("cloudy.db." + key, JSON.stringify(value));
    } catch {
      /* quota */
    }
    return;
  }
  return tx(db, "readwrite", (s) => s.put(value, key));
}

export async function dbDel(key) {
  const db = await open();
  if (!db) {
    try {
      localStorage.removeItem("cloudy.db." + key);
    } catch {
      /* ignore */
    }
    return;
  }
  return tx(db, "readwrite", (s) => s.delete(key));
}

export async function dbKeys(prefix = "") {
  const db = await open();
  if (!db) {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("cloudy.db." + prefix)) out.push(k.slice("cloudy.db.".length));
    }
    return out;
  }
  const keys = await tx(db, "readonly", (s) => s.getAllKeys());
  return (keys || []).filter((k) => String(k).startsWith(prefix));
}

/** localStorage JSON helpers for small, synchronous settings. */
export function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

// Per-browser cache of workload day summaries (see daySummaries), in
// IndexedDB: a few hundred bytes per day, read only for the days a chart
// shows. Entries are keyed by device and date and carry a fingerprint of
// everything that affects the numbers; a different fingerprint is a miss.
// Storage can be unavailable (private windows, blocked site data), so every
// failure falls back to "not cached".
import { projectRules } from "./rule-engine.mjs";

const DB_NAME = "activitywatch-projects";
const STORE = "workload-days";
// Bump when daySummaries changes what it stores or how it counts.
const CACHE_VERSION = 2;

let opening = null;
function database() {
  opening ||= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}
const key = (host, date) => host + "|" + date;

export async function readDays(host, fingerprint, dates) {
  const found = new Map();
  const db = await database();
  if (!db) return found;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      for (const date of dates) {
        const request = store.get(key(host, date));
        request.onsuccess = () => {
          if (request.result?.fingerprint === fingerprint)
            found.set(date, request.result.summary);
        };
      }
      tx.oncomplete = () => resolve(found);
      tx.onerror = tx.onabort = () => resolve(new Map());
    } catch {
      resolve(new Map());
    }
  });
}

export async function writeDays(host, fingerprint, summaries) {
  if (!summaries.length) return;
  const db = await database();
  if (!db) return;
  await new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const summary of summaries)
        store.put({ fingerprint, summary }, key(host, summary.date));
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

// Everything that changes the numbers — not names, colors or archive flags.
export async function configFingerprint(config, host, startOfDay) {
  const text = JSON.stringify([
    CACHE_VERSION,
    host,
    startOfDay,
    config.projects.map((p) => [
      p.id,
      p.kind || "project",
      p.rulesFrom || "",
      p.rulesThrough || "",
      projectRules(p),
    ]),
    (config.activityTypes || []).map(({ name, color, ...type }) => type),
    config.manualAssignments || [],
  ]);
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(text),
    );
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // No SubtleCrypto (insecure context): a simple 53-bit string hash.
    let h1 = 0xdeadbeef,
      h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16) + text.length;
  }
}

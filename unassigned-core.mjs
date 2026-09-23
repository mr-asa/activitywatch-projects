import {
  merge,
  intersect,
  duration,
  browserFamily,
  clipSorted,
} from "./projects-core.mjs";
function subtractSorted(a, b) {
  const out = [];
  let j = 0;
  for (const [start, end] of a) {
    let cursor = start;
    while (j < b.length && b[j][1] <= start) j++;
    for (let k = j; k < b.length && b[k][0] < end; k++) {
      const [s, e] = b[k];
      if (s > cursor) out.push([cursor, Math.min(s, end)]);
      cursor = Math.max(cursor, e);
      if (cursor >= end) break;
    }
    if (cursor < end) out.push([cursor, end]);
  }
  return out;
}
export function subtract(a, b) {
  return subtractSorted(merge(a), merge(b));
}
const sourceIndexes = new WeakMap();
function overlappingEvents(source, start, end) {
  let index = sourceIndexes.get(source);
  if (!index) {
    let max = -Infinity;
    index = source.events
      .map((event, order) => {
        const start = Date.parse(event.timestamp);
        return { event, order, start, end: start + event.duration * 1000 };
      })
      .filter((e) => e.end > e.start)
      .sort((a, b) => a.start - b.start);
    for (const e of index) {
      max = Math.max(max, e.end);
      e.maxEnd = max;
    }
    sourceIndexes.set(source, index);
  }
  let lo = 0,
    hi = index.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (index[mid].maxEnd <= start) lo = mid + 1;
    else hi = mid;
  }
  const found = [];
  for (let i = lo; i < index.length && index[i].start < end; i++)
    if (index[i].end > start) found.push(index[i]);
  return found.sort((a, b) => a.order - b.order);
}
const rowCache = new WeakMap();
export function unassignedActivities(data, result, scope = null) {
  const key = scope ? scope.join(":") : "all";
  let cache = rowCache.get(result);
  if (!cache || cache.data !== data) {
    cache = { data, scopes: new Map() };
    rowCache.set(result, cache);
  }
  if (cache.scopes.has(key)) return cache.scopes.get(key);
  let free = result.segments
    .filter((s) => s.project === "unassigned")
    .map((s) => [s.start, s.end]);
  free = merge(free);
  if (scope) free = clipSorted(free, ...scope);
  const groups = new Map();
  const range = (e) => [
    Date.parse(e.timestamp),
    Date.parse(e.timestamp) + e.duration * 1000,
  ];
  function add(w, url, ranges) {
    if (!ranges.length) return;
    const title = w.data.title || "(No window title)",
      app = w.data.app || "Unknown application";
    const key = JSON.stringify([app, title, url]);
    if (!groups.has(key)) groups.set(key, { app, title, url, ranges: [] });
    groups.get(key).ranges.push(...ranges);
  }
  for (const w of data.windows) {
    const [start, end] = range(w);
    let remaining = clipSorted(free, start, end);
    if (!remaining.length) continue;
    const used = remaining;
    const family = browserFamily(w.data.app);
    if (family)
      for (const source of data.browsers || []) {
        if (source.family !== family) continue;
        for (const web of overlappingEvents(source, start, end)) {
          if (!remaining.length) break;
          const overlap = clipSorted(remaining, web.start, web.end);
          if (overlap.length) {
            add(w, web.event.data.url || "", overlap);
            remaining = subtractSorted(remaining, overlap);
          }
        }
      }
    add(w, "", remaining);
    free = subtractSorted(free, used);
  }
  const rows = [...groups.values()]
    .map((r) => ({
      ...r,
      ranges: merge(r.ranges),
      seconds: duration(r.ranges),
    }))
    .sort((a, b) => b.seconds - a.seconds || a.title.localeCompare(b.title));
  if (cache.scopes.size >= 8) cache.scopes.clear();
  cache.scopes.set(key, rows);
  return rows;
}
export function suggestedRule(row) {
  let usable = false,
    local = false;
  try {
    const u = new URL(row.url);
    usable = ["http:", "https:"].includes(u.protocol);
    local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  } catch {}
  return {
    kind: usable && !local ? "url" : "keyword",
    keyword:
      row.title === "(No window title)"
        ? ""
        : row.title.replace(/^\*+/, "").trim(),
    url: usable ? row.url : "",
  };
}

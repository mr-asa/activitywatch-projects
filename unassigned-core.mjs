import { merge, intersect, duration, browserFamily } from "./projects-core.mjs";
export function subtract(a, b) {
  const out = [];
  b = merge(b);
  for (const [start, end] of merge(a)) {
    let cursor = start;
    for (const [s, e] of b) {
      if (e <= cursor) continue;
      if (s >= end) break;
      if (s > cursor) out.push([cursor, Math.min(s, end)]);
      cursor = Math.max(cursor, e);
      if (cursor >= end) break;
    }
    if (cursor < end) out.push([cursor, end]);
  }
  return out;
}
export function unassignedActivities(data, result, scope = null) {
  let free = result.segments
    .filter((s) => s.project === "unassigned")
    .map((s) => [s.start, s.end]);
  if (scope) free = intersect(free, [scope]);
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
    let remaining = intersect([range(w)], free);
    if (!remaining.length) continue;
    const used = remaining;
    const family = browserFamily(w.data.app);
    if (family)
      for (const source of data.browsers || []) {
        if (source.family !== family) continue;
        for (const web of source.events) {
          const overlap = intersect(remaining, [range(web)]);
          if (overlap.length) {
            add(w, web.data.url || "", overlap);
            remaining = subtract(remaining, overlap);
          }
        }
      }
    add(w, "", remaining);
    free = subtract(free, used);
  }
  return [...groups.values()]
    .map((r) => ({
      ...r,
      ranges: merge(r.ranges),
      seconds: duration(r.ranges),
    }))
    .sort((a, b) => b.seconds - a.seconds || a.title.localeCompare(b.title));
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

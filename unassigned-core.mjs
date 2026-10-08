import {
  merge,
  intersect,
  duration,
  browserFamily,
  clipSorted,
  matchUrl,
  analyze,
} from "./projects-core.mjs";
import { readableUrl } from "./rule-engine.mjs";
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
// Claim each elementary window interval once, in original source order.
// Successor links skip previously claimed spans, including duplicate/overlapping
// windows, without repeatedly scanning the entire unassigned interval list.
function ownedWindows(windows) {
  const entries = windows
    .map((event) => {
      const start = Date.parse(event.timestamp);
      return { event, start, end: start + event.duration * 1000 };
    })
    .filter(
      ({ start, end }) =>
        Number.isFinite(start) && Number.isFinite(end) && end > start,
    );
  const points = [
    ...new Set(entries.flatMap(({ start, end }) => [start, end])),
  ].sort((a, b) => a - b);
  const indices = new Map(points.map((point, i) => [point, i]));
  const next = Uint32Array.from({ length: points.length }, (_, i) => i);
  const find = (i) => {
    let root = i;
    while (next[root] !== root) root = next[root];
    while (next[i] !== i) {
      const parent = next[i];
      next[i] = root;
      i = parent;
    }
    return root;
  };
  return entries.map(({ event, start, end }) => {
    const ranges = [];
    const stop = indices.get(end);
    for (let i = find(indices.get(start)); i < stop; i = find(i)) {
      const last = ranges.at(-1);
      if (last?.[1] === points[i]) last[1] = points[i + 1];
      else ranges.push([points[i], points[i + 1]]);
      next[i] = find(i + 1);
    }
    return { event, ranges, start, end };
  });
}
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
  function add(w, url, ranges) {
    if (!ranges.length) return;
    const title = w.data.title || "(No window title)",
      app = w.data.app || "Unknown application";
    const key = JSON.stringify([app, title, url]);
    if (!groups.has(key)) groups.set(key, { app, title, url, ranges: [] });
    groups.get(key).ranges.push(...ranges);
  }
  for (const { event: w, ranges, start, end } of ownedWindows(data.windows)) {
    let remaining = ranges.flatMap(([s, e]) => clipSorted(free, s, e));
    if (!remaining.length) continue;
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
const typeRangeCache = new WeakMap();
function typeSeconds(ranges, typeResult, id) {
  let byType = typeRangeCache.get(typeResult);
  if (!byType) {
    const grouped = new Map();
    for (const s of typeResult.segments) {
      if (!grouped.has(s.project)) grouped.set(s.project, []);
      grouped.get(s.project).push([s.start, s.end]);
    }
    byType = new Map([...grouped].map(([key, r]) => [key, merge(r)]));
    typeRangeCache.set(typeResult, byType);
  }
  return ranges.reduce(
    (n, [start, end]) =>
      n +
      clipSorted(byType.get(id) || [], start, end).reduce(
        (m, [s, e]) => m + (e - s) / 1000,
        0,
      ),
    0,
  );
}
// Time of the ranges that carries no activity type at all (types may overlap,
// so this is not the total minus the types' sum).
export const untypedSeconds = (ranges, typeResult) =>
  typeResult ? typeSeconds(ranges, typeResult, "unassigned") : 0;
export function activityTypeBreakdown(ranges, typeResult) {
  if (!typeResult) return [];
  return (
    typeResult.projects
      .map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        seconds: typeSeconds(ranges, typeResult, t.id),
      }))
      // Adjacent events can overlap by fractions of a second; not a real match.
      .filter((t) => t.seconds >= 1)
  );
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

// Levels a URL rule can be cut to: the site, each folder of the path, and the
// full link with its query. A URL rule also covers everything below its path.
export function urlLevels(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  if (!["http:", "https:"].includes(u.protocol)) return [];
  const segment = (s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const levels = [{ label: u.host, value: u.origin + "/", site: true }];
  let path = "";
  for (const part of u.pathname.split("/").filter(Boolean)) {
    path += "/" + part;
    levels.push({ label: segment(part), value: readableUrl(u.origin + path) });
  }
  if (u.search)
    levels.push({
      label: "?" + readableUrl(u.search.slice(1)),
      value: readableUrl(u.origin + u.pathname + u.search),
      query: true,
    });
  return levels;
}
// Rows (from unassignedActivities) whose page a URL rule would match.
export function urlCoverage(rows, pattern) {
  let count = 0,
    seconds = 0;
  for (const r of rows)
    if (r.url && matchUrl(r.url, pattern)) {
      count++;
      seconds += r.seconds;
    }
  return { count, seconds };
}

// What a new rule would do in the loaded period: the entries it catches (its
// own active time) and, when `next` projects are given, how every category's
// time changes against `previous`.
export function rulePreview(
  data,
  rule,
  start,
  end,
  { previous = null, next = null, projectId = null, options = {} } = {},
) {
  const alone = analyze(
    data,
    [{ id: "preview", name: "Preview", color: "#000000", rules: [rule] }],
    start,
    end,
  );
  const active = merge(
    alone.segments
      .filter((s) => s.project === "preview")
      .map((s) => [s.start, s.end]),
  );
  const byEntry = new Map();
  for (const e of alone.evidence) {
    const pieces = clipSorted(active, e.s, e.e);
    if (!pieces.length) continue;
    const key = JSON.stringify([e.label, e.app || ""]);
    const entry = byEntry.get(key) || {
      label: e.label,
      app: e.app || "",
      ranges: [],
    };
    entry.ranges.push(...pieces);
    byEntry.set(key, entry);
  }
  const matches = [...byEntry.values()]
    .map((m) => ({
      label: m.label,
      app: m.app,
      seconds: duration(merge(m.ranges)),
    }))
    .sort((a, b) => b.seconds - a.seconds);
  let changes = null;
  if (previous && next) {
    const after = analyze(data, next, start, end, options);
    const list = after.projects.map((p) => ({
      id: p.id,
      name: p.name,
      before: previous.projects.find((x) => x.id === p.id)?.total || 0,
      after: p.total,
    }));
    list.push(
      {
        id: "unassigned",
        name: "Not assigned",
        before: previous.unassigned,
        after: after.unassigned,
      },
      {
        id: "conflict",
        name: "Needs review",
        before: previous.conflict,
        after: after.conflict,
      },
    );
    changes = list
      .filter((c) => Math.abs(c.after - c.before) >= 1)
      .sort(
        (a, b) =>
          (b.id === projectId) - (a.id === projectId) ||
          Math.abs(b.after - b.before) - Math.abs(a.after - a.before),
      );
  }
  return { total: duration(active), matches, changes };
}

import {
  projectRules,
  normalizeRule,
  clipRule,
  ruleMatches,
  applicationMatches,
} from "./rule-engine.mjs";
export const PALETTE = [
  "#65d6b4",
  "#8ca8ff",
  "#edb96d",
  "#d79aeb",
  "#f18d9c",
  "#6dcce2",
  "#b5cc78",
];
export function merge(ranges) {
  const out = [];
  for (const r of ranges
    .filter(
      (r) => Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > r[0],
    )
    .map((r) => [...r])
    .sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push(r);
  }
  return out;
}
export function intersect(a, b) {
  a = merge(a);
  b = merge(b);
  const out = [];
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i][0], b[j][0]),
      e = Math.min(a[i][1], b[j][1]);
    if (e > s) out.push([s, e]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}
export const duration = (r) =>
  merge(r).reduce((n, [s, e]) => n + (e - s) / 1000, 0);
export const lines = (s) => [
  ...new Set(
    String(s || "")
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean),
  ),
];
export function normalizeUrl(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw Error(`Enter a full link starting with https://: ${value}`);
  }
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
    throw Error("Use an http or https link without login credentials.");
  u.hash = "";
  return u.href;
}
export function normalizeProject(input, others = []) {
  const name = String(input.name || "").trim();
  if (!name) throw Error("Give the project a name.");
  if (name.length > 80)
    throw Error("Keep the project name under 80 characters.");
  if (
    others.some(
      (p) =>
        p.id !== input.id &&
        p.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  )
    throw Error("A project with this name already exists.");
  if (!/^#[0-9a-f]{6}$/i.test(input.color || ""))
    throw Error("Choose a project color.");
  const keywords = lines(
    Array.isArray(input.keywords) ? input.keywords.join("\n") : input.keywords,
  );
  const urls = lines(
    Array.isArray(input.urls) ? input.urls.join("\n") : input.urls,
  ).map(normalizeUrl);
  const rules = projectRules({ ...input, keywords, urls }).map(normalizeRule);
  if (input.kind && !["project", "non-project"].includes(input.kind))
    throw Error("Choose a supported category type.");
  if (input.rulesThrough)
    normalizeRule({ pattern: "validation", through: input.rulesThrough });
  return {
    id: input.id,
    name,
    kind: input.kind || "project",
    archived: input.archived === true,
    rulesThrough: input.rulesThrough || "",
    color: input.color.toLowerCase(),
    rules,
    keywords: rules
      .filter((r) => r.type === "title" && r.mode === "text")
      .map((r) => r.pattern),
    urls: rules
      .filter((r) => r.type === "url" && r.mode === "text")
      .map((r) => r.pattern),
  };
}
function path(value) {
  try {
    return decodeURI(value).replace(/\/$/, "") || "/";
  } catch {
    return value;
  }
}
export function matchUrl(value, rule) {
  try {
    const u = new URL(value),
      r = new URL(rule);
    if (!["http:", "https:"].includes(u.protocol) || u.host !== r.host)
      return false;
    const p = path(u.pathname),
      rp = path(r.pathname);
    if (!(rp === "/" || p === rp || p.startsWith(rp + "/"))) return false;
    for (const [key, v] of r.searchParams)
      if (!u.searchParams.getAll(key).includes(v)) return false;
    return true;
  } catch {
    return false;
  }
}
export function browserFamily(app, title = "") {
  const a = String(app).toLowerCase();
  if (/^(chrome|chromium)(\.exe)?$|google.chrome/.test(a)) return "chrome";
  if (/firefox|librewolf|waterfox/.test(a)) return "firefox";
  if (/msedge|microsoft.edge/.test(a)) return "edge";
  for (const family of ["brave", "vivaldi", "opera"])
    if (a.includes(family)) return family;
  return null;
}
export function discoverBrowsers(buckets, host) {
  const families = ["chrome", "firefox", "edge", "brave", "vivaldi", "opera"];
  const sources = [],
    warnings = [];
  for (const family of families) {
    const ids = Object.keys(buckets).filter(
      (id) =>
        id.startsWith(`aw-watcher-web-${family}`) &&
        buckets[id].type === "web.tab.current" &&
        (buckets[id].hostname === host || id.endsWith("_" + host)),
    );
    if (ids.length === 1) sources.push({ id: ids[0], family });
    if (ids.length > 1)
      warnings.push(
        `Multiple ${family} sources found. URL matching for this browser is paused to avoid mixed profiles.`,
      );
  }
  return { sources, warnings };
}
export function matchTitle(title, keyword) {
  const raw = String(title || "").toLocaleLowerCase(),
    rule = String(keyword || "").toLocaleLowerCase();
  if (!rule.trim()) return false;
  if (raw.includes(rule)) return true;
  const clean = (s) =>
    s
      .replace(/\s*\[modified\]\s*/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  const normalized = clean(rule);
  return Boolean(normalized) && clean(raw).includes(normalized);
}
// Input must be sorted, disjoint ranges (as returned by merge).
export function clipSorted(ranges, start, end) {
  const out = [];
  let lo = 0,
    hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ranges[mid][1] <= start) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < ranges.length && ranges[i][0] < end; i++) {
    const s = Math.max(start, ranges[i][0]),
      e = Math.min(end, ranges[i][1]);
    if (e > s) out.push([s, e]);
  }
  return out;
}
export function analyze(data, projects, start, end, options = {}) {
  const range = (e) => [
    Math.max(start, Date.parse(e.timestamp)),
    Math.min(end, Date.parse(e.timestamp) + e.duration * 1000),
  ];
  const active = merge(
    data.afk.filter((e) => e.data.status === "not-afk").map(range),
  );
  const windows = data.windows
    .map((e) => ({ ...e, ranges: clipSorted(active, ...range(e)) }))
    .filter((e) => e.ranges.length);
  const tracked = merge(windows.flatMap((e) => e.ranges));
  const focusByFamily = new Map();
  for (const w of windows) {
    const family = browserFamily(w.data.app);
    if (!focusByFamily.has(family)) focusByFamily.set(family, []);
    focusByFamily.get(family).push(...w.ranges);
  }
  for (const [family, ranges] of focusByFamily)
    focusByFamily.set(family, merge(ranges));
  // Titles and URLs repeat heavily, so each rule is matched once per unique value.
  const titleGroups = new Map();
  for (const w of windows) {
    const key = JSON.stringify([w.data.app, w.data.title]);
    if (!titleGroups.has(key))
      titleGroups.set(key, {
        app: w.data.app,
        title: w.data.title,
        kind: browserFamily(w.data.app) ? "browser" : "desktop",
        windows: [],
      });
    titleGroups.get(key).windows.push(w);
  }
  const urlGroups = (data.browsers || []).map((source) => {
    const groups = new Map();
    for (const event of source.events) {
      const url = event.data.url;
      if (!groups.has(url)) groups.set(url, []);
      groups.get(url).push(event);
    }
    return { source, groups };
  });
  const editorFocus = new Map(
    (data.editors || []).map((source) => [
      source,
      merge(
        windows
          .filter((w) => applicationMatches(source.app, w.data.app))
          .flatMap((w) => w.ranges),
      ),
    ]),
  );
  const evidence = [];
  const add = (project, ranges, kind, label, manual = false, details = {}) => {
    for (const [s, e] of ranges)
      evidence.push({
        s,
        e,
        project: project.id,
        kind,
        label,
        manual,
        ...details,
      });
  };
  for (const project of projects) {
    for (const original of projectRules(project)) {
      const rule = { ...original };
      if (
        project.rulesThrough &&
        (!rule.through || project.rulesThrough < rule.through)
      )
        rule.through = project.rulesThrough;
      if (rule.type === "title")
        for (const group of titleGroups.values()) {
          if (!ruleMatches(rule, group.title, matchTitle, matchUrl, group.app))
            continue;
          for (const w of group.windows)
            add(
              project,
              clipRule(w.ranges, rule),
              group.kind,
              group.title || group.app,
              false,
              { rule, app: group.app },
            );
        }
      else if (rule.type.startsWith("editor-")) {
        for (const source of data.editors || []) {
          const focus = editorFocus.get(source);
          for (const event of source.events || []) {
            if (
              event.data?.eventType &&
              event.data.eventType !== "obsidian.activeFileHeartbeatEvent"
            )
              continue;
            const value = editorValue(event, rule.type);
            if (
              value &&
              ruleMatches(rule, value, matchTitle, matchUrl, source.app)
            )
              add(
                project,
                clipRule(clipSorted(focus, ...range(event)), rule),
                "desktop",
                value,
                false,
                { rule, app: source.app, source: source.id },
              );
          }
        }
      } else if (rule.type === "url")
        for (const { source, groups } of urlGroups) {
          const focus = focusByFamily.get(source.family) || [];
          for (const [url, events] of groups) {
            if (!ruleMatches(rule, url, matchTitle, matchUrl)) continue;
            for (const event of events)
              add(
                project,
                clipRule(clipSorted(focus, ...range(event)), rule),
                "browser",
                url,
                false,
                { rule, app: source.family },
              );
          }
        }
    }
  }
  for (const assignment of options.manualAssignments || []) {
    if (assignment.host !== options.host) continue;
    const project = projects.find((p) => p.id === assignment.projectId);
    if (!project) continue;
    const assignmentStart = Date.parse(assignment.start),
      assignmentEnd = Date.parse(assignment.end);
    for (const w of windows) {
      if (
        w.ranges[0][0] >= assignmentEnd ||
        w.ranges.at(-1)[1] <= assignmentStart
      )
        continue;
      add(
        project,
        clipSorted(w.ranges, assignmentStart, assignmentEnd),
        browserFamily(w.data.app) ? "browser" : "desktop",
        w.data.title || w.data.app,
        true,
        { assignment, app: w.data.app },
      );
    }
  }
  const changes = [];
  for (const [s, e] of tracked) {
    changes.push({ t: s, active: 1 }, { t: e, active: -1 });
  }
  for (const ev of evidence) {
    changes.push({ t: ev.s, ev, delta: 1 }, { t: ev.e, ev, delta: -1 });
  }
  changes.sort((a, b) => a.t - b.t);
  let activeCount = 0;
  const counts = new Map(),
    manualCounts = new Map(),
    kinds = new Map(),
    segments = [];
  let i = 0;
  while (i < changes.length) {
    const t = changes[i].t;
    while (i < changes.length && changes[i].t === t) {
      const c = changes[i++];
      if (c.active) activeCount += c.active;
      else {
        counts.set(c.ev.project, (counts.get(c.ev.project) || 0) + c.delta);
        if (c.ev.manual)
          manualCounts.set(
            c.ev.project,
            (manualCounts.get(c.ev.project) || 0) + c.delta,
          );
        const key = c.ev.project + ":" + c.ev.kind;
        kinds.set(key, (kinds.get(key) || 0) + c.delta);
      }
    }
    const next = changes[i]?.t;
    if (activeCount <= 0 || !(next > t)) continue;
    const manualIds = [...manualCounts.entries()]
      .filter(([, n]) => n > 0)
      .map(([id]) => id);
    const ids = (
      manualIds.length
        ? manualIds
        : [...counts.entries()].filter(([, n]) => n > 0).map(([id]) => id)
    ).sort();
    const project =
      ids.length === 1 ? ids[0] : ids.length ? "conflict" : "unassigned";
    const kind =
      ids.length === 1 && (kinds.get(project + ":browser") || 0) > 0
        ? "browser"
        : "desktop";
    const last = segments.at(-1);
    if (
      last &&
      last.end === t &&
      last.project === project &&
      last.kind === kind &&
      last.ids.join() === ids.join()
    )
      last.end = next;
    else segments.push({ start: t, end: next, project, kind, ids });
  }
  const results = projects.map((p) => ({
    ...p,
    total: 0,
    browser: 0,
    desktop: 0,
    evidence: [],
  }));
  const byId = new Map(results.map((p) => [p.id, p]));
  let conflict = 0,
    unassigned = 0;
  for (const s of segments) {
    const d = (s.end - s.start) / 1000;
    if (s.project === "conflict") conflict += d;
    else if (s.project === "unassigned") unassigned += d;
    else {
      const p = byId.get(s.project);
      p.total += d;
      p[s.kind] += d;
    }
  }
  const labels = new Map(results.map((p) => [p.id, new Set()]));
  for (const e of evidence) {
    const set = labels.get(e.project);
    if (set && set.size < 80) set.add(e.label);
  }
  for (const p of results) p.evidence = [...labels.get(p.id)];
  return {
    projects: results,
    segments,
    tracked: duration(tracked),
    assigned: results
      .filter((p) => p.kind !== "non-project")
      .reduce((n, p) => n + p.total, 0),
    nonProject: results
      .filter((p) => p.kind === "non-project")
      .reduce((n, p) => n + p.total, 0),
    evidence,
    conflict,
    unassigned,
  };
}

// Editor sources are optional: a missing or failing watcher never blocks window tracking.
export async function loadEditors(api, buckets, host, start, end) {
  const sources = Object.entries(buckets).filter(
    ([id, meta]) =>
      /^(aw-watcher-vscode|aw-watcher-obsidian)_/.test(id) &&
      (meta.hostname ? meta.hostname === host : id.endsWith("_" + host)),
  );
  return Promise.all(
    sources.map(async ([id]) => {
      const app = id.startsWith("aw-watcher-obsidian_")
        ? "Obsidian.exe"
        : "Code.exe";
      try {
        const raw = await api("query/", {
          timeperiods: [start + "/" + end],
          query: [
            `events = flood(query_bucket(${JSON.stringify(id)}));`,
            "RETURN = events;",
          ],
        });
        return { id, app, events: Array.isArray(raw[0]) ? raw[0] : [] };
      } catch {
        return { id, app, events: [], unavailable: true };
      }
    }),
  );
}
export function editorValue(event, type) {
  const data = event.data || {};
  const value =
    type === "editor-project" ? data.projectPath || data.project : data.file;
  if (!value || /^unknown(?: |$)/i.test(value)) return "";
  return String(value).replaceAll("\\", "/");
}

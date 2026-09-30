export function projectRules(project) {
  return (
    project.rules ?? [
      ...(project.keywords || []).map((pattern, i) => ({
        id: "title-" + i,
        type: "title",
        mode: "text",
        pattern,
        ignoreCase: true,
        from: "",
        through: "",
      })),
      ...(project.urls || []).map((pattern, i) => ({
        id: "url-" + i,
        type: "url",
        mode: "text",
        pattern,
        ignoreCase: true,
        from: "",
        through: "",
      })),
    ]
  );
}
export function normalizeRule(input) {
  const r = {
    id: input.id || crypto.randomUUID(),
    type: input.type || "title",
    mode: input.mode || "text",
    pattern: String(input.pattern || "").trim(),
    ignoreCase: input.ignoreCase !== false,
    from: input.from || "",
    through: input.through || "",
    appFilter: input.type === "url" ? "" : String(input.appFilter || "").trim(),
  };
  if (
    !["title", "url", "editor-project", "editor-file"].includes(r.type) ||
    !["text", "regex"].includes(r.mode)
  )
    throw Error("Choose a supported rule type and matching mode.");
  if (r.type.startsWith("editor-") && r.mode === "text")
    r.pattern = r.pattern.replaceAll("\\", "/");
  if (!r.pattern) throw Error("Enter a title or URL pattern.");
  for (const d of [r.from, r.through])
    if (
      d &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(d) ||
        new Date(d + "T12:00:00").toString() === "Invalid Date" ||
        localDate(new Date(d + "T12:00:00")) !== d)
    )
      throw Error("Enter valid rule dates.");
  if (r.from && r.through && r.from > r.through)
    throw Error("The rule end date must be on or after its start date.");
  if (r.mode === "regex") {
    try {
      new RegExp(r.pattern, r.ignoreCase ? "i" : "");
    } catch (e) {
      throw Error("Invalid regex: " + e.message);
    }
  } else if (r.type === "url") {
    let u;
    try {
      u = new URL(r.pattern);
    } catch {
      throw Error("Enter a full URL beginning with http:// or https://.");
    }
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      throw Error("Use an http or https URL without credentials.");
    u.hash = "";
    r.pattern = u.href;
  }
  return r;
}
export function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function ruleBounds(rule) {
  const start = rule.from ? +new Date(rule.from + "T00:00:00") : -Infinity;
  let end = Infinity;
  if (rule.through) {
    const d = new Date(rule.through + "T00:00:00");
    d.setDate(d.getDate() + 1);
    end = +d;
  }
  return [start, end];
}
// A project's common dates (rulesFrom / rulesThrough) narrow each rule.
export function boundedRule(rule, project) {
  const from =
      [rule.from, project.rulesFrom].filter(Boolean).sort().at(-1) || "",
    through =
      [rule.through, project.rulesThrough].filter(Boolean).sort()[0] || "";
  return from === (rule.from || "") && through === (rule.through || "")
    ? rule
    : { ...rule, from, through };
}
// When a project can receive time at all: its date-bounded rules plus its
// manual assignments. start = -Infinity / end = Infinity when unbounded;
// start = Infinity when nothing can match.
export function projectSpan(project, manualAssignments = []) {
  let start = Infinity,
    end = -Infinity;
  for (const rule of projectRules(project)) {
    const [s, e] = ruleBounds(boundedRule(rule, project));
    if (e <= s) continue;
    start = Math.min(start, s);
    end = Math.max(end, e);
  }
  for (const a of manualAssignments)
    if (a.projectId === project.id) {
      start = Math.min(start, Date.parse(a.start));
      end = Math.max(end, Date.parse(a.end));
    }
  return { start, end };
}
// When a rule's own dates allow the given time but the project's common dates
// (rulesFrom / rulesThrough) exclude all of it: the days involved and the
// widened project dates that would include them. Otherwise null.
export function projectDatesBlock(rule, project, ranges) {
  const own = clipRule(ranges, rule);
  if (!own.length || clipRule(own, boundedRule(rule, project)).length)
    return null;
  const first = localDate(new Date(own[0][0])),
    last = localDate(new Date(own.at(-1)[1] - 1));
  return {
    first,
    last,
    rulesFrom:
      project.rulesFrom && project.rulesFrom > first
        ? first
        : project.rulesFrom || "",
    rulesThrough:
      project.rulesThrough && project.rulesThrough < last
        ? last
        : project.rulesThrough || "",
  };
}
// Start of recorded history on a device: the window bucket's creation, or
// earlier when history was imported (scripts/import-manictime.mjs).
export function historyStart(buckets, settings, host) {
  const start = Math.min(
    ...[
      buckets?.["aw-watcher-window_" + host]?.created,
      settings?.project_tracker_history_start?.[host],
    ]
      .map((t) => Date.parse(t))
      .filter(Number.isFinite),
  );
  return Number.isFinite(start) ? start : null;
}
// Recorded history narrowed to when the project can receive time (its common
// and per-rule dates, manual assignments): [start, end] timestamps.
export function projectPeriod(project, manualAssignments, start, end) {
  if (!project) return [start, end];
  const span = projectSpan(project, manualAssignments || []);
  if (!(span.start < span.end)) return [start, end];
  const from = Math.min(end, Math.max(start, span.start));
  return [from, Math.max(from, Math.min(end, span.end - 1))];
}
export function clipRule(ranges, rule) {
  const [start, end] = ruleBounds(rule);
  return ranges
    .map(([s, e]) => [Math.max(s, start), Math.min(e, end)])
    .filter(([s, e]) => e > s);
}
// Links as people read them (Cyrillic instead of %D0%B5…). Display only:
// stored rules keep the canonical encoded form; both match the same pages.
export function readableUrl(url) {
  try {
    return decodeURI(url);
  } catch {
    return String(url ?? "");
  }
}
// "Telegram", "telegram.exe" and a full path all name the same application.
const applicationKeys = new Map();
export function applicationKey(value) {
  const text = String(value || "");
  let key = applicationKeys.get(text);
  if (key === undefined) {
    if (applicationKeys.size > 10000) applicationKeys.clear();
    key = text
      .trim()
      .split(/[\\/]/)
      .pop()
      .replace(/[.]exe$/i, "")
      .toLocaleLowerCase();
    applicationKeys.set(text, key);
  }
  return key;
}
export function applicationMatches(filter, app) {
  if (!String(filter || "").trim()) return true;
  return applicationKey(filter) === applicationKey(app);
}
const regexCache = new Map();
function compiled(pattern, flags) {
  const key = flags + "/" + pattern;
  if (!regexCache.has(key)) {
    if (regexCache.size >= 500) regexCache.clear();
    let re = null;
    try {
      re = new RegExp(pattern, flags);
    } catch {}
    regexCache.set(key, re);
  }
  return regexCache.get(key);
}
export function ruleMatches(rule, value, matchTitle, matchUrl, app = "") {
  if (rule.type !== "url" && !applicationMatches(rule.appFilter, app))
    return false;
  if (rule.mode === "regex") {
    const re = compiled(rule.pattern, rule.ignoreCase === false ? "" : "i");
    return re ? re.test(String(value || "")) : false;
  }
  if (rule.type === "url") return matchUrl(value, rule.pattern);
  return rule.ignoreCase === false
    ? String(value || "").includes(rule.pattern)
    : matchTitle(value, rule.pattern);
}
export function normalizeAssignment(input, projects, existing = []) {
  const item = {
    id: input.id || crypto.randomUUID(),
    projectId: input.projectId,
    host: input.host,
    start: new Date(input.start).toISOString(),
    end: new Date(input.end).toISOString(),
    note: String(input.note || "").trim(),
  };
  if (!projects.some((p) => p.id === item.projectId))
    throw Error("Choose an existing project.");
  if (!item.host) throw Error("Choose a device for the assignment.");
  if (Date.parse(item.end) <= Date.parse(item.start))
    throw Error("The interval must end after it starts.");
  if (
    existing.some(
      (a) =>
        a.id !== item.id &&
        a.host === item.host &&
        Date.parse(a.start) < Date.parse(item.end) &&
        Date.parse(a.end) > Date.parse(item.start),
    )
  )
    throw Error(
      "This interval overlaps another manual assignment. Remove the earlier assignment or choose a different interval.",
    );
  return item;
}
export function stable(value) {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stable(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}

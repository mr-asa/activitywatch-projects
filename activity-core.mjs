import { analyze, merge, clipSorted, duration } from "./projects-core.mjs";
import { normalizeRule } from "./rule-engine.mjs";
export function normalizeActivityType(raw, others = []) {
  const name = String(raw.name || "").trim();
  if (!name || name.length > 80)
    throw Error("Give the activity type a name (up to 80 characters).");
  if (
    !raw.id ||
    typeof raw.id !== "string" ||
    ["conflict", "unassigned"].includes(raw.id)
  )
    throw Error("Invalid activity type ID.");
  if (
    others.some(
      (t) => t.id !== raw.id && t.name.toLowerCase() === name.toLowerCase(),
    )
  )
    throw Error("Activity type name already exists.");
  if (!/^#[0-9a-f]{6}$/i.test(raw.color || ""))
    throw Error("Choose an activity color.");
  const list = (key) => {
    if (raw[key] !== undefined && !Array.isArray(raw[key]))
      throw Error("Activity matchers must be lists.");
    return [
      ...new Set((raw[key] || []).map((v) => String(v).trim()).filter(Boolean)),
    ];
  };
  const type = {
    id: raw.id,
    name,
    color: raw.color,
    applications: list("applications"),
    titles: list("titles"),
    urls: list("urls"),
    combinations: combinations(raw.combinations),
    mode: raw.mode || "text",
  };
  if (!["text", "regex"].includes(type.mode))
    throw Error("Choose text or regex for titles.");
  if (
    !type.applications.length &&
    !type.titles.length &&
    !type.urls.length &&
    !type.combinations.length
  )
    throw Error("Add at least an application, title, or website.");
  activityRules(type);
  return type;
}
// Combinations are standalone alternatives: an app with an optional title
// fragment, or a title in any app. They never change the main lists.
function combinations(raw = []) {
  if (!Array.isArray(raw)) throw Error("Activity matchers must be lists.");
  const seen = new Set();
  return raw
    .map((c) => ({
      app: String(c?.app || "").trim(),
      title: String(c?.title || "").trim(),
    }))
    .filter((c) => {
      const key = JSON.stringify([c.app.toLowerCase(), c.title]);
      if ((!c.app && !c.title) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
export function parseCombinations(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf("|");
      if (at < 0)
        throw Error(`Write combinations as "App | title fragment": ${line}`);
      return {
        app: line.slice(0, at).trim(),
        title: line.slice(at + 1).trim(),
      };
    });
}
export const formatCombinations = (list = []) =>
  list.map((c) => `${c.app} | ${c.title}`).join("\n");
export function activityRules(type) {
  const rules = [];
  const apps = type.applications.length ? type.applications : [""];
  for (const app of apps) {
    const titles = type.titles.length ? type.titles : app ? [".*"] : [];
    for (const pattern of titles)
      rules.push(
        normalizeRule({
          id: `title-${rules.length}`,
          type: "title",
          mode: type.titles.length ? type.mode : "regex",
          pattern,
          appFilter: app,
          ignoreCase: true,
        }),
      );
  }
  for (const { app, title } of type.combinations || [])
    rules.push(
      normalizeRule({
        id: `title-${rules.length}`,
        type: "title",
        mode: title ? type.mode : "regex",
        pattern: title || ".*",
        appFilter: app,
        ignoreCase: true,
      }),
    );
  for (const pattern of type.urls)
    rules.push(
      normalizeRule({
        id: `url-${rules.length}`,
        type: "url",
        mode: "text",
        pattern,
      }),
    );
  return rules;
}
// Kinds: "url", "application", "title" (any app), "app-title" (title in
// the given app). When the main app × title lists would change meaning, the
// addition becomes a standalone combination instead.
export function addActivityMatcher(type, kind, value, app = "") {
  value = String(value || "").trim();
  app = String(app || "").trim();
  if (!value) throw Error("Enter a value to match.");
  if (kind === "url") return { ...type, urls: [...type.urls, value] };
  const combos = type.combinations || [];
  const escaped =
    type.mode === "regex"
      ? value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      : value;
  if (kind === "application")
    return type.titles.length
      ? { ...type, combinations: [...combos, { app: value, title: "" }] }
      : { ...type, applications: [...type.applications, value] };
  if (kind === "title")
    return type.applications.length
      ? { ...type, combinations: [...combos, { app: "", title: escaped }] }
      : { ...type, titles: [...type.titles, escaped] };
  if (kind === "app-title") {
    if (!app) throw Error("This activity has no application to combine with.");
    return { ...type, combinations: [...combos, { app, title: escaped }] };
  }
  throw Error("Choose what to match.");
}
// Types are labels, not a partition: an activity may carry several. Time
// matched by more than one type counts fully in each of them (there is no
// "needs review" for types); only time matched by none is "unassigned".
export function analyzeActivityTypes(data, types, start, end) {
  const result = analyze(
    data,
    types.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      rules: activityRules(t),
    })),
    start,
    end,
  );
  const byId = new Map(result.projects.map((t) => [t.id, t]));
  const segments = [],
    last = new Map();
  for (const s of result.segments) {
    const ids = s.project === "conflict" ? s.ids : [s.project];
    for (const id of ids) {
      const prev = last.get(id);
      if (prev && prev.end === s.start && prev.kind === s.kind) {
        prev.end = s.end;
        continue;
      }
      const piece = { ...s, project: id, ids: [id] };
      last.set(id, piece);
      segments.push(piece);
    }
  }
  for (const t of result.projects) t.total = t.browser = t.desktop = 0;
  for (const s of segments) {
    const t = byId.get(s.project);
    if (!t) continue;
    const seconds = (s.end - s.start) / 1000;
    t.total += seconds;
    t[s.kind] += seconds;
  }
  const typed = result.projects.reduce((n, t) => n + t.total, 0);
  return {
    ...result,
    segments,
    conflict: 0,
    assigned: typed,
    nonProject: 0,
  };
}
// What a matcher would catch in [start, end): its own active time, the time
// it adds to `type` (null for a new type), and the matching titles or links.
export function matcherPreview(data, type, kind, value, app, start, end) {
  const empty = {
    id: "preview",
    name: "Preview",
    color: "#000000",
    applications: [],
    titles: [],
    urls: [],
    combinations: [],
    mode: type?.mode || "text",
  };
  const alone = analyzeActivityTypes(
    data,
    [addActivityMatcher(empty, kind, value, app)],
    start,
    end,
  );
  const byLabel = new Map();
  for (const e of alone.evidence) {
    const key = JSON.stringify([e.label, e.app || ""]);
    if (!byLabel.has(key)) byLabel.set(key, []);
    byLabel.get(key).push([e.s, e.e]);
  }
  const matches = [...byLabel]
    .map(([key, ranges]) => {
      const [label, matchApp] = JSON.parse(key);
      return { label, app: matchApp, seconds: duration(ranges) };
    })
    .sort((a, b) => b.seconds - a.seconds);
  const total = (types) =>
    analyzeActivityTypes(data, types, start, end).projects[0].total;
  return {
    total: alone.projects[0].total,
    added: type
      ? total([addActivityMatcher(type, kind, value, app)]) - total([type])
      : null,
    matches,
  };
}
export function scopedActivityTypes(projectResult, typeResult, scope = null) {
  const ranges = merge(
    projectResult.segments
      .filter((s) => scope === null || s.project === scope)
      .map((s) => [s.start, s.end]),
  );
  const totals = new Map(typeResult.projects.map((t) => [t.id, 0]));
  let untyped = 0;
  for (const s of typeResult.segments) {
    const seconds = clipSorted(ranges, s.start, s.end).reduce(
      (n, [a, b]) => n + (b - a) / 1000,
      0,
    );
    if (s.project === "unassigned") untyped += seconds;
    else totals.set(s.project, totals.get(s.project) + seconds);
  }
  return {
    total: duration(ranges),
    types: typeResult.projects.map((t) => ({ ...t, total: totals.get(t.id) })),
    untyped,
  };
}
export function activitySegments(
  projectResult,
  typeResult,
  typeId,
  scope = null,
) {
  const ranges = merge(
    projectResult.segments
      .filter((s) => scope === null || s.project === scope)
      .map((s) => [s.start, s.end]),
  );
  return typeResult.segments
    .filter((s) => s.project === typeId)
    .flatMap((s) =>
      clipSorted(ranges, s.start, s.end).map(([start, end]) => ({
        start,
        end,
        project: typeId,
      })),
    );
}

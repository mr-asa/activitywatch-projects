import { analyze, merge, clipSorted, duration } from "./projects-core.mjs";
import { normalizeRule } from "./rule-engine.mjs";
import { addRule } from "./rule-groups.mjs";
// An activity type is { id, name, color, rules[] }: the same rules as a
// project (title, application, URL, editor path; text or regex; dates).
// Types saved before that had applications / titles / urls / combinations /
// mode lists; they are converted on load (see legacyRules).
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
  if (raw.rules !== undefined && !Array.isArray(raw.rules))
    throw Error("Activity type rules must be a list.");
  const rules = (raw.rules ?? legacyRules(raw)).map((r) => normalizeRule(r));
  if (!rules.length)
    throw Error("Add at least one rule: an application, title or website.");
  if (new Set(rules.map((r) => r.id)).size !== rules.length)
    throw Error("Duplicate activity type rule ID.");
  return { id: raw.id, name, color: raw.color, rules };
}
// Old lists as rules: applications × titles (both must match), standalone
// URLs, and standalone { app, title } combinations. Ids are derived from the
// position so the same old type always converts to the same rules.
export function legacyRules(raw) {
  const list = (key) => {
    if (raw[key] !== undefined && !Array.isArray(raw[key]))
      throw Error("Activity matchers must be lists.");
    return [
      ...new Set((raw[key] || []).map((v) => String(v).trim()).filter(Boolean)),
    ];
  };
  const applications = list("applications"),
    titles = list("titles"),
    urls = list("urls");
  const mode = raw.mode || "text";
  if (!["text", "regex"].includes(mode))
    throw Error("Choose text or regex for titles.");
  if (raw.combinations !== undefined && !Array.isArray(raw.combinations))
    throw Error("Activity matchers must be lists.");
  const rules = [];
  const push = (rule) =>
    rules.push(
      normalizeRule({
        id: `m${rules.length}`,
        ignoreCase: true,
        ...rule,
      }),
    );
  if (titles.length)
    for (const app of applications.length ? applications : [""])
      for (const pattern of titles)
        push({ type: "title", mode, pattern, appFilter: app });
  else
    for (const app of applications) push({ type: "application", pattern: app });
  for (const pattern of urls) push({ type: "url", mode: "text", pattern });
  const seen = new Set();
  for (const c of raw.combinations || []) {
    const app = String(c?.app || "").trim(),
      title = String(c?.title || "").trim();
    const key = JSON.stringify([app.toLowerCase(), title]);
    if ((!app && !title) || seen.has(key)) continue;
    seen.add(key);
    if (title) push({ type: "title", mode, pattern: title, appFilter: app });
    else push({ type: "application", pattern: app });
  }
  return rules;
}
// The rules the engine runs for a type, whichever shape it was saved in.
export const typeRules = (type) => type.rules ?? legacyRules(type);
// A type in the current shape, without the name / duplicate checks.
export function upgradeActivityType(type) {
  return type.rules
    ? type
    : {
        id: type.id,
        name: type.name,
        color: type.color,
        rules: legacyRules(type),
      };
}
// The config with every activity type in the current shape (the same object
// when nothing needs converting, so cached results stay valid).
export function upgradeConfigTypes(config) {
  const types = config?.activityTypes;
  if (!types?.some((t) => !t.rules)) return config;
  return { ...config, activityTypes: types.map(upgradeActivityType) };
}
// A rule stored as a new matcher of the type: joins the group with the same
// settings, and is skipped when the type already has that pattern.
export function addTypeRule(type, rule) {
  const added = addRule(typeRules(type), rule);
  return {
    type: { ...upgradeActivityType(type), rules: added.rules },
    ...added,
  };
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
      rules: typeRules(t),
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
// What a rule would catch in [start, end): its own active time, the time it
// adds to `type` (null for a new type), and the matching titles or links.
export function matcherPreview(data, type, rule, start, end) {
  const alone = analyzeActivityTypes(
    data,
    [{ id: "preview", name: "Preview", color: "#000000", rules: [rule] }],
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
    added: type ? total([addTypeRule(type, rule).type]) - total([type]) : null,
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

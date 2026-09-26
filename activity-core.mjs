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
    mode: raw.mode || "text",
  };
  if (!["text", "regex"].includes(type.mode))
    throw Error("Choose text or regex for titles.");
  if (!type.applications.length && !type.titles.length && !type.urls.length)
    throw Error("Add at least an application, title, or website.");
  activityRules(type);
  return type;
}
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
export function analyzeActivityTypes(data, types, start, end) {
  return analyze(
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
}
export function scopedActivityTypes(projectResult, typeResult, scope = null) {
  const ranges = merge(
    projectResult.segments
      .filter((s) => scope === null || s.project === scope)
      .map((s) => [s.start, s.end]),
  );
  const totals = new Map(typeResult.projects.map((t) => [t.id, 0]));
  let untyped = 0,
    conflict = 0;
  for (const s of typeResult.segments) {
    const seconds = clipSorted(ranges, s.start, s.end).reduce(
      (n, [a, b]) => n + (b - a) / 1000,
      0,
    );
    if (s.project === "unassigned") untyped += seconds;
    else if (s.project === "conflict") conflict += seconds;
    else totals.set(s.project, totals.get(s.project) + seconds);
  }
  return {
    total: duration(ranges),
    types: typeResult.projects.map((t) => ({ ...t, total: totals.get(t.id) })),
    untyped,
    conflict,
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

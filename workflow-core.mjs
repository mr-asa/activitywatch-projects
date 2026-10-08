import { normalizeActivityType } from "./activity-core.mjs";
import {
  normalizeProject,
  merge,
  clipSorted,
  duration,
} from "./projects-core.mjs";
import { normalizeAssignment } from "./rule-engine.mjs";

export function validateConfig(input) {
  if (
    !input ||
    input.version !== 1 ||
    !Array.isArray(input.projects) ||
    !Array.isArray(input.manualAssignments ?? [])
  )
    throw Error("Choose a version 1 project settings backup.");
  const projects = [];
  for (const raw of input.projects) {
    if (
      !raw ||
      typeof raw.id !== "string" ||
      !raw.id ||
      ["conflict", "unassigned"].includes(raw.id) ||
      projects.some((p) => p.id === raw.id)
    )
      throw Error(
        "Backup contains missing, duplicate or reserved project IDs.",
      );
    if (raw.rules !== undefined && !Array.isArray(raw.rules))
      throw Error("Project rules must be a list.");
    projects.push(normalizeProject(raw, projects));
  }
  const manualAssignments = [];
  for (const raw of input.manualAssignments || []) {
    if (
      !raw ||
      typeof raw.id !== "string" ||
      !raw.id ||
      manualAssignments.some((a) => a.id === raw.id)
    )
      throw Error("Backup contains missing or duplicate assignment IDs.");
    manualAssignments.push(
      normalizeAssignment(raw, projects, manualAssignments),
    );
  }
  if (!Array.isArray(input.activityTypes ?? []))
    throw Error("Activity types must be a list.");
  const activityTypes = [];
  for (const raw of input.activityTypes || []) {
    if (activityTypes.some((t) => t.id === raw.id))
      throw Error("Duplicate activity type ID.");
    activityTypes.push(normalizeActivityType(raw, activityTypes));
  }
  return { version: 1, projects, manualAssignments, activityTypes };
}
// Report days: "day", "week" (from Monday), "month", or "range" from
// `date` through `through` (inclusive dates).
export function reportBounds(
  date,
  period = "day",
  startOfDay = "04:00",
  through = date,
) {
  const start = new Date(date + "T00:00:00");
  const [hours, minutes] = startOfDay.split(":").map(Number);
  if (period === "week")
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (period === "month") start.setDate(1);
  start.setHours(hours, minutes, 0, 0);
  const end = new Date(start);
  if (period === "month") end.setMonth(end.getMonth() + 1);
  else if (period === "range") {
    const last = new Date((through || date) + "T00:00:00");
    last.setHours(hours, minutes, 0, 0);
    end.setTime(+last);
    end.setDate(end.getDate() + 1);
  } else end.setDate(end.getDate() + (period === "week" ? 7 : 1));
  return [+start, +end];
}
export function revisionHistory(
  history,
  config,
  now = new Date().toISOString(),
) {
  const entries = [
    {
      savedAt: now,
      config: {
        version: 1,
        projects: config.projects,
        activityTypes: config.activityTypes || [],
        manualAssignments: config.manualAssignments || [],
      },
    },
    ...(Array.isArray(history) ? history : []),
  ];
  // Up to 20 revisions within about 3 MB (always the newest one): every save
  // rewrites the history, and many manual assignments make each copy large.
  const kept = [];
  let size = 0;
  for (const entry of entries.slice(0, 20)) {
    size += JSON.stringify(entry).length;
    if (kept.length && size > HISTORY_BYTES) break;
    kept.push(entry);
  }
  return kept;
}
const HISTORY_BYTES = 3_000_000;

// "Needs review" time claimed by exactly these categories: each activity
// (title or link, application) with its time and, per category, the rules or
// manual assignments that claimed it.
export function conflictActivities(result, ids) {
  const key = [...ids].sort().join("|");
  const conflict = merge(
    result.segments
      .filter((s) => s.project === "conflict" && s.ids.join("|") === key)
      .map((s) => [s.start, s.end]),
  );
  const activities = new Map();
  const entryKey = (e) => JSON.stringify([e.label, e.app || ""]);
  for (const e of result.evidence) {
    if (!ids.includes(e.project)) continue;
    const pieces = clipSorted(conflict, e.s, e.e);
    if (!pieces.length) continue;
    if (!activities.has(entryKey(e)))
      activities.set(entryKey(e), {
        label: e.label,
        app: e.app || "",
        ranges: [],
        matches: new Map(),
      });
    activities.get(entryKey(e)).ranges.push(...pieces);
  }
  // A project can claim the same moment through other evidence (a page URL
  // while another project's title rule matches the window): list every claim
  // overlapping the activity, marking those seen as something else.
  for (const [k, activity] of activities) {
    activity.ranges = merge(activity.ranges);
    for (const e of result.evidence) {
      if (!ids.includes(e.project)) continue;
      if (!clipSorted(activity.ranges, e.s, e.e).length) continue;
      const reasons = activity.matches.get(e.project) || [];
      const id = e.manual ? "manual:" + e.assignment.id : "rule:" + e.rule.id;
      if (!reasons.some((r) => r.id === id))
        reasons.push({
          id,
          ...(e.manual ? { assignment: e.assignment } : { rule: e.rule }),
          ...(entryKey(e) === k
            ? {}
            : { via: { label: e.label, app: e.app || "" } }),
        });
      activity.matches.set(e.project, reasons);
    }
  }
  return [...activities.values()]
    .map((a) => ({
      ...a,
      ranges: merge(a.ranges),
      seconds: duration(a.ranges),
    }))
    .sort((a, b) => b.seconds - a.seconds);
}

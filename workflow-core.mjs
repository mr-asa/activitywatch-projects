import { normalizeProject, analyze } from "./projects-core.mjs";
import { normalizeAssignment, localDate } from "./rule-engine.mjs";

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
  return { version: 1, projects, manualAssignments };
}
export function reportBounds(date, period = "day", startOfDay = "04:00") {
  const start = new Date(date + "T00:00:00");
  const [hours, minutes] = startOfDay.split(":").map(Number);
  if (period === "week")
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (period === "month") start.setDate(1);
  start.setHours(hours, minutes, 0, 0);
  const end = new Date(start);
  if (period === "month") end.setMonth(end.getMonth() + 1);
  else end.setDate(end.getDate() + (period === "week" ? 7 : 1));
  return [+start, +end];
}
export function compareConfigs(data, before, after, start, end, host) {
  const run = (config) =>
    analyze(data, config.projects, start, end, {
      host,
      manualAssignments: config.manualAssignments || [],
    });
  const previous = run(before),
    next = run(after);
  const changes = [
    ...new Set([...previous.projects, ...next.projects].map((p) => p.id)),
  ]
    .map((id) => {
      const a = previous.projects.find((p) => p.id === id),
        b = next.projects.find((p) => p.id === id);
      return {
        id,
        name: b?.name || a.name,
        before: a?.total || 0,
        after: b?.total || 0,
        delta: (b?.total || 0) - (a?.total || 0),
      };
    })
    .filter((p) => p.delta !== 0);
  return { previous, next, changes };
}
export function dailyReport(result, start, end, startOfDay = "04:00") {
  const [hours, minutes] = startOfDay.split(":").map(Number);
  const day = new Date(start);
  day.setHours(hours, minutes, 0, 0);
  if (+day > start) day.setDate(day.getDate() - 1);
  const rows = [];
  for (let n = 0; +day < end && n < 3660; n++) {
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    const totals = new Map();
    for (const s of result.segments) {
      const seconds =
        Math.max(
          0,
          Math.min(s.end, +next, end) - Math.max(s.start, +day, start),
        ) / 1000;
      if (seconds)
        totals.set(s.project, (totals.get(s.project) || 0) + seconds);
    }
    for (const [id, seconds] of totals) {
      const project = result.projects.find((p) => p.id === id);
      rows.push({
        date: localDate(day),
        id,
        name:
          project?.name ||
          (id === "conflict" ? "Needs review" : "Not assigned"),
        kind: project?.kind || (project ? "project" : id),
        seconds,
      });
    }
    day.setTime(+next);
  }
  return rows;
}
const cell = (value) => {
  let s = String(value);
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
export function exportCSV(rows) {
  return (
    "\uFEFF" +
    [
      ["Date", "Category", "Type", "Seconds", "Hours"],
      ...rows.map((r) => [
        r.date,
        r.name,
        r.kind,
        r.seconds.toFixed(3),
        (r.seconds / 3600).toFixed(4),
      ]),
    ]
      .map((r) => r.map(cell).join(","))
      .join("\r\n")
  );
}
export function exportMarkdown(rows) {
  const clean = (s) => String(s).replace(/\r?\n/g, " ").replaceAll("|", "\\|");
  return (
    "# Activity report\n\n| Date | Category | Type | Hours |\n| --- | --- | --- | ---: |\n" +
    rows
      .map(
        (r) =>
          `| ${r.date} | ${clean(r.name)} | ${r.kind} | ${(r.seconds / 3600).toFixed(2)} |`,
      )
      .join("\n") +
    "\n"
  );
}
export function revisionHistory(
  history,
  config,
  now = new Date().toISOString(),
) {
  return [
    {
      savedAt: now,
      config: {
        version: 1,
        projects: config.projects,
        manualAssignments: config.manualAssignments || [],
      },
    },
    ...(Array.isArray(history) ? history : []),
  ].slice(0, 20);
}

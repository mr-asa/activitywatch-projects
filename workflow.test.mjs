import assert from "node:assert/strict";
import { analyze, normalizeProject } from "./projects-core.mjs";
import {
  validateConfig,
  reportBounds,
  compareConfigs,
  dailyReport,
  exportCSV,
  exportMarkdown,
  revisionHistory,
} from "./workflow-core.mjs";
const t = +new Date("2026-09-22T03:59:30"),
  e = (app, title) => ({
    timestamp: new Date(t).toISOString(),
    duration: 60,
    data: { app, title },
  });
const data = {
  windows: [e("maya.exe", "Demo")],
  afk: [{ ...e("", ""), data: { status: "not-afk" } }],
  browsers: [],
};
const p = normalizeProject({
  id: "demo",
  name: "Demo",
  color: "#65d6b4",
  keywords: ["Demo"],
});
const cfg = { version: 1, projects: [p], manualAssignments: [] };
let result = analyze(data, [p], t, t + 60000);
assert.equal(result.assigned, 60);
assert.equal(result.evidence[0].rule.pattern, "Demo");
assert.equal(result.evidence[0].app, "maya.exe");
result = analyze(
  data,
  [{ ...p, kind: "non-project", archived: true }],
  t,
  t + 60000,
);
assert.equal(result.assigned, 0);
assert.equal(result.nonProject, 60);
assert.equal(result.tracked, 60);
assert.equal(
  analyze(data, [{ ...p, rulesThrough: "2026-09-21" }], t, t + 60000).assigned,
  0,
);
const manual = {
  id: "m",
  host: "h",
  projectId: p.id,
  start: new Date(t).toISOString(),
  end: new Date(t + 60000).toISOString(),
};
assert.equal(
  analyze(data, [{ ...p, rulesThrough: "2026-09-21" }], t, t + 60000, {
    host: "h",
    manualAssignments: [manual],
  }).assigned,
  60,
);
assert.equal(
  analyze(data, [p, { ...p, id: "other", kind: "non-project" }], t, t + 60000)
    .conflict,
  60,
);
assert.equal(
  compareConfigs(data, { ...cfg, projects: [] }, cfg, t, t + 60000, "h")
    .changes[0].delta,
  60,
);
const rows = dailyReport(result, t, t + 60000);
assert.equal(rows.length, 2);
assert.equal(rows[0].seconds, 30);
assert.equal(rows[1].seconds, 30);
assert(exportCSV([{ ...rows[0], name: "=SUM(1,2)" }]).includes("'=SUM"));
assert(exportMarkdown([{ ...rows[0], name: "a|b" }]).includes("a\\|b"));
assert.equal(new Date(reportBounds("2026-09-23", "week")[0]).getDate(), 21);
assert.equal(new Date(reportBounds("2026-09-23", "month")[1]).getMonth(), 9);
assert.equal(validateConfig(cfg).projects[0].kind, "project");
assert.throws(() => validateConfig({ ...cfg, version: 2 }));
assert.throws(() => validateConfig({ ...cfg, projects: [p, p] }));
assert.throws(() =>
  validateConfig({
    ...cfg,
    manualAssignments: [{ ...manual, projectId: "missing" }],
  }),
);
assert.equal(revisionHistory(Array(20).fill({}), cfg).length, 20);
console.log(
  "PASS: evidence, categories, archive boundaries, manual precedence, previews, report splitting, exports, import validation, revisions",
);

// Workload uses report-day boundaries, fills zero-work days, and excludes other allocations.
const { projectWorkload } = await import("./workload-core.mjs");
const at = (s) => +new Date(s);
const workload = projectWorkload(
  {
    segments: [
      {
        project: "demo",
        start: at("2026-09-20T03:59:30"),
        end: at("2026-09-20T04:00:30"),
      },
      {
        project: "demo",
        start: at("2026-09-22T10:00:00"),
        end: at("2026-09-22T12:00:00"),
      },
      {
        project: "conflict",
        start: at("2026-09-22T12:00:00"),
        end: at("2026-09-22T13:00:00"),
      },
    ],
  },
  "demo",
);
assert.deepEqual(
  workload.days.map((d) => d.seconds),
  [30, 30, 0, 7200],
);
assert.equal(workload.total, 7260);
assert.equal(workload.activeDays, 3);
assert.equal(workload.average, 2420);
assert.equal(workload.busiest.date, "2026-09-22");
assert.equal(projectWorkload({ segments: [] }, "demo").days.length, 0);

const { workloadLayers } = await import("./workload-core.mjs");
const base = +new Date("2026-09-22T04:00:00");
const layeredResult = {
  projects: [
    { id: "p", kind: "project" },
    { id: "q", kind: "project" },
    { id: "rest", kind: "non-project" },
  ],
  segments: [
    { project: "p", start: base, end: base + 6 * 3600000 },
    { project: "q", start: base + 6 * 3600000, end: base + 9 * 3600000 },
    { project: "rest", start: base + 9 * 3600000, end: base + 10 * 3600000 },
    {
      project: "unassigned",
      start: base + 10 * 3600000,
      end: base + 11 * 3600000,
    },
  ],
};
const layers = workloadLayers(
  layeredResult,
  projectWorkload(layeredResult, "p"),
  "04:00",
  8,
);
assert.equal(layers.overtime, 3600);
assert.equal(layers.days[0].work, 32400);
assert.equal(layers.nonProjectPercent, 100 / 11);
assert.equal(layers.coverage, 1000 / 11);
assert.equal(
  workloadLayers(
    layeredResult,
    projectWorkload(layeredResult, "p"),
    "04:00",
    null,
  ).overtime,
  null,
);

const {
  normalizeActivityType,
  analyzeActivityTypes,
  scopedActivityTypes,
  activitySegments,
} = await import("./activity-core.mjs");
const { stackedWorkload } = await import("./workload-core.mjs");
const activity = normalizeActivityType({
  id: "creation",
  name: "Creation",
  color: "#abcdef",
  applications: ["maya"],
  titles: ["Demo"],
});
const projectResult = analyze(data, [p], t, t + 60000);
const typeResult = analyzeActivityTypes(data, [activity], t, t + 60000);
assert.equal(
  scopedActivityTypes(projectResult, typeResult, "demo").types[0].total,
  60,
);
assert.equal(projectResult.assigned, 60);
assert.equal(
  activitySegments(projectResult, typeResult, "creation", "demo").reduce(
    (n, s) => n + (s.end - s.start) / 1000,
    0,
  ),
  60,
);
const typeConflict = analyzeActivityTypes(
  data,
  [activity, { ...activity, id: "duplicate" }],
  t,
  t + 60000,
);
assert.equal(scopedActivityTypes(projectResult, typeConflict).conflict, 60);
assert.equal(projectResult.conflict, 0);
assert.equal(
  scopedActivityTypes(projectResult, typeResult, "unassigned").total,
  0,
);
assert.equal(
  analyzeActivityTypes(
    data,
    [{ ...activity, applications: ["telegram"] }],
    t,
    t + 60000,
  ).assigned,
  0,
);
assert.throws(() =>
  normalizeActivityType({ ...activity, mode: "regex", titles: ["["] }),
);
assert.throws(() =>
  normalizeActivityType({ ...activity, applications: [], titles: [] }),
);
assert.equal(
  validateConfig({ ...cfg, activityTypes: [activity] }).activityTypes[0].name,
  "Creation",
);
assert.throws(() =>
  validateConfig({ ...cfg, activityTypes: [activity, activity] }),
);
const allSummary = projectWorkload(layeredResult, null);
const stack = stackedWorkload(layeredResult, allSummary);
assert.equal(
  allSummary.total,
  layeredResult.segments
    .filter((s) => ["p", "q"].includes(s.project))
    .reduce((n, s) => n + (s.end - s.start) / 1000, 0),
);
for (let i = 0; i < allSummary.days.length; i++)
  assert.equal(stack.at(-1).days[i].top, allSummary.days[i].seconds);

import assert from "node:assert/strict";
import { analyze, normalizeProject } from "./projects-core.mjs";
import {
  validateConfig,
  reportBounds,
  compareConfigs,
  revisionHistory,
} from "./workflow-core.mjs";
import {
  buildExport,
  exportCategories,
  serializeExport,
} from "./export-core.mjs";
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
// A common start date limits all rules; a rule's own narrower date still wins.
assert.equal(
  analyze(data, [{ ...p, rulesFrom: "2026-09-23" }], t, t + 60000).assigned,
  0,
);
assert.equal(
  analyze(data, [{ ...p, rulesFrom: "2026-09-22" }], t, t + 60000).assigned,
  60,
);
assert.equal(
  analyze(
    data,
    [
      {
        ...p,
        rulesFrom: "2026-09-01",
        rules: p.rules.map((r) => ({ ...r, from: "2026-09-23" })),
      },
    ],
    t,
    t + 60000,
  ).assigned,
  0,
);
assert.equal(
  normalizeProject({ ...p, rulesFrom: "2026-09-10" }).rulesFrom,
  "2026-09-10",
);
assert.throws(
  () =>
    normalizeProject({
      ...p,
      rulesFrom: "2026-09-10",
      rulesThrough: "2026-09-01",
    }),
  /must end on or after/,
);
{
  const { projectSpan } = await import("./rule-engine.mjs");
  const day = (d) => +new Date(d + "T00:00:00");
  const bounded = {
    ...p,
    rulesFrom: "2026-09-10",
    rulesThrough: "2026-09-20",
  };
  assert.deepEqual(projectSpan(bounded), {
    start: day("2026-09-10"),
    end: day("2026-09-21"),
  });
  // Manual assignments widen the span; a rule without dates leaves it open.
  assert.equal(
    projectSpan(bounded, [
      {
        projectId: p.id,
        start: "2026-08-01T10:00:00Z",
        end: "2026-08-01T11:00:00Z",
      },
    ]).start,
    Date.parse("2026-08-01T10:00:00Z"),
  );
  assert.equal(projectSpan(p).start, -Infinity);
  assert.equal(projectSpan({ ...p, rules: [] }).start, Infinity);
}
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
// The event crosses the 04:00 day boundary: 30 s on each report day.
const table = buildExport(
  {
    projectSegments: result.segments,
    categories: exportCategories({
      projects: [{ id: "demo", name: "=SUM(1,2)" }],
    }),
    start: t,
    end: t + 60000,
  },
  {
    unit: "seconds",
    split: "projects",
    columns: [{ metric: "time", target: "row" }],
  },
);
assert.deepEqual(
  table.rows.map((r) => r.cells),
  [
    ["2026-09-21", "=SUM(1,2)", 30],
    ["2026-09-22", "=SUM(1,2)", 30],
  ],
);
assert(serializeExport(table, "csv").includes("'=SUM"));
assert(
  serializeExport(
    { ...table, rows: [{ cells: ["2026-09-21", "a|b", 30] }] },
    "md",
  ).includes("a\\|b"),
);
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
// Large configurations keep fewer revisions: about 3 MB, newest first.
{
  const big = { config: { blob: "x".repeat(1_000_000) } };
  const kept = revisionHistory(Array(10).fill(big), {
    projects: [{ blob: "y".repeat(1_000_000) }],
  });
  assert.equal(kept.length, 2);
  assert.equal(kept[0].config.projects[0].blob.length, 1_000_000);
  assert.equal(
    revisionHistory([], { projects: [{ blob: "z".repeat(5_000_000) }] }).length,
    1,
  );
}
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
// Work layers first, then non-project and unclassified; the top is all time.
assert.deepEqual(
  stack.map((l) => [l.id, l.extra]),
  [
    ["p", false],
    ["q", false],
    ["rest", true],
    ["unclassified", true],
  ],
);
const allLayers = workloadLayers(layeredResult, allSummary);
for (let i = 0; i < allSummary.days.length; i++) {
  assert.equal(stack[1].days[i].top, allSummary.days[i].seconds);
  assert.equal(stack.at(-1).days[i].top, allLayers.days[i].tracked);
}

// Optional editor watchers: foreground/AFK gating, no title fallback regression.
const { loadEditors, editorValue } = await import("./projects-core.mjs");
const editorProject = {
  ...p,
  rules: [
    {
      id: "editor",
      type: "editor-file",
      mode: "text",
      pattern: "/demo/",
      appFilter: "Code",
      ignoreCase: true,
    },
  ],
};
const editorData = {
  ...data,
  windows: [e("Code.exe", "Unrelated title")],
  editors: [
    {
      app: "Code.exe",
      events: [
        {
          ...e("", ""),
          data: { file: "D:/demo/main.js", project: "/d:/demo" },
        },
      ],
    },
  ],
};
assert.equal(analyze(editorData, [editorProject], t, t + 60000).assigned, 60);
assert.equal(
  analyze(
    { ...editorData, windows: [e("Obsidian.exe", "Other")] },
    [editorProject],
    t,
    t + 60000,
  ).assigned,
  0,
);
assert.equal(
  analyze({ ...editorData, afk: [] }, [editorProject], t, t + 60000).assigned,
  0,
);
assert.equal(
  analyze({ ...editorData, editors: [] }, [editorProject], t, t + 60000)
    .assigned,
  0,
);
assert.equal(analyze(data, [p], t, t + 60000).assigned, 60);
assert.equal(
  editorValue(
    { data: { projectPath: "D:/notes", project: "notes" } },
    "editor-project",
  ),
  "D:/notes",
);
assert.equal(editorValue({ data: { file: "unknown" } }, "editor-file"), "");
const obsProject = {
  ...editorProject,
  rules: [{ ...editorProject.rules[0], appFilter: "Obsidian" }],
};
const obsData = {
  ...editorData,
  windows: [e("Obsidian.exe", "Note")],
  editors: [
    {
      app: "Obsidian.exe",
      events: [
        {
          ...e("", ""),
          data: {
            file: "/demo/note.md",
            eventType: "obsidian.activeFileHeartbeatEvent",
          },
        },
      ],
    },
  ],
};
assert.equal(analyze(obsData, [obsProject], t, t + 60000).assigned, 60);
assert.equal(
  analyze(
    {
      ...obsData,
      editors: [
        {
          ...obsData.editors[0],
          events: [
            {
              ...obsData.editors[0].events[0],
              data: {
                file: "/demo/note.md",
                eventType: "obsidian.createFileEvent",
              },
            },
          ],
        },
      ],
    },
    [obsProject],
    t,
    t + 60000,
  ).assigned,
  0,
);
assert.deepEqual(
  await loadEditors(
    () => {
      throw Error("should not query");
    },
    {},
    "host",
    "start",
    "end",
  ),
  [],
);
const failedEditors = await loadEditors(
  async () => {
    throw Error("offline");
  },
  {
    "aw-watcher-vscode_host": { hostname: "host" },
    "aw-watcher-obsidian_other": { hostname: "other" },
  },
  "host",
  "start",
  "end",
);
assert.equal(failedEditors.length, 1);
assert.equal(failedEditors[0].unavailable, true);
// Chart buckets: days while they fit, then weekly/monthly averages per
// recorded day; unrecorded days are gaps, not zeros.
{
  const { chartBuckets } = await import("./workload-core.mjs");
  const days = [];
  const d = new Date("2026-01-05T12:00:00"); // Monday
  for (let i = 0; i < 70; i++) {
    const weekday = i % 7 < 5;
    days.push({
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      seconds: weekday ? 3600 * (i % 7) : 0,
      tracked: weekday ? 3600 * 8 : 0,
      work: weekday ? 3600 * 6 : 0,
      nonProject: weekday ? 3600 : 0,
      unclassified: weekday ? 3600 : 0,
      trend: null,
      overtime: null,
    });
    d.setDate(d.getDate() + 1);
  }
  const stack = [
    { id: "p", days: days.map((x) => ({ seconds: x.work })) },
    { id: "rest", days: days.map((x) => ({ seconds: x.tracked - x.work })) },
  ];
  assert.equal(chartBuckets(days, stack, 900).unit, "day");
  const weekly = chartBuckets(days, stack, 150);
  assert.equal(weekly.unit, "week");
  assert.equal(weekly.days.length, 10);
  const first = weekly.days[0];
  assert.deepEqual(
    [first.date, first.from, first.to, first.count, first.recorded],
    ["2026-01-05", "2026-01-05", "2026-01-11", 7, 5],
  );
  // Average over the five recorded days: (0+1+2+3+4)/5 h.
  assert.equal(first.seconds, 7200);
  assert.equal(first.tracked, 3600 * 8);
  assert.equal(first.nonProjectPercent, 12.5);
  assert.equal(first.trend, null);
  assert.equal(weekly.stack[1].days[0].bottom, 3600 * 6);
  assert.equal(weekly.stack[1].days[0].top, 3600 * 8);
  const monthly = chartBuckets(days, stack, 40);
  assert.equal(monthly.unit, "month");
  assert.deepEqual(
    monthly.days.map((b) => b.date),
    ["2026-01-01", "2026-02-01", "2026-03-01"],
  );
  // A bucket without recorded days stays a gap.
  const empty = days.map((x) => ({ ...x, tracked: 0 }));
  assert.equal(chartBuckets(empty, [], 150).days[0].tracked, 0);
}
// Manual assignments find overlapping windows via the start-time index,
// including a long window that began well before the assignment.
{
  const base = Date.parse("2026-09-22T08:00:00Z");
  const ev = (offsetMin, minutes, title) => ({
    timestamp: new Date(base + offsetMin * 60000).toISOString(),
    duration: minutes * 60,
    data: { app: "maya.exe", title },
  });
  const longData = {
    windows: [ev(0, 180, "Long"), ev(180, 10, "Short"), ev(190, 10, "Later")],
    afk: [{ ...ev(0, 200, ""), data: { status: "not-afk" } }],
    browsers: [],
  };
  const proj = normalizeProject({
    id: "x",
    name: "X",
    color: "#65d6b4",
    keywords: ["nothing"],
  });
  const assignment = {
    id: "a",
    host: "h",
    projectId: "x",
    start: new Date(base + 120 * 60000).toISOString(),
    end: new Date(base + 185 * 60000).toISOString(),
  };
  const r = analyze(longData, [proj], base, base + 200 * 60000, {
    host: "h",
    manualAssignments: [assignment],
  });
  assert.equal(r.assigned, 65 * 60);
  assert.deepEqual(
    r.evidence.map((e) => e.label),
    ["Long", "Short"],
  );
  const { sliceData } = await import("./workload-core.mjs");
  const cut = sliceData(longData, base + 185 * 60000, base + 195 * 60000);
  assert.deepEqual(
    cut.windows.map((w) => w.data.title),
    ["Short", "Later"],
  );
  assert.equal(cut.afk.length, 1);
}

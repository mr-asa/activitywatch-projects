import assert from "node:assert/strict";
import {
  BOM,
  BUILTIN_PRESETS,
  buildExport,
  columnLabel,
  exportCategories,
  exportPeriods,
  formatDuration,
  normalizeSpec,
  serializeExport,
  sessions,
  specNeedsTypes,
} from "./export-core.mjs";

const at = (date, time) => +new Date(`${date}T${time}`);
const seg = (project, date, from, to) => ({
  project,
  start: at(date, from),
  end: at(date, to),
});
const config = {
  projects: [
    { id: "demo", name: "Demo", kind: "project" },
    { id: "other", name: "Other", kind: "non-project" },
  ],
  activityTypes: [
    { id: "calls", name: "Calls" },
    { id: "chat", name: "Chat" },
  ],
};
const categories = exportCategories(config);
// Demo: 1.5 h on Sep 21, 0.25 h on Sep 23. Other: 1 h on Sep 21.
// All active time: 175 minutes.
const projectSegments = [
  seg("demo", "2026-09-21", "10:00:00", "11:30:00"),
  seg("other", "2026-09-21", "12:00:00", "13:00:00"),
  seg("unassigned", "2026-09-22", "09:00:00", "09:10:00"),
  seg("demo", "2026-09-23", "09:00:00", "09:15:00"),
];
// Calls: 30 min inside Demo, 30 min inside Other. Chat: three visits.
const typeSegments = [
  seg("calls", "2026-09-21", "11:00:00", "11:30:00"),
  seg("calls", "2026-09-21", "12:00:00", "12:30:00"),
  seg("chat", "2026-09-21", "10:00:00", "10:02:00"),
  seg("chat", "2026-09-21", "10:02:30", "10:05:00"),
  seg("chat", "2026-09-21", "10:30:00", "10:40:00"),
];
const input = {
  projectSegments,
  typeSegments,
  categories,
  start: at("2026-09-21", "04:00:00"),
  end: at("2026-09-24", "04:00:00"),
};
const lines = (text) => text.replace(BOM, "").trim().split("\r\n");
const csv = (spec) => lines(serializeExport(buildExport(input, spec)));

// The simplest timesheet: one project, date + decimal hours.
assert.deepEqual(
  csv({
    header: false,
    columns: [{ label: "Hours", metric: "time", target: "p:demo" }],
  }),
  ["2026-09-21,1.50", "2026-09-23,0.25"],
);
// Empty days, comma decimals, semicolon delimiter, Russian dates.
assert.deepEqual(
  csv({
    columns: [{ label: "Hours", metric: "time", target: "p:demo" }],
    emptyPeriods: true,
    decimalSeparator: ",",
    delimiter: ";",
    dateFormat: "dmy",
    decimals: 1,
  }),
  ["Date;Hours", "21.09.2026;1,5", "22.09.2026;0,0", "23.09.2026;0,3"],
);
// Rows split by project, with totals; excluded categories stay out.
assert.deepEqual(
  csv({
    split: "projects",
    totalRow: true,
    unit: "hm",
    columns: [{ label: "Time", metric: "time", target: "row" }],
  }),
  [
    "Date,Category,Time",
    "2026-09-21,Demo,1:30",
    "2026-09-21,Other,1:00",
    "2026-09-23,Demo,0:15",
    "Total,Demo,1:45",
    "Total,Other,1:00",
  ],
);
// Share of calls within a project; work, non-project and all time.
assert.deepEqual(
  csv({
    group: "total",
    decimals: 1,
    columns: [
      {
        label: "Calls in Demo %",
        metric: "share",
        target: "t:calls",
        base: "p:demo",
      },
      {
        label: "Calls in Demo",
        metric: "time",
        target: "t:calls",
        within: "p:demo",
      },
      { label: "Work", metric: "time", target: "work" },
      { label: "Non-project", metric: "time", target: "nonproject" },
      { label: "All", metric: "time", target: "all" },
    ],
  }),
  [
    "Calls in Demo %,Calls in Demo,Work,Non-project,All",
    "28.6,0.5,1.8,1.0,2.9",
  ],
);
// Chat sessions: a 30 s break does not end a session with a 1 min threshold.
assert.deepEqual(
  csv({
    group: "total",
    unit: "minutes",
    decimals: 1,
    columns: [
      { label: "Sessions", metric: "sessions", target: "t:chat" },
      { label: "Longest", metric: "longest", target: "t:chat" },
      { label: "Average", metric: "average", target: "t:chat" },
      { label: "Share", metric: "share", target: "t:chat", base: "all" },
    ],
  }),
  ["Sessions,Longest,Average,Share", "2,10.0,7.3,8.3"],
);
assert.equal(
  sessions(
    [
      [0, 1000],
      [1500, 2000],
    ],
    0,
  ).length,
  2,
);
// First/last activity, active days and per-day average by week.
assert.deepEqual(
  csv({
    group: "week",
    totalRow: true,
    columns: [
      { label: "Start", metric: "first", target: "all" },
      { label: "End", metric: "last", target: "all" },
      { label: "Days", metric: "days", target: "p:demo" },
      { label: "Per day", metric: "perDay", target: "p:demo" },
    ],
  }),
  [
    "Week of,Start,End,Days,Per day",
    "2026-09-21,10:00,09:15,2,0.88",
    "Total,,,2,0.88",
  ],
);
// JSON keeps numbers numeric and deduplicates labels.
assert.deepEqual(
  JSON.parse(
    serializeExport(
      buildExport(input, {
        group: "total",
        format: "json",
        split: "types",
        columns: [
          { label: "Hours", metric: "time", target: "row" },
          { label: "Hours", metric: "share", target: "row", base: "all" },
        ],
      }),
    ),
  ),
  [
    { Category: "Calls", Hours: 1, "Hours (2)": 34.29 },
    { Category: "Chat", Hours: 0.24, "Hours (2)": 8.29 },
  ],
);
// Rounding each duration to 15 minutes: 7 minutes rounds away.
assert.equal(
  buildExport(
    {
      ...input,
      projectSegments: [seg("demo", "2026-09-22", "10:00:00", "10:07:00")],
    },
    { rounding: 15, columns: [{ metric: "time", target: "p:demo" }] },
  ).rows.length,
  0,
);
// Month periods and labels.
assert.deepEqual(
  exportPeriods(
    at("2026-09-28", "04:00:00"),
    at("2026-10-03", "04:00:00"),
    "month",
  ).map((p) => p.key),
  ["2026-09-01", "2026-10-01"],
);
assert.deepEqual(
  csv({
    group: "month",
    dateFormat: "dmy",
    header: false,
    columns: [{ metric: "time", target: "all" }],
  }),
  ["09.2026,2.92"],
);
// Durations and labels.
assert.equal(formatDuration(5430, { unit: "hms" }), "1:30:30");
assert.equal(formatDuration(5430, { unit: "hm" }), "1:31");
assert.equal(
  formatDuration(5400, { unit: "hours", decimals: 3, decimalSeparator: "," }),
  "1,500",
);
assert.equal(
  columnLabel(
    {
      label: "",
      metric: "share",
      target: "t:calls",
      within: "",
      base: "p:demo",
    },
    categories,
  ),
  "Share % · Calls of Demo",
);
assert.equal(
  columnLabel(
    { label: "", metric: "time", target: "p:gone", within: "", base: "all" },
    categories,
  ),
  "(deleted category)",
);
// Specs: invalid values fall back; activity types analysed only when needed.
const restored = normalizeSpec({
  unit: "days",
  decimals: 9,
  header: "no",
  columns: [{ metric: "nope", target: 5 }],
  range: { preset: "custom", from: "2026-09-01", through: "bad" },
});
assert.equal(restored.unit, "hours");
assert.equal(restored.decimals, 2);
assert.equal(restored.header, true);
assert.deepEqual(restored.columns[0], {
  label: "",
  metric: "time",
  target: "work",
  within: "",
  base: "all",
});
assert.deepEqual(restored.range, {
  preset: "custom",
  from: "2026-09-01",
  through: "",
});
assert.equal(specNeedsTypes(normalizeSpec({})), false);
assert.equal(specNeedsTypes(normalizeSpec({ split: "types" })), true);
for (const p of BUILTIN_PRESETS)
  assert(buildExport(input, p.spec).columns.length);
// Split rows can leave categories out.
assert.equal(
  csv({
    group: "total",
    split: "projects",
    splitExcluded: ["p:other", "p:conflict", "p:unassigned"],
    columns: [{ label: "H", metric: "time", target: "row" }],
  }).length,
  2,
);
// Formula guard and quoting in CSV.
assert.equal(
  lines(
    serializeExport(
      buildExport(
        {
          ...input,
          categories: exportCategories({
            projects: [{ id: "demo", name: '=HYPERLINK("x"), a' }],
          }),
        },
        {
          group: "total",
          split: "projects",
          columns: [{ label: "H", metric: "time", target: "row" }],
        },
      ),
    ),
  )[1],
  `"'=HYPERLINK(""x""), a",1.75`,
);
console.log("export tests passed");

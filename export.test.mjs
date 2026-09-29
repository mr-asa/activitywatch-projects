import assert from "node:assert/strict";
import {
  buildExport,
  exportPeriods,
  formatDuration,
  normalizeExportOptions,
  scopeSegments,
  serializeExport,
  BOM,
} from "./export-core.mjs";

const at = (date, time) => +new Date(`${date}T${time}`);
const seg = (project, date, from, to) => ({
  project,
  start: at(date, from),
  end: at(date, to),
});
// Demo: 1.5 h on Sep 21, 0.25 h on Sep 23. Other: 1 h on Sep 21.
const segments = [
  seg("demo", "2026-09-21", "10:00:00", "11:30:00"),
  seg("other", "2026-09-21", "12:00:00", "13:00:00"),
  seg("demo", "2026-09-23", "09:00:00", "09:15:00"),
  seg("unassigned", "2026-09-22", "09:00:00", "09:10:00"),
];
const categories = [
  { id: "demo", name: "Demo", kind: "project" },
  { id: "other", name: "Other", kind: "non-project" },
];
const input = (cats = categories) => ({
  segments,
  categories: cats,
  start: at("2026-09-21", "04:00:00"),
  end: at("2026-09-24", "04:00:00"),
});
const lines = (text) => text.replace(BOM, "").trim().split("\r\n");

// The simplest timesheet: one project, date + decimal hours.
const sheet = buildExport(input([categories[0]]), {
  categoryColumn: false,
  header: false,
});
assert.deepEqual(lines(serializeExport(sheet)), [
  "2026-09-21,1.50",
  "2026-09-23,0.25",
]);
assert.equal(sheet.total, 6300);
// Empty days, comma decimals, semicolon delimiter, Russian dates.
assert.deepEqual(
  lines(
    serializeExport(
      buildExport(input([categories[0]]), {
        categoryColumn: false,
        emptyPeriods: true,
        decimalSeparator: ",",
        delimiter: ";",
        dateFormat: "dmy",
        decimals: 1,
      }),
    ),
  ),
  ["Date;Hours", "21.09.2026;1,5", "22.09.2026;0,0", "23.09.2026;0,3"],
);
// Wide layout with a total column and total row.
const wide = buildExport(input(), {
  layout: "wide",
  totalRow: true,
  unit: "hm",
});
assert.deepEqual(lines(serializeExport(wide)), [
  "Date,Demo,Other,Total",
  "2026-09-21,1:30,1:00,2:30",
  "2026-09-23,0:15,0:00,0:15",
  "Total,1:45,1:00,2:45",
]);
// Combined value, grouped by week, minutes, TSV.
assert.deepEqual(
  serializeExport(
    buildExport(input(), {
      combine: true,
      group: "week",
      unit: "minutes",
      decimals: 0,
      format: "tsv",
    }),
  ).split("\r\n"),
  ["Week of\tCategory\tMinutes", "2026-09-21\tSelected total\t165", ""],
);
// Whole range totals as JSON with numeric values.
assert.deepEqual(
  JSON.parse(
    serializeExport(buildExport(input(), { group: "total", format: "json" })),
  ),
  [
    { Category: "Demo", Hours: 1.75 },
    { Category: "Other", Hours: 1 },
  ],
);
// Rounding each value to 0.25 h: 1:30 → 1.5, 0:15 → 0.25; 7 min → 0.
assert.equal(
  buildExport(
    {
      ...input([categories[0]]),
      segments: [seg("demo", "2026-09-22", "10:00:00", "10:07:00")],
    },
    { rounding: 15 },
  ).rows.length,
  0,
);
// Month periods and labels.
const months = exportPeriods(
  at("2026-09-28", "04:00:00"),
  at("2026-10-03", "04:00:00"),
  "month",
);
assert.deepEqual(
  months.map((p) => p.key),
  ["2026-09-01", "2026-10-01"],
);
assert.equal(
  serializeExport(
    buildExport(input(), {
      group: "month",
      dateFormat: "dmy",
      categoryColumn: false,
      combine: true,
      header: false,
    }),
  ).trim(),
  "09.2026,2.75",
);
// Durations.
assert.equal(formatDuration(5430, { unit: "hms" }), "1:30:30");
assert.equal(formatDuration(5430, { unit: "hm" }), "1:31");
assert.equal(
  formatDuration(5400, { unit: "hours", decimals: 3, decimalSeparator: "," }),
  "1,500",
);
// Activity types scoped to one project's time.
assert.deepEqual(
  scopeSegments(
    segments,
    [seg("coding", "2026-09-21", "11:00:00", "12:30:00")],
    "demo",
  ).map((s) => (s.end - s.start) / 60000),
  [30],
);
// Invalid stored options fall back to defaults.
const restored = normalizeExportOptions({
  unit: "days",
  decimals: 9,
  header: "no",
  excluded: ["x", 1],
});
assert.equal(restored.unit, "hours");
assert.equal(restored.decimals, 2);
assert.equal(restored.header, true);
assert.deepEqual(restored.excluded, ["x"]);
// Formula guard and quoting in CSV.
assert.equal(
  lines(
    serializeExport(
      buildExport(
        input([{ id: "demo", name: '=HYPERLINK("x"), a', kind: "project" }]),
        {
          group: "total",
        },
      ),
    ),
  )[1],
  `"'=HYPERLINK(""x""), a",1.75`,
);
console.log("export tests passed");

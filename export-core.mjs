import { clipSorted, merge } from "./projects-core.mjs";
import { localDate } from "./rule-engine.mjs";

// Export options. Unknown or invalid values fall back to these defaults, so
// options remembered by an older version never break the dialog.
export const EXPORT_DEFAULTS = {
  source: "projects", // projects | activities
  scope: "", // activities only: restrict to time of this project ("" = all)
  excluded: ["conflict", "unassigned"], // category ids left out
  combine: false, // sum all selected categories into one value
  group: "day", // day | week | month | total
  layout: "long", // long (one row per period and category) | wide (pivot)
  dateColumn: true,
  categoryColumn: true,
  kindColumn: false,
  unit: "hours", // hours | minutes | seconds | hm | hms
  decimals: 2,
  rounding: 0, // minutes; each value is rounded to the nearest step
  decimalSeparator: ".",
  dateFormat: "iso", // iso | dmy | mdy
  emptyPeriods: false,
  totalRow: false,
  format: "csv", // csv | tsv | md | json
  delimiter: ",",
  header: true,
};
const CHOICES = {
  source: ["projects", "activities"],
  group: ["day", "week", "month", "total"],
  layout: ["long", "wide"],
  unit: ["hours", "minutes", "seconds", "hm", "hms"],
  decimals: [0, 1, 2, 3, 4],
  rounding: [0, 1, 5, 6, 10, 15, 30, 60],
  decimalSeparator: [".", ","],
  dateFormat: ["iso", "dmy", "mdy"],
  format: ["csv", "tsv", "md", "json"],
  delimiter: [",", ";"],
};
export function normalizeExportOptions(raw = {}) {
  const out = { ...EXPORT_DEFAULTS };
  if (!raw || typeof raw !== "object") return out;
  for (const [key, fallback] of Object.entries(EXPORT_DEFAULTS)) {
    const value = raw[key];
    if (CHOICES[key]) {
      if (CHOICES[key].includes(value)) out[key] = value;
    } else if (typeof fallback === "boolean") {
      if (typeof value === "boolean") out[key] = value;
    } else if (Array.isArray(fallback)) {
      if (Array.isArray(value))
        out[key] = value.filter((v) => typeof v === "string");
    } else if (typeof value === typeof fallback) out[key] = value;
  }
  return out;
}

// Type segments limited to the time a project (or any category) owns.
export function scopeSegments(projectSegments, segments, scope) {
  if (!scope) return segments;
  const ranges = merge(
    projectSegments
      .filter((s) => s.project === scope)
      .map((s) => [s.start, s.end]),
  );
  return segments.flatMap((s) =>
    clipSorted(ranges, s.start, s.end).map(([start, end]) => ({
      start,
      end,
      project: s.project,
    })),
  );
}

// Report periods between start and end. Days begin at startOfDay; weeks start
// on Monday. Each period is keyed by the calendar date of its first day.
export function exportPeriods(start, end, group = "day", startOfDay = "04:00") {
  if (group === "total") return [{ key: "", start, end }];
  const [h, m] = startOfDay.split(":").map(Number);
  const first = new Date(start - (h * 60 + m) * 60000);
  first.setHours(12, 0, 0, 0);
  if (group === "week")
    first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  if (group === "month") first.setDate(1);
  const periods = [];
  for (let n = 0; n < 5000; n++) {
    const key = localDate(first);
    const from = new Date(first);
    from.setHours(h, m, 0, 0);
    if (group === "month") first.setMonth(first.getMonth() + 1);
    else first.setDate(first.getDate() + (group === "week" ? 7 : 1));
    const to = new Date(first);
    to.setHours(h, m, 0, 0);
    if (+from >= end) break;
    periods.push({
      key,
      start: Math.max(+from, start),
      end: Math.min(+to, end),
    });
  }
  return periods;
}

// Seconds per period and category.
export function periodTotals(segments, periods) {
  const totals = periods.map(() => new Map());
  for (const s of segments) {
    let lo = 0,
      hi = periods.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (periods[mid].end <= s.start) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < periods.length && periods[i].start < s.end; i++) {
      const seconds =
        (Math.min(s.end, periods[i].end) -
          Math.max(s.start, periods[i].start)) /
        1000;
      if (seconds > 0)
        totals[i].set(s.project, (totals[i].get(s.project) || 0) + seconds);
    }
  }
  return totals;
}

const UNIT_LABEL = {
  hours: "Hours",
  minutes: "Minutes",
  seconds: "Seconds",
  hm: "Time (h:mm)",
  hms: "Time (h:mm:ss)",
};
function roundSeconds(seconds, options) {
  const step = options.rounding * 60;
  return step ? Math.round(seconds / step) * step : seconds;
}
export function formatDuration(seconds, options) {
  const o = { ...EXPORT_DEFAULTS, ...options };
  const pad = (n) => String(n).padStart(2, "0");
  if (o.unit === "hm") {
    const m = Math.round(seconds / 60);
    return `${Math.floor(m / 60)}:${pad(m % 60)}`;
  }
  if (o.unit === "hms") {
    const s = Math.round(seconds);
    return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  }
  if (o.unit === "seconds") return String(Math.round(seconds));
  const value = seconds / (o.unit === "minutes" ? 60 : 3600);
  return value.toFixed(o.decimals).replace(".", o.decimalSeparator);
}
function numericDuration(seconds, o) {
  if (o.unit === "seconds") return Math.round(seconds);
  const value = seconds / (o.unit === "minutes" ? 60 : 3600);
  return Number(value.toFixed(o.decimals));
}
export function formatPeriod(key, group, dateFormat = "iso") {
  if (!key) return "";
  const [y, m, d] = key.split("-");
  if (group === "month")
    return dateFormat === "iso"
      ? `${y}-${m}`
      : `${m}${dateFormat === "dmy" ? "." : "/"}${y}`;
  if (dateFormat === "dmy") return `${d}.${m}.${y}`;
  if (dateFormat === "mdy") return `${m}/${d}/${y}`;
  return key;
}

// Builds the export table: typed columns and rows with raw values.
// categories: [{ id, name, kind }] in display order (already filtered).
export function buildExport(
  { segments, categories, start, end, startOfDay = "04:00" },
  options = {},
) {
  const o = normalizeExportOptions(options);
  const periods = exportPeriods(start, end, o.group, startOfDay);
  const totals = periodTotals(segments, periods);
  const series = o.combine
    ? [
        {
          id: "combined",
          name: "Selected total",
          kind: "",
          ids: categories.map((c) => c.id),
        },
      ]
    : categories.map((c) => ({ ...c, ids: [c.id] }));
  const hasDate = o.group !== "total" && o.dateColumn;
  const dateLabel =
    { day: "Date", week: "Week of", month: "Month" }[o.group] || "Date";
  const value = (map, s) =>
    roundSeconds(
      s.ids.reduce((n, id) => n + (map.get(id) || 0), 0),
      o,
    );
  const columns = [],
    rows = [];
  if (hasDate) columns.push({ key: "date", label: dateLabel, type: "date" });
  if (o.layout === "wide") {
    series.forEach((s, i) =>
      columns.push({ key: "c" + i, label: s.name, type: "time" }),
    );
    if (series.length > 1)
      columns.push({ key: "total", label: "Total", type: "time" });
    const sums = series.map(() => 0);
    periods.forEach((p, i) => {
      const values = series.map((s) => value(totals[i], s));
      const total = values.reduce((a, b) => a + b, 0);
      if (!total && !o.emptyPeriods) return;
      const row = { date: p.key };
      values.forEach((v, k) => {
        row["c" + k] = v;
        sums[k] += v;
      });
      if (series.length > 1) row.total = total;
      rows.push(row);
    });
    if (o.totalRow && rows.length) {
      const row = { date: "Total", summary: true };
      sums.forEach((v, k) => (row["c" + k] = v));
      if (series.length > 1) row.total = sums.reduce((a, b) => a + b, 0);
      rows.push(row);
    }
  } else {
    if (o.categoryColumn)
      columns.push({ key: "category", label: "Category", type: "text" });
    if (o.kindColumn)
      columns.push({ key: "kind", label: "Type", type: "text" });
    columns.push({ key: "time", label: UNIT_LABEL[o.unit], type: "time" });
    const sums = series.map(() => 0);
    periods.forEach((p, i) => {
      const values = series.map((s) => value(totals[i], s));
      series.forEach((s, k) => {
        if (!values[k] && !o.emptyPeriods) return;
        sums[k] += values[k];
        rows.push({
          date: p.key,
          category: s.name,
          kind: s.kind,
          time: values[k],
        });
      });
    });
    if (o.totalRow && rows.length)
      series.forEach((s, k) =>
        rows.push({
          date: "Total",
          category: s.name,
          kind: s.kind,
          time: sums[k],
          summary: true,
        }),
      );
  }
  const total = rows
    .filter((r) => !r.summary)
    .reduce(
      (n, r) => n + (o.layout === "wide" ? (r.total ?? r.c0 ?? 0) : r.time),
      0,
    );
  return { columns, rows, total, options: o };
}

function cellText(row, column, o) {
  const value = row[column.key];
  if (column.type === "time") return formatDuration(value || 0, o);
  if (column.type === "date")
    return row.summary ? "Total" : formatPeriod(value, o.group, o.dateFormat);
  return String(value ?? "");
}
// Spreadsheet formula guard for text cells (CSV/TSV injection).
const guard = (s) => (/^[\s]*[=+@-]/.test(s) ? "'" + s : s);
export function serializeExport(table, format = table.options.format) {
  const o = table.options;
  const { columns, rows } = table;
  const text = (row, c) =>
    c.type === "text" ? guard(cellText(row, c, o)) : cellText(row, c, o);
  if (format === "json")
    return (
      JSON.stringify(
        rows.map((row) =>
          Object.fromEntries(
            columns.map((c) => [
              c.label,
              c.type === "time" && !["hm", "hms"].includes(o.unit)
                ? numericDuration(row[c.key] || 0, o)
                : cellText(row, c, o),
            ]),
          ),
        ),
        null,
        2,
      ) + "\n"
    );
  if (format === "md") {
    const clean = (s) => s.replace(/\r?\n/g, " ").replaceAll("|", "\\|");
    const line = (cells) => "| " + cells.join(" | ") + " |";
    const out = [
      line(columns.map((c) => clean(c.label))),
      line(columns.map((c) => (c.type === "time" ? "---:" : "---"))),
      ...rows.map((row) =>
        line(columns.map((c) => clean(cellText(row, c, o)))),
      ),
    ];
    return out.join("\n") + "\n";
  }
  if (format === "tsv") {
    const clean = (s) => s.replace(/[\t\r\n]+/g, " ");
    const out = rows.map((row) =>
      columns.map((c) => clean(text(row, c))).join("\t"),
    );
    if (o.header) out.unshift(columns.map((c) => clean(c.label)).join("\t"));
    return out.join("\r\n") + "\r\n";
  }
  const d = o.delimiter;
  const quote = (s) =>
    s.includes(d) || /["\r\n]/.test(s)
      ? '"' + s.replaceAll('"', '""') + '"'
      : s;
  const out = rows.map((row) =>
    columns.map((c) => quote(text(row, c))).join(d),
  );
  if (o.header) out.unshift(columns.map((c) => quote(guard(c.label))).join(d));
  return BOM + out.join("\r\n") + "\r\n";
}
// Byte order mark so Excel opens UTF-8 CSV correctly.
export const BOM = String.fromCharCode(0xfeff);
export const EXPORT_FILE = {
  csv: ["csv", "text/csv;charset=utf-8"],
  tsv: ["tsv", "text/tab-separated-values;charset=utf-8"],
  md: ["md", "text/markdown;charset=utf-8"],
  json: ["json", "application/json"],
};

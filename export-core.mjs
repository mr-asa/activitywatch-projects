import { clipSorted, intersect, merge } from "./projects-core.mjs";
import { localDate } from "./rule-engine.mjs";

// An export is described by a spec: a date range, how rows are formed
// (period, optionally split by category) and a user-built list of columns.
// Each column measures one metric of a target set of time, optionally limited
// to another set ("within"); shares are taken of a base set.
//
// Time sets are keyed: "all" (all active time), "work" (all project work),
// "nonproject", "p:<project id>", "t:<activity type id>" (incl. p:conflict,
// p:unassigned, t:conflict, t:unassigned) and "row" (the row's category).

export const METRICS = {
  time: { label: "Time", type: "duration" },
  share: { label: "Share %", type: "percent" },
  sessions: { label: "Sessions", type: "count" },
  longest: { label: "Longest session", type: "duration" },
  average: { label: "Average session", type: "duration" },
  perDay: { label: "Average per active day", type: "duration" },
  days: { label: "Active days", type: "count" },
  first: { label: "First activity", type: "clock" },
  last: { label: "Last activity", type: "clock" },
};
export const SPECIAL_TARGETS = [
  ["all", "All active time"],
  ["work", "All project work"],
  ["nonproject", "Non-project time"],
];
export const RANGE_PRESETS = [
  ["report", "Current report period"],
  ["this-week", "This week"],
  ["last-week", "Last week"],
  ["this-month", "This month"],
  ["last-month", "Last month"],
  ["last7", "Last 7 days"],
  ["last30", "Last 30 days"],
  ["this-year", "This year"],
  ["project", "Whole project"],
  ["custom", "Custom dates"],
];
const COLUMN_DEFAULTS = {
  label: "",
  metric: "time",
  target: "work",
  within: "",
  base: "all",
};
export const SPEC_DEFAULTS = {
  range: { preset: "report", from: "", through: "" },
  group: "day", // day | week | month | total
  split: "none", // none | projects | types
  splitExcluded: ["p:conflict", "p:unassigned", "t:conflict", "t:unassigned"],
  columns: [{ ...COLUMN_DEFAULTS, label: "Hours" }],
  dateColumn: true,
  emptyPeriods: false,
  totalRow: false,
  sessionGap: 1, // minutes; shorter breaks do not end a session
  unit: "hours", // hours | minutes | seconds | hm | hms
  decimals: 2,
  rounding: 0, // minutes; duration cells are rounded to the nearest step
  decimalSeparator: ".",
  dateFormat: "YYYY-MM-DD", // pattern for day and week rows, see formatDate
  monthFormat: "YYYY-MM", // pattern for month rows
  dateLocale: "", // month/weekday names; "" = browser language
  format: "csv", // csv | tsv | md | json
  delimiter: ",",
  header: true,
};
const CHOICES = {
  group: ["day", "week", "month", "total"],
  split: ["none", "projects", "types"],
  unit: ["hours", "minutes", "seconds", "hm", "hms"],
  decimals: [0, 1, 2, 3, 4],
  rounding: [0, 1, 5, 6, 10, 15, 30, 60],
  sessionGap: [0, 1, 2, 5, 10, 15, 30],
  decimalSeparator: [".", ","],
  format: ["csv", "tsv", "md", "json"],
  delimiter: [",", ";"],
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
function normalizeColumn(raw) {
  const c = { ...COLUMN_DEFAULTS };
  if (!raw || typeof raw !== "object") return c;
  c.label = text(raw.label, 100);
  if (Object.hasOwn(METRICS, raw.metric)) c.metric = raw.metric;
  for (const key of ["target", "within", "base"])
    if (typeof raw[key] === "string") c[key] = raw[key].slice(0, 200);
  if (!c.target) c.target = "all";
  if (!c.base) c.base = "all";
  return c;
}
// Unknown or invalid values fall back to defaults, so specs saved by an older
// version (or edited by hand) never break the dialog.
export function normalizeSpec(raw) {
  const out = structuredClone(SPEC_DEFAULTS);
  if (!raw || typeof raw !== "object") return out;
  for (const [key, choices] of Object.entries(CHOICES))
    if (choices.includes(raw[key])) out[key] = raw[key];
  for (const key of ["dateColumn", "emptyPeriods", "totalRow", "header"])
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  if (Array.isArray(raw.splitExcluded))
    out.splitExcluded = raw.splitExcluded.filter((v) => typeof v === "string");
  if (Array.isArray(raw.columns) && raw.columns.length)
    out.columns = raw.columns.slice(0, 30).map(normalizeColumn);
  for (const key of ["dateFormat", "monthFormat"])
    if (typeof raw[key] === "string" && raw[key].trim())
      out[key] = (LEGACY_DATES[raw[key]] || raw[key]).slice(0, 60);
  if (raw.dateFormat in LEGACY_DATES && !raw.monthFormat)
    out.monthFormat = LEGACY_MONTHS[raw.dateFormat];
  if (typeof raw.dateLocale === "string" && isLocale(raw.dateLocale))
    out.dateLocale = raw.dateLocale;
  const r = raw.range || {};
  if (RANGE_PRESETS.some(([id]) => id === r.preset))
    out.range.preset = r.preset;
  if (DATE.test(r.from)) out.range.from = r.from;
  if (DATE.test(r.through)) out.range.through = r.through;
  return out;
}
export const newColumn = (patch = {}) =>
  normalizeColumn({ ...COLUMN_DEFAULTS, ...patch });

// Every category a column can target or a row can be split by.
export function exportCategories(config) {
  return [
    ...config.projects.map((p) => ({
      key: "p:" + p.id,
      id: p.id,
      name: p.name,
      source: "p",
      kind: p.kind || "project",
      archived: !!p.archived,
    })),
    {
      key: "p:conflict",
      id: "conflict",
      name: "Needs review",
      source: "p",
      kind: "conflict",
    },
    {
      key: "p:unassigned",
      id: "unassigned",
      name: "Not assigned",
      source: "p",
      kind: "unassigned",
    },
    ...(config.activityTypes || []).map((t) => ({
      key: "t:" + t.id,
      id: t.id,
      name: t.name,
      source: "t",
      kind: "activity type",
    })),
    {
      key: "t:unassigned",
      id: "unassigned",
      name: "No activity type",
      source: "t",
      kind: "unassigned",
    },
  ];
}
// Whether activity types must be analysed for this spec.
export function specNeedsTypes(spec) {
  return (
    spec.split === "types" ||
    spec.columns.some((c) =>
      [c.target, c.within, c.metric === "share" ? c.base : ""].some((k) =>
        k.startsWith("t:"),
      ),
    )
  );
}
export function targetName(key, categories) {
  if (!key) return "";
  if (key === "row") return "Row category";
  const special = SPECIAL_TARGETS.find(([k]) => k === key);
  if (special) return special[1];
  return categories.find((c) => c.key === key)?.name || "(deleted category)";
}
export function columnLabel(column, categories) {
  if (column.label) return column.label;
  const name = (k) => targetName(k, categories);
  let label =
    column.metric === "time"
      ? name(column.target)
      : `${METRICS[column.metric].label} · ${name(column.target)}`;
  if (column.within) label += " in " + name(column.within);
  if (column.metric === "share" && column.base !== "all")
    label += " of " + name(column.base);
  return label;
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

const seconds = (ranges, start, end) =>
  clipSorted(ranges, start, end).reduce((n, [a, b]) => n + (b - a) / 1000, 0);
// Consecutive intervals separated by less than gap ms form one session.
// A session's length is its active time, not its wall-clock span.
export function sessions(ranges, gap) {
  const out = [];
  for (const [s, e] of ranges) {
    const last = out.at(-1);
    if (last && s - last.end < gap) {
      last.end = e;
      last.seconds += (e - s) / 1000;
    } else out.push({ start: s, end: e, seconds: (e - s) / 1000 });
  }
  return out;
}

// Builds the table: typed columns and rows of raw cell values.
export function buildExport(
  {
    projectSegments,
    typeSegments = [],
    categories,
    start,
    end,
    startOfDay = "04:00",
  },
  rawSpec,
) {
  const spec = normalizeSpec(rawSpec);
  const periods = exportPeriods(start, end, spec.group, startOfDay);
  const days = exportPeriods(start, end, "day", startOfDay);
  const kinds = new Map(
    categories.filter((c) => c.source === "p").map((c) => [c.id, c.kind]),
  );
  const cache = new Map();
  function set(key) {
    if (cache.has(key)) return cache.get(key);
    let segments = [];
    if (key === "all") segments = projectSegments;
    else if (key === "work")
      segments = projectSegments.filter(
        (s) => kinds.get(s.project) === "project",
      );
    else if (key === "nonproject")
      segments = projectSegments.filter(
        (s) => kinds.get(s.project) === "non-project",
      );
    else if (key.startsWith("p:"))
      segments = projectSegments.filter((s) => s.project === key.slice(2));
    else if (key.startsWith("t:"))
      segments = typeSegments.filter((s) => s.project === key.slice(2));
    const ranges = merge(segments.map((s) => [s.start, s.end]));
    cache.set(key, ranges);
    return ranges;
  }
  const rowCats =
    spec.split === "none"
      ? [null]
      : categories.filter(
          (c) =>
            c.source === (spec.split === "projects" ? "p" : "t") &&
            !spec.splitExcluded.includes(c.key),
        );
  const resolve = (key, row) => set(key === "row" ? row?.key || "" : key);
  // Per column and row category: the measured ranges and derived data.
  const prepared = new Map();
  function prepare(ci, row) {
    const id = ci + "|" + (row?.key || "");
    if (prepared.has(id)) return prepared.get(id);
    const c = spec.columns[ci];
    let ranges = resolve(c.target, row);
    if (c.within) ranges = intersect(ranges, resolve(c.within, row));
    const base = c.metric === "share" ? resolve(c.base, row) : null;
    const p = {
      ranges,
      base,
      shared: base && intersect(ranges, base),
      sessions: ["sessions", "longest", "average"].includes(c.metric)
        ? sessions(ranges, spec.sessionGap * 60000)
        : null,
      days: ["days", "perDay"].includes(c.metric)
        ? days.map((d) => ({ ...d, seconds: seconds(ranges, d.start, d.end) }))
        : null,
    };
    prepared.set(id, p);
    return p;
  }
  const round = (s) => {
    const step = spec.rounding * 60;
    return step ? Math.round(s / step) * step : s;
  };
  function measure(ci, row, from, to) {
    const c = spec.columns[ci];
    const p = prepare(ci, row);
    switch (c.metric) {
      case "time":
        return round(seconds(p.ranges, from, to));
      case "share": {
        const base = seconds(p.base, from, to);
        return base ? seconds(p.shared, from, to) / base : null;
      }
      case "sessions":
      case "longest":
      case "average": {
        const list = p.sessions.filter((s) => s.start >= from && s.start < to);
        if (c.metric === "sessions") return list.length;
        if (!list.length) return 0;
        return round(
          c.metric === "longest"
            ? Math.max(...list.map((s) => s.seconds))
            : list.reduce((n, s) => n + s.seconds, 0) / list.length,
        );
      }
      case "days":
      case "perDay": {
        const active = p.days.filter(
          (d) => d.start >= from && d.start < to && d.seconds > 0,
        );
        if (c.metric === "days") return active.length;
        return active.length
          ? round(active.reduce((n, d) => n + d.seconds, 0) / active.length)
          : 0;
      }
      case "first":
      case "last": {
        const clipped = clipSorted(p.ranges, from, to);
        if (!clipped.length) return null;
        return c.metric === "first" ? clipped[0][0] : clipped.at(-1)[1];
      }
    }
  }
  const columns = [];
  const hasDate = spec.group !== "total" && spec.dateColumn;
  if (hasDate)
    columns.push({
      label: { day: "Date", week: "Week of", month: "Month" }[spec.group],
      type: "date",
    });
  if (spec.split !== "none") columns.push({ label: "Category", type: "text" });
  const firstValue = columns.length;
  spec.columns.forEach((c) =>
    columns.push({
      label: columnLabel(c, categories),
      type: METRICS[c.metric].type,
      metric: c.metric,
    }),
  );
  const rows = [];
  for (const period of periods)
    for (const row of rowCats) {
      const values = spec.columns.map((_, ci) =>
        measure(ci, row, period.start, period.end),
      );
      if (!spec.emptyPeriods && !values.some(Boolean)) continue;
      const cells = [];
      if (hasDate) cells.push(period.key);
      if (row) cells.push(row.name);
      rows.push({ cells: [...cells, ...values], row: row?.key || "" });
    }
  if (spec.totalRow && rows.length)
    for (const row of rowCats) {
      const own = rows.filter((r) => r.row === (row?.key || ""));
      if (!own.length && row) continue;
      const cells = [];
      if (hasDate) cells.push("Total");
      if (row) cells.push(row.name);
      spec.columns.forEach((c, ci) => {
        // Rounded time adds up exactly as the rows do; clock times have no total.
        if (c.metric === "time")
          cells.push(own.reduce((n, r) => n + r.cells[firstValue + ci], 0));
        else if (c.metric === "first" || c.metric === "last") cells.push(null);
        else cells.push(measure(ci, row, start, end));
      });
      rows.push({ cells, row: row?.key || "", summary: true });
    }
  return { columns, rows, spec };
}

export function formatDuration(seconds, options) {
  const o = { ...SPEC_DEFAULTS, ...options };
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
// Earlier versions stored named formats.
const LEGACY_DATES = {
  iso: "YYYY-MM-DD",
  dmy: "DD.MM.YYYY",
  mdy: "MM/DD/YYYY",
};
const LEGACY_MONTHS = { iso: "YYYY-MM", dmy: "MM.YYYY", mdy: "MM/YYYY" };
function isLocale(tag) {
  if (!tag) return true;
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0;
  } catch {
    return false;
  }
}
export const DATE_SUGGESTIONS = [
  "YYYY-MM-DD",
  "DD.MM.YYYY",
  "MM/DD/YYYY",
  "D MMM YYYY",
  "ddd, DD.MM",
  "dddd, D MMMM YYYY",
  "YYYY-[W]WW",
];
export const MONTH_SUGGESTIONS = ["YYYY-MM", "MM.YYYY", "MMMM YYYY", "MMM YY"];
// Common date tokens (as in Moment/Day.js/Excel). Text in [brackets] is
// literal. ISO week: W/WW with GGGG for its year.
const TOKENS =
  /\[([^\]]*)\]|YYYY|GGGG|YY|MMMM|MMM|MM|M|DDDD|DD|D|dddd|ddd|dd|d|WW|W|Q|./g;
export function formatDate(key, pattern, locale = "") {
  if (!DATE.test(key)) return key;
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const name = (options) =>
    new Intl.DateTimeFormat(locale || undefined, options).format(date);
  // Next to a day number some languages decline the month ("28 сентября").
  const withDay = /D(?!D)/.test(pattern.replace(/\[[^\]]*\]|DDDD/g, ""));
  const month = (width) =>
    withDay
      ? new Intl.DateTimeFormat(locale || undefined, {
          day: "numeric",
          month: width,
        })
          .formatToParts(date)
          .find((p) => p.type === "month").value
      : name({ month: width });
  // ISO week: the Thursday of this week decides the week and its year.
  const thursday = new Date(date);
  thursday.setDate(d + 3 - ((date.getDay() + 6) % 7));
  const yearStart = new Date(thursday.getFullYear(), 0, 1, 12);
  const days = (a, b) => Math.round((a - b) / 86400000);
  const week = 1 + Math.floor(days(thursday, yearStart) / 7);
  const dayOfYear = 1 + days(date, new Date(y, 0, 1, 12));
  const values = {
    YYYY: () => pad(y, 4),
    GGGG: () => pad(thursday.getFullYear(), 4),
    YY: () => pad(y % 100),
    MMMM: () => month("long"),
    MMM: () => month("short"),
    MM: () => pad(m),
    M: () => String(m),
    DDDD: () => pad(dayOfYear, 3),
    DD: () => pad(d),
    D: () => String(d),
    dddd: () => name({ weekday: "long" }),
    ddd: () => name({ weekday: "short" }),
    dd: () => name({ weekday: "narrow" }),
    d: () => String(date.getDay() || 7),
    WW: () => pad(week),
    W: () => String(week),
    Q: () => String(Math.ceil(m / 3)),
  };
  return pattern.replace(TOKENS, (token, literal) =>
    literal !== undefined ? literal : values[token] ? values[token]() : token,
  );
}
export function formatPeriod(key, spec) {
  return formatDate(
    key,
    spec.group === "month" ? spec.monthFormat : spec.dateFormat,
    spec.dateLocale,
  );
}
const clock = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
export function formatCell(value, column, spec) {
  if (column.type === "date") return formatPeriod(value, spec);
  if (column.type === "text") return String(value ?? "");
  if (value === null || value === undefined) return "";
  if (column.type === "duration") return formatDuration(value, spec);
  if (column.type === "percent")
    return (value * 100)
      .toFixed(spec.decimals)
      .replace(".", spec.decimalSeparator);
  if (column.type === "clock") return clock(value);
  return String(value);
}
function jsonCell(value, column, spec) {
  if (value === null || value === undefined) return null;
  if (column.type === "duration" && !["hm", "hms"].includes(spec.unit)) {
    if (spec.unit === "seconds") return Math.round(value);
    return Number(
      (value / (spec.unit === "minutes" ? 60 : 3600)).toFixed(spec.decimals),
    );
  }
  if (column.type === "percent")
    return Number((value * 100).toFixed(spec.decimals));
  if (column.type === "count") return value;
  return formatCell(value, column, spec);
}

// Spreadsheet formula guard for text cells (CSV/TSV injection).
const guard = (s) => (/^[\s]*[=+@-]/.test(s) ? "'" + s : s);
export function serializeExport(table, format = table.spec.format) {
  const { columns, rows, spec } = table;
  const cell = (row, i) => {
    const s = formatCell(row.cells[i], columns[i], spec);
    return columns[i].type === "text" ? guard(s) : s;
  };
  if (format === "json") {
    const seen = new Map();
    const keys = columns.map((c) => {
      const n = (seen.get(c.label) || 0) + 1;
      seen.set(c.label, n);
      return n > 1 ? `${c.label} (${n})` : c.label;
    });
    return (
      JSON.stringify(
        rows.map((row) =>
          Object.fromEntries(
            columns.map((c, i) => [keys[i], jsonCell(row.cells[i], c, spec)]),
          ),
        ),
        null,
        2,
      ) + "\n"
    );
  }
  if (format === "md") {
    const clean = (s) => s.replace(/\r?\n/g, " ").replaceAll("|", "\\|");
    const line = (cells) => "| " + cells.join(" | ") + " |";
    const numeric = (c) => !["date", "text"].includes(c.type);
    return (
      [
        line(columns.map((c) => clean(c.label))),
        line(columns.map((c) => (numeric(c) ? "---:" : "---"))),
        ...rows.map((row) =>
          line(columns.map((c, i) => clean(formatCell(row.cells[i], c, spec)))),
        ),
      ].join("\n") + "\n"
    );
  }
  if (format === "tsv") {
    const clean = (s) => s.replace(/[\t\r\n]+/g, " ");
    const out = rows.map((row) =>
      columns.map((_, i) => clean(cell(row, i))).join("\t"),
    );
    if (spec.header)
      out.unshift(columns.map((c) => clean(guard(c.label))).join("\t"));
    return out.join("\r\n") + "\r\n";
  }
  const d = spec.delimiter;
  const quote = (s) =>
    s.includes(d) || /["\r\n]/.test(s)
      ? '"' + s.replaceAll('"', '""') + '"'
      : s;
  const out = rows.map((row) =>
    columns.map((_, i) => quote(cell(row, i))).join(d),
  );
  if (spec.header)
    out.unshift(columns.map((c) => quote(guard(c.label))).join(d));
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

// Ready-made specs offered in the preset list; saved presets sit beside them.
export const BUILTIN_PRESETS = [
  {
    id: "builtin:timesheet",
    name: "Timesheet: date + hours",
    spec: {
      emptyPeriods: true,
      columns: [{ label: "Hours", metric: "time", target: "work" }],
    },
  },
  {
    id: "builtin:per-project",
    name: "Hours per project per day",
    spec: {
      split: "projects",
      columns: [{ label: "Hours", metric: "time", target: "row" }],
    },
  },
  {
    id: "builtin:totals",
    name: "Project totals and shares",
    spec: {
      group: "total",
      split: "projects",
      columns: [
        { label: "Hours", metric: "time", target: "row" },
        {
          label: "Share of active time %",
          metric: "share",
          target: "row",
          base: "all",
        },
      ],
    },
  },
  {
    id: "builtin:day-overview",
    name: "Daily overview",
    spec: {
      columns: [
        { label: "Start", metric: "first", target: "all" },
        { label: "End", metric: "last", target: "all" },
        { label: "Active hours", metric: "time", target: "all" },
        { label: "Project hours", metric: "time", target: "work" },
        {
          label: "Project share %",
          metric: "share",
          target: "work",
          base: "all",
        },
      ],
    },
  },
  {
    id: "builtin:sessions",
    name: "Activity type sessions per week",
    spec: {
      group: "week",
      split: "types",
      range: { preset: "last30" },
      columns: [
        { label: "Sessions", metric: "sessions", target: "row" },
        { label: "Longest session", metric: "longest", target: "row" },
        { label: "Average session", metric: "average", target: "row" },
        {
          label: "Share of active time %",
          metric: "share",
          target: "row",
          base: "all",
        },
      ],
    },
  },
].map((p) => ({ ...p, builtin: true, spec: normalizeSpec(p.spec) }));

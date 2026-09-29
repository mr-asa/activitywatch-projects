import { analyze, loadRange } from "./projects-core.mjs";
import { analyzeActivityTypes } from "./activity-core.mjs";
import { localDate } from "./rule-engine.mjs";
import { pref, setPref } from "./ui-prefs.mjs";
import {
  BOM,
  EXPORT_FILE,
  buildExport,
  formatDuration,
  normalizeExportOptions,
  scopeSegments,
  serializeExport,
} from "./export-core.mjs";

const RANGES = [
  ["report", "Current report period"],
  ["this-week", "This week"],
  ["last-week", "Last week"],
  ["this-month", "This month"],
  ["last-month", "Last month"],
  ["last30", "Last 30 days"],
  ["this-year", "This year"],
  ["custom", "Custom"],
];
// Quick starting points; they change only the listed options.
const PRESETS = [
  [
    "Timesheet: date + decimal hours",
    {
      layout: "long",
      combine: true,
      dateColumn: true,
      categoryColumn: false,
      kindColumn: false,
      group: "day",
      unit: "hours",
      decimals: 2,
      emptyPeriods: false,
    },
  ],
  [
    "Table: one column per category",
    { layout: "wide", combine: false, group: "day", totalRow: true },
  ],
  [
    "Totals per category",
    {
      layout: "long",
      combine: false,
      group: "total",
      categoryColumn: true,
      totalRow: false,
    },
  ],
];

export function setupExport({ state, api, dialog, show, download, notice }) {
  const view = dialog("report-dialog", "Reports & export");
  view.dialog.classList.add("export-dialog");
  let options = normalizeExportOptions(pref("exportOptions"));
  let range = {
    preset: "report",
    from: "",
    through: "",
    ...pref("exportRange", {}),
  };
  if (!RANGES.some(([id]) => id === range.preset)) range.preset = "report";
  let snapshot = null, // { key, data, end }
    analysis = null, // { key, result, typeResult }
    token = 0,
    output = "",
    table = null;
  const node = (tag, text, className) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (className) n.className = className;
    return n;
  };
  const button = (name, run) => {
    const b = node("button", name);
    b.type = "button";
    b.onclick = run;
    return b;
  };
  function select(label, pairs, value, change) {
    const s = node("select");
    s.setAttribute("aria-label", label);
    for (const [v, text] of pairs) s.append(new Option(text, String(v)));
    s.value = String(value);
    s.onchange = () => change(s.value);
    const l = node("label", label);
    l.append(s);
    return l;
  }
  function check(label, value, change) {
    const l = node("label", undefined, "check-label");
    const c = node("input");
    c.type = "checkbox";
    c.checked = value;
    c.onchange = () => change(c.checked);
    l.append(c, " " + label);
    return l;
  }
  function set(patch, reload = false) {
    options = normalizeExportOptions({ ...options, ...patch });
    setPref("exportOptions", options);
    draw();
    reload ? refresh() : rebuild();
  }
  const startOfDay = () => state.settings?.startOfDay || "04:00";
  function reportDay(ms) {
    const [h, m] = startOfDay().split(":").map(Number);
    return localDate(new Date(ms - (h * 60 + m) * 60000));
  }
  // Calendar dates (inclusive) for the selected range.
  function dates() {
    if (range.preset === "custom") return [range.from, range.through];
    if (range.preset === "report")
      return [
        reportDay(state.start),
        reportDay(Math.min(state.end, Date.now()) - 1),
      ];
    const today = new Date(reportDay(Date.now()) + "T12:00:00");
    const first = new Date(today),
      last = new Date(today);
    if (range.preset === "last30") first.setDate(first.getDate() - 29);
    if (range.preset.endsWith("week")) {
      first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
      if (range.preset === "last-week") first.setDate(first.getDate() - 7);
      last.setTime(+first);
      last.setDate(last.getDate() + 6);
    }
    if (range.preset.endsWith("month")) {
      first.setDate(1);
      if (range.preset === "last-month") first.setMonth(first.getMonth() - 1);
      last.setTime(+first);
      last.setMonth(last.getMonth() + 1, 0);
    }
    if (range.preset === "this-year") first.setMonth(0, 1);
    return [localDate(first), localDate(last)];
  }
  function categories() {
    if (options.source === "activities")
      return [
        ...(state.config.activityTypes || []).map((t) => ({
          id: t.id,
          name: t.name,
          kind: "activity type",
        })),
        { id: "conflict", name: "Type needs review", kind: "conflict" },
        { id: "unassigned", name: "No activity type", kind: "unassigned" },
      ];
    return [
      ...state.config.projects.map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind || "project",
        archived: p.archived,
      })),
      { id: "conflict", name: "Needs review", kind: "conflict" },
      { id: "unassigned", name: "Not assigned", kind: "unassigned" },
    ];
  }
  const controls = node("div", undefined, "export-controls");
  const status = node("p", "", "muted");
  status.setAttribute("role", "status");
  const pre = node("pre", "", "export-preview");
  pre.setAttribute("aria-label", "Export preview");
  const actions = node("div", undefined, "export-actions");
  actions.append(
    button("Download", () => {
      if (!table) return;
      const [ext, type] = EXPORT_FILE[options.format];
      const [from, through] = dates();
      download(output, `activity-export_${from}_${through}.${ext}`, type);
    }),
    button("Copy to clipboard", async () => {
      if (!table) return;
      try {
        await navigator.clipboard.writeText(output.replace(BOM, ""));
        notice("Export copied to the clipboard.", "success");
      } catch (e) {
        notice("Could not copy: " + e.message, "error");
      }
    }),
  );
  const side = node("div", undefined, "export-output");
  side.append(status, actions, pre);
  view.body.className = "export-layout";
  view.body.append(controls, side);

  function draw() {
    const [from, through] = dates();
    const group = (title, ...children) => {
      const f = node("fieldset", undefined, "export-group");
      f.append(node("legend", title), ...children);
      return f;
    };
    const presetRow = node("div", undefined, "export-row");
    presetRow.append(node("span", "Quick setup:", "muted"));
    for (const [name, patch] of PRESETS)
      presetRow.append(button(name, () => set(patch)));
    const fromInput = node("input"),
      throughInput = node("input");
    for (const [input, value, label] of [
      [fromInput, from, "From"],
      [throughInput, through, "Through"],
    ]) {
      input.type = "date";
      input.value = value;
      input.setAttribute("aria-label", "Export " + label.toLowerCase());
      input.onchange = () => {
        range = {
          preset: "custom",
          from: fromInput.value,
          through: throughInput.value,
        };
        setPref("exportRange", range);
        draw();
        refresh();
      };
    }
    const fromLabel = node("label", "From"),
      throughLabel = node("label", "Through");
    fromLabel.append(fromInput);
    throughLabel.append(throughInput);
    const rangeRow = node("div", undefined, "export-row");
    rangeRow.append(
      select("Range", RANGES, range.preset, (v) => {
        range = { preset: v, from, through };
        setPref("exportRange", range);
        draw();
        refresh();
      }),
      fromLabel,
      throughLabel,
    );
    const sourceRow = node("div", undefined, "export-row");
    sourceRow.append(
      select(
        "Classify by",
        [
          ["projects", "Projects"],
          ["activities", "Activity types"],
        ],
        options.source,
        (v) => set({ source: v }, true),
      ),
    );
    if (options.source === "activities")
      sourceRow.append(
        select(
          "Within project",
          [
            ["", "All recorded time"],
            ...state.config.projects.map((p) => [p.id, p.name]),
          ],
          options.scope,
          (v) => set({ scope: v }, true),
        ),
      );
    const list = node("div", undefined, "export-categories");
    const excluded = new Set(options.excluded);
    for (const c of categories())
      list.append(
        check(
          c.name + (c.archived ? " (archived)" : ""),
          !excluded.has(c.id),
          (on) => {
            const next = new Set(options.excluded);
            on ? next.delete(c.id) : next.add(c.id);
            set({ excluded: [...next] });
          },
        ),
      );
    const bulk = node("div", undefined, "export-row");
    bulk.append(
      button("Select all", () => set({ excluded: [] })),
      button("Select none", () =>
        set({ excluded: categories().map((c) => c.id) }),
      ),
      check("Combine selected into one value", options.combine, (v) =>
        set({ combine: v }),
      ),
    );
    const shape = node("div", undefined, "export-row");
    shape.append(
      select(
        "Group by",
        [
          ["day", "Day"],
          ["week", "Week"],
          ["month", "Month"],
          ["total", "Whole range"],
        ],
        options.group,
        (v) => set({ group: v }),
      ),
      select(
        "Layout",
        [
          ["long", "Rows: period · category · time"],
          ["wide", "Table: one column per category"],
        ],
        options.layout,
        (v) => set({ layout: v }),
      ),
    );
    const columns = node("div", undefined, "export-row");
    if (options.group !== "total")
      columns.append(
        check("Date column", options.dateColumn, (v) => set({ dateColumn: v })),
      );
    if (options.layout === "long")
      columns.append(
        check("Category column", options.categoryColumn, (v) =>
          set({ categoryColumn: v }),
        ),
        check("Category type column", options.kindColumn, (v) =>
          set({ kindColumn: v }),
        ),
      );
    if (options.group !== "total")
      columns.append(
        check("Include periods without time", options.emptyPeriods, (v) =>
          set({ emptyPeriods: v }),
        ),
      );
    columns.append(
      check("Total row", options.totalRow, (v) => set({ totalRow: v })),
    );
    const numbers = node("div", undefined, "export-row");
    numbers.append(
      select(
        "Time as",
        [
          ["hours", "Decimal hours (1.50)"],
          ["minutes", "Minutes (90)"],
          ["seconds", "Seconds"],
          ["hm", "h:mm (1:30)"],
          ["hms", "h:mm:ss"],
        ],
        options.unit,
        (v) => set({ unit: v }),
      ),
    );
    if (["hours", "minutes"].includes(options.unit))
      numbers.append(
        select(
          "Decimals",
          [0, 1, 2, 3, 4].map((n) => [n, String(n)]),
          options.decimals,
          (v) => set({ decimals: Number(v) }),
        ),
        select(
          "Decimal separator",
          [
            [".", "Point (1.5)"],
            [",", "Comma (1,5)"],
          ],
          options.decimalSeparator,
          (v) => set({ decimalSeparator: v }),
        ),
      );
    numbers.append(
      select(
        "Round each value to",
        [
          [0, "No rounding"],
          [1, "1 minute"],
          [5, "5 minutes"],
          [6, "6 minutes (0.1 h)"],
          [10, "10 minutes"],
          [15, "15 minutes (0.25 h)"],
          [30, "30 minutes"],
          [60, "1 hour"],
        ],
        options.rounding,
        (v) => set({ rounding: Number(v) }),
      ),
      select(
        "Date format",
        [
          ["iso", "2026-09-28"],
          ["dmy", "28.09.2026"],
          ["mdy", "09/28/2026"],
        ],
        options.dateFormat,
        (v) => set({ dateFormat: v }),
      ),
    );
    const file = node("div", undefined, "export-row");
    file.append(
      select(
        "Format",
        [
          ["csv", "CSV"],
          ["tsv", "TSV (paste into spreadsheets)"],
          ["md", "Markdown table"],
          ["json", "JSON"],
        ],
        options.format,
        (v) => set({ format: v }),
      ),
    );
    if (options.format === "csv")
      file.append(
        select(
          "Delimiter",
          [
            [",", "Comma"],
            [";", "Semicolon"],
          ],
          options.delimiter,
          (v) => set({ delimiter: v }),
        ),
      );
    if (["csv", "tsv"].includes(options.format))
      file.append(
        check("Header row", options.header, (v) => set({ header: v })),
      );
    controls.replaceChildren(
      presetRow,
      group("Period", rangeRow),
      group("Categories", sourceRow, list, bulk),
      group("Rows and columns", shape, columns),
      group("Values", numbers),
      group("File", file),
    );
  }

  function bounds() {
    const [from, through] = dates();
    if (!from || !through || from > through)
      throw Error("Choose a valid range: From must be on or before Through.");
    const start = new Date(`${from}T${startOfDay()}:00`);
    const end = new Date(`${through}T${startOfDay()}:00`);
    end.setDate(end.getDate() + 1);
    return [+start, +end];
  }
  // Fetches (or reuses) raw events for the range, then analyses them.
  async function refresh() {
    const run = ++token;
    table = null;
    let start, end;
    try {
      [start, end] = bounds();
    } catch (e) {
      status.textContent = e.message;
      pre.textContent = "";
      return;
    }
    const key = [state.host, start, end].join("|");
    try {
      if (snapshot?.key !== key) {
        const report = state.dataRange;
        if (
          state.data &&
          report?.host === state.host &&
          report.start <= start &&
          report.requestedEnd >= end
        )
          snapshot = { key, data: state.data, end: Math.min(end, report.end) };
        else {
          status.textContent = "Loading the selected range…";
          const loaded = await loadRange(
            api,
            state.buckets,
            state.host,
            start,
            end,
          );
          if (run !== token) return;
          snapshot = { key, data: loaded.data, end: Math.min(end, Date.now()) };
        }
      }
      rebuild();
    } catch (e) {
      if (run === token)
        status.textContent = "Could not load range: " + e.message;
    }
  }
  function rebuild() {
    if (!snapshot || !view.dialog.open) return;
    const [start] = bounds();
    const end = snapshot.end;
    const key = [snapshot.key, options.source, options.scope].join("|");
    if (
      analysis?.key !== key ||
      analysis.config !== state.config ||
      analysis.data !== snapshot.data
    ) {
      const result = analyze(snapshot.data, state.config.projects, start, end, {
        host: state.host,
        manualAssignments: state.config.manualAssignments || [],
      });
      let segments = result.segments;
      if (options.source === "activities")
        segments = scopeSegments(
          result.segments,
          analyzeActivityTypes(
            snapshot.data,
            state.config.activityTypes || [],
            start,
            end,
          ).segments,
          options.scope,
        );
      analysis = { key, config: state.config, data: snapshot.data, segments };
    }
    const excluded = new Set(options.excluded);
    const selected = categories().filter((c) => !excluded.has(c.id));
    table = buildExport(
      {
        segments: analysis.segments,
        categories: selected,
        start,
        end: Math.max(start, end),
        startOfDay: startOfDay(),
      },
      options,
    );
    output = serializeExport(table);
    const [from, through] = dates();
    const lines = output.replace(BOM, "").split(/\r?\n/);
    pre.textContent =
      lines.slice(0, 200).join("\n") +
      (lines.length > 200 ? `\n… ${lines.length - 200} more lines` : "");
    status.textContent = !selected.length
      ? "Select at least one category."
      : `${from} – ${through} · ${table.rows.filter((r) => !r.summary).length} rows · total ${formatDuration(table.total, { unit: "hours", decimals: 2 })} h. Active time on this device only.`;
  }
  function open() {
    draw();
    show(view.dialog);
    snapshot = null; // the report or recordings may have changed since
    refresh();
  }
  return { open };
}

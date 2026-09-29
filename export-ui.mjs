import { analyze, loadRange } from "./projects-core.mjs";
import { analyzeActivityTypes } from "./activity-core.mjs";
import { localDate } from "./rule-engine.mjs";
import { pref, setPref } from "./ui-prefs.mjs";
import {
  BOM,
  BUILTIN_PRESETS,
  EXPORT_FILE,
  METRICS,
  RANGE_PRESETS,
  SPECIAL_TARGETS,
  buildExport,
  columnLabel,
  exportCategories,
  newColumn,
  normalizeSpec,
  serializeExport,
  specNeedsTypes,
} from "./export-core.mjs";

// Saved presets live in ActivityWatch settings (not the project config), so
// they follow the user across browsers without touching attribution.
const PRESETS_KEY = "project_tracker_export_presets";

export function setupExport({ state, api, dialog, show, download, notice }) {
  const view = dialog("report-dialog", "Reports & export");
  view.dialog.classList.add("export-dialog");
  let spec = normalizeSpec(pref("exportSpec"));
  let presetId = pref("exportPreset", "");
  let snapshot = null, // { key, data, end }
    analysis = null, // { key, config, data, projectSegments, typeSegments }
    token = 0,
    output = "",
    table = null,
    naming = false;
  const node = (tag, text, className) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (className) n.className = className;
    return n;
  };
  const button = (name, run, label) => {
    const b = node("button", name);
    b.type = "button";
    b.onclick = run;
    if (label) b.setAttribute("aria-label", label);
    return b;
  };
  const option = (value, text) => new Option(text, String(value));
  function select(label, pairs, value, change) {
    const s = node("select");
    s.setAttribute("aria-label", label);
    for (const [v, t] of pairs) s.append(option(v, t));
    s.value = String(value);
    s.onchange = () => change(s.value);
    return s;
  }
  // A control with a small caption above it.
  function field(caption, control) {
    const l = node("label", undefined, "export-field");
    l.append(node("span", caption), control);
    return l;
  }
  function check(caption, value, change) {
    const l = node("label", undefined, "check-label");
    const c = node("input");
    c.type = "checkbox";
    c.checked = value;
    c.onchange = () => change(c.checked);
    l.append(c, " " + caption);
    return l;
  }
  const same = (a, b) =>
    JSON.stringify(normalizeSpec(a)) === JSON.stringify(normalizeSpec(b));
  const saved = () =>
    (state.settings?.[PRESETS_KEY]?.presets || []).filter(
      (p) => p && typeof p.id === "string" && typeof p.name === "string",
    );
  const presets = () => [...BUILTIN_PRESETS, ...saved()];
  const current = () => presets().find((p) => p.id === presetId);
  function remember() {
    setPref("exportSpec", spec);
    setPref("exportPreset", presetId);
  }
  function update(patch, reload = false) {
    spec = normalizeSpec({ ...spec, ...patch });
    remember();
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
    const r = spec.range;
    if (r.preset === "custom") return [r.from, r.through];
    if (r.preset === "report")
      return [
        reportDay(state.start),
        reportDay(Math.min(state.end, Date.now()) - 1),
      ];
    const today = new Date(reportDay(Date.now()) + "T12:00:00");
    const first = new Date(today),
      last = new Date(today);
    if (r.preset === "last7") first.setDate(first.getDate() - 6);
    if (r.preset === "last30") first.setDate(first.getDate() - 29);
    if (r.preset.endsWith("week")) {
      first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
      if (r.preset === "last-week") first.setDate(first.getDate() - 7);
      last.setTime(+first);
      last.setDate(last.getDate() + 6);
    }
    if (r.preset.endsWith("month")) {
      first.setDate(1);
      if (r.preset === "last-month") first.setMonth(first.getMonth() - 1);
      last.setTime(+first);
      last.setMonth(last.getMonth() + 1, 0);
    }
    if (r.preset === "this-year") first.setMonth(0, 1);
    return [localDate(first), localDate(last)];
  }
  const categories = () => exportCategories(state.config);
  // Target choices, grouped; a missing (deleted) category stays visible.
  function targetSelect(label, value, change, { empty = "" } = {}) {
    const s = node("select");
    s.setAttribute("aria-label", label);
    if (empty) s.append(option("", empty));
    const general = document.createElement("optgroup");
    general.label = "General";
    if (spec.split !== "none")
      general.append(
        option("row", spec.split === "projects" ? "Row project" : "Row type"),
      );
    for (const [k, name] of SPECIAL_TARGETS) general.append(option(k, name));
    s.append(general);
    for (const [source, title] of [
      ["p", "Projects"],
      ["t", "Activity types"],
    ]) {
      const group = document.createElement("optgroup");
      group.label = title;
      for (const c of categories().filter((c) => c.source === source))
        group.append(option(c.key, c.name + (c.archived ? " (archived)" : "")));
      s.append(group);
    }
    if (![...s.options].some((o) => o.value === value))
      s.append(option(value, value === "row" ? "Row category" : "(deleted)"));
    s.value = value;
    s.onchange = () => change(s.value);
    return s;
  }

  const form = node("div", undefined, "export-form");
  const status = node("p", "", "muted export-status");
  status.setAttribute("role", "status");
  const pre = node("pre", "", "export-preview");
  pre.setAttribute("aria-label", "Export preview");
  const actions = node("div", undefined, "export-actions");
  actions.append(
    button("Download", () => {
      if (!table) return;
      const [ext, type] = EXPORT_FILE[spec.format];
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
  view.body.append(form, side);

  async function savePresets(change) {
    try {
      const latest = (await api("settings"))[PRESETS_KEY];
      const list = change(
        Array.isArray(latest?.presets) ? [...latest.presets] : [],
      );
      const value = { version: 1, presets: list };
      await api("settings/" + PRESETS_KEY, value);
      state.settings = { ...state.settings, [PRESETS_KEY]: value };
      return true;
    } catch (e) {
      notice("Could not save presets: " + e.message, "error");
      return false;
    }
  }
  function presetBar() {
    const bar = node("div", undefined, "export-line export-presets");
    const active = current();
    const modified = !active || !same(active.spec, spec);
    const s = node("select");
    s.setAttribute("aria-label", "Preset");
    if (!active) s.append(option("", "Custom (not saved)"));
    for (const [title, list] of [
      ["Built-in", BUILTIN_PRESETS],
      ["Saved", saved()],
    ]) {
      if (!list.length) continue;
      const group = document.createElement("optgroup");
      group.label = title;
      for (const p of list) group.append(option(p.id, p.name));
      s.append(group);
    }
    s.value = active ? active.id : "";
    s.onchange = () => {
      const p = presets().find((p) => p.id === s.value);
      if (!p) return;
      presetId = p.id;
      spec = normalizeSpec(p.spec);
      remember();
      draw();
      refresh();
    };
    bar.append(field("Preset", s));
    if (active && modified)
      bar.append(node("span", "modified", "export-badge"));
    if (naming) {
      const name = node("input");
      name.placeholder = "Preset name";
      name.setAttribute("aria-label", "Preset name");
      name.value = active && !active.builtin ? active.name + " copy" : "";
      const commit = async () => {
        const title = name.value.trim().slice(0, 80);
        if (!title) return name.focus();
        const id = "user:" + crypto.randomUUID();
        const entry = { id, name: title, spec };
        if (await savePresets((list) => [...list, entry])) {
          presetId = id;
          naming = false;
          remember();
          draw();
          notice(`Preset "${title}" saved.`, "success");
        }
      };
      name.onkeydown = (e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          naming = false;
          draw();
        }
      };
      bar.append(
        name,
        button("Save preset", commit),
        button("Cancel", () => {
          naming = false;
          draw();
        }),
      );
      queueMicrotask(() => name.focus());
      return bar;
    }
    if (active && !active.builtin) {
      const save = button("Save", async () => {
        if (
          await savePresets((list) =>
            list.map((p) => (p.id === active.id ? { ...p, spec } : p)),
          )
        ) {
          draw();
          notice(`Preset "${active.name}" updated.`, "success");
        }
      });
      save.disabled = !modified;
      bar.append(save);
    }
    bar.append(
      button("Save as…", () => {
        naming = true;
        draw();
      }),
    );
    if (active && !active.builtin) {
      const remove = button("Delete", async () => {
        if (remove.dataset.armed !== "1") {
          remove.dataset.armed = "1";
          remove.textContent = "Confirm delete";
          setTimeout(() => {
            remove.dataset.armed = "";
            remove.textContent = "Delete";
          }, 4000);
          return;
        }
        if (
          await savePresets((list) => list.filter((p) => p.id !== active.id))
        ) {
          presetId = "";
          remember();
          draw();
          notice(`Preset "${active.name}" deleted.`, "success");
        }
      });
      bar.append(remove);
    }
    return bar;
  }
  function line(title, ...children) {
    const row = node("div", undefined, "export-line");
    row.append(node("span", title, "export-line-title"), ...children);
    return row;
  }
  function splitPicker() {
    const picker = node("details", undefined, "export-picker");
    const options = categories().filter(
      (c) => c.source === (spec.split === "projects" ? "p" : "t"),
    );
    const excluded = new Set(spec.splitExcluded);
    const on = options.filter((c) => !excluded.has(c.key)).length;
    picker.append(node("summary", `Rows: ${on} of ${options.length}`));
    const list = node("div", undefined, "export-picker-list");
    const keys = options.map((c) => c.key);
    const bulk = node("div");
    bulk.append(
      button("All", () =>
        update({
          splitExcluded: spec.splitExcluded.filter((k) => !keys.includes(k)),
        }),
      ),
      button("None", () =>
        update({
          splitExcluded: [...new Set([...spec.splitExcluded, ...keys])],
        }),
      ),
    );
    list.append(bulk);
    for (const c of options)
      list.append(
        check(
          c.name + (c.archived ? " (archived)" : ""),
          !excluded.has(c.key),
          (value) => {
            const next = new Set(spec.splitExcluded);
            value ? next.delete(c.key) : next.add(c.key);
            spec = normalizeSpec({ ...spec, splitExcluded: [...next] });
            remember();
            picker.querySelector("summary").textContent =
              `Rows: ${options.filter((o) => !next.has(o.key)).length} of ${options.length}`;
            rebuild();
          },
        ),
      );
    picker.append(list);
    return picker;
  }
  function columnEditor() {
    const wrap = node("div", undefined, "export-columns");
    const head = node("div", undefined, "export-column export-column-head");
    for (const t of ["Column name", "Value", "Of", "Within", "Share of", ""])
      head.append(node("span", t));
    wrap.append(head);
    const cats = categories();
    const setColumn = (i, patch) => {
      const columns = spec.columns.map((c, k) =>
        k === i ? { ...c, ...patch } : c,
      );
      update({ columns });
    };
    spec.columns.forEach((c, i) => {
      const row = node("div", undefined, "export-column");
      const n = i + 1;
      const name = node("input");
      name.value = c.label;
      name.placeholder = columnLabel({ ...c, label: "" }, cats);
      name.setAttribute("aria-label", `Column ${n} name`);
      name.oninput = () => {
        spec = normalizeSpec({
          ...spec,
          columns: spec.columns.map((col, k) =>
            k === i ? { ...col, label: name.value } : col,
          ),
        });
        remember();
        rebuild();
      };
      const base = targetSelect(`Column ${n} share of`, c.base, (v) =>
        setColumn(i, { base: v }),
      );
      base.disabled = c.metric !== "share";
      const tools = node("div", undefined, "export-column-tools");
      const up = button(
        "↑",
        () => {
          const columns = [...spec.columns];
          [columns[i - 1], columns[i]] = [columns[i], columns[i - 1]];
          update({ columns });
        },
        `Move column ${n} up`,
      );
      up.disabled = i === 0;
      const remove = button(
        "×",
        () => update({ columns: spec.columns.filter((_, k) => k !== i) }),
        `Remove column ${n}`,
      );
      remove.disabled = spec.columns.length === 1;
      tools.append(up, remove);
      row.append(
        name,
        select(
          `Column ${n} value`,
          Object.entries(METRICS).map(([k, m]) => [k, m.label]),
          c.metric,
          (v) => setColumn(i, { metric: v }),
        ),
        targetSelect(`Column ${n} of`, c.target, (v) =>
          setColumn(i, { target: v }),
        ),
        targetSelect(
          `Column ${n} within`,
          c.within,
          (v) => setColumn(i, { within: v }),
          { empty: "Anywhere" },
        ),
        base,
        tools,
      );
      wrap.append(row);
    });
    const add = button("+ Add column", () =>
      update({
        columns: [
          ...spec.columns,
          newColumn({ target: spec.split === "none" ? "work" : "row" }),
        ],
      }),
    );
    add.disabled = spec.columns.length >= 30;
    wrap.append(add);
    return wrap;
  }
  function draw() {
    const [from, through] = dates();
    const fromInput = node("input"),
      throughInput = node("input");
    for (const [input, value, label] of [
      [fromInput, from, "From"],
      [throughInput, through, "Through"],
    ]) {
      input.type = "date";
      input.value = value || "";
      input.setAttribute("aria-label", "Export " + label.toLowerCase());
      input.onchange = () =>
        update(
          {
            range: {
              preset: "custom",
              from: fromInput.value,
              through: throughInput.value,
            },
          },
          true,
        );
    }
    const rows = [
      field(
        "Group by",
        select(
          "Group by",
          [
            ["day", "Day"],
            ["week", "Week"],
            ["month", "Month"],
            ["total", "Whole range"],
          ],
          spec.group,
          (v) => update({ group: v }),
        ),
      ),
      field(
        "Split rows by",
        select(
          "Split rows by",
          [
            ["none", "Nothing"],
            ["projects", "Project"],
            ["types", "Activity type"],
          ],
          spec.split,
          (v) => update({ split: v }),
        ),
      ),
    ];
    if (spec.split !== "none") rows.push(splitPicker());
    const rowChecks = node("div", undefined, "export-checks");
    if (spec.group !== "total")
      rowChecks.append(
        check("Date column", spec.dateColumn, (v) => update({ dateColumn: v })),
      );
    rowChecks.append(
      check("Empty rows", spec.emptyPeriods, (v) =>
        update({ emptyPeriods: v }),
      ),
      check("Total row", spec.totalRow, (v) => update({ totalRow: v })),
    );
    const values = [
      field(
        "Durations as",
        select(
          "Durations as",
          [
            ["hours", "Hours (1.50)"],
            ["minutes", "Minutes (90)"],
            ["seconds", "Seconds"],
            ["hm", "h:mm (1:30)"],
            ["hms", "h:mm:ss"],
          ],
          spec.unit,
          (v) => update({ unit: v }),
        ),
      ),
      field(
        "Decimals",
        select(
          "Decimals",
          [0, 1, 2, 3, 4].map((n) => [n, String(n)]),
          spec.decimals,
          (v) => update({ decimals: Number(v) }),
        ),
      ),
      field(
        "Separator",
        select(
          "Decimal separator",
          [
            [".", "1.5"],
            [",", "1,5"],
          ],
          spec.decimalSeparator,
          (v) => update({ decimalSeparator: v }),
        ),
      ),
      field(
        "Round to",
        select(
          "Round durations to",
          [
            [0, "Exact"],
            [1, "1 min"],
            [5, "5 min"],
            [6, "6 min (0.1 h)"],
            [10, "10 min"],
            [15, "15 min"],
            [30, "30 min"],
            [60, "1 hour"],
          ],
          spec.rounding,
          (v) => update({ rounding: Number(v) }),
        ),
      ),
      field(
        "Dates",
        select(
          "Date format",
          [
            ["iso", "2026-09-28"],
            ["dmy", "28.09.2026"],
            ["mdy", "09/28/2026"],
          ],
          spec.dateFormat,
          (v) => update({ dateFormat: v }),
        ),
      ),
    ];
    if (
      spec.columns.some((c) =>
        ["sessions", "longest", "average"].includes(c.metric),
      )
    )
      values.push(
        field(
          "Session ends after",
          select(
            "Session ends after",
            [0, 1, 2, 5, 10, 15, 30].map((n) => [
              n,
              n ? `${n} min away` : "Any switch",
            ]),
            spec.sessionGap,
            (v) => update({ sessionGap: Number(v) }),
          ),
        ),
      );
    const file = [
      field(
        "Format",
        select(
          "Format",
          [
            ["csv", "CSV"],
            ["tsv", "TSV (for pasting)"],
            ["md", "Markdown"],
            ["json", "JSON"],
          ],
          spec.format,
          (v) => update({ format: v }),
        ),
      ),
    ];
    if (spec.format === "csv")
      file.push(
        field(
          "Delimiter",
          select(
            "Delimiter",
            [
              [",", "Comma"],
              [";", "Semicolon"],
            ],
            spec.delimiter,
            (v) => update({ delimiter: v }),
          ),
        ),
      );
    if (["csv", "tsv"].includes(spec.format))
      file.push(check("Header row", spec.header, (v) => update({ header: v })));
    form.replaceChildren(
      presetBar(),
      line(
        "Period",
        field(
          "Range",
          select("Range", RANGE_PRESETS, spec.range.preset, (v) =>
            update({ range: { preset: v, from, through } }, true),
          ),
        ),
        field("From", fromInput),
        field("Through", throughInput),
      ),
      line("Rows", ...rows, rowChecks),
      line("Columns", columnEditor()),
      line("Values", ...values),
      line("File", ...file),
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
  // Fetches (or reuses) raw events for the range, then rebuilds the table.
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
    presetState();
    if (!snapshot || !view.dialog.open) return;
    const [start] = bounds();
    const end = Math.max(start, snapshot.end);
    if (
      analysis?.key !== snapshot.key ||
      analysis.config !== state.config ||
      analysis.data !== snapshot.data
    )
      analysis = {
        key: snapshot.key,
        config: state.config,
        data: snapshot.data,
        projectSegments: analyze(
          snapshot.data,
          state.config.projects,
          start,
          end,
          {
            host: state.host,
            manualAssignments: state.config.manualAssignments || [],
          },
        ).segments,
        typeSegments: null,
      };
    if (specNeedsTypes(spec) && !analysis.typeSegments)
      analysis.typeSegments = analyzeActivityTypes(
        snapshot.data,
        state.config.activityTypes || [],
        start,
        end,
      ).segments;
    table = buildExport(
      {
        projectSegments: analysis.projectSegments,
        typeSegments: analysis.typeSegments || [],
        categories: categories(),
        start,
        end,
        startOfDay: startOfDay(),
      },
      spec,
    );
    output = serializeExport(table);
    const [from, through] = dates();
    const lines = output.replace(BOM, "").split(/\r?\n/);
    pre.textContent =
      lines.slice(0, 300).join("\n") +
      (lines.length > 300 ? `\n… ${lines.length - 300} more lines` : "");
    const count = table.rows.filter((r) => !r.summary).length;
    status.textContent = `${from} – ${through} · ${count} row${count === 1 ? "" : "s"} · active time on this device`;
  }
  // Keeps the "modified" badge and Save button in step with typing.
  function presetState() {
    const bar = form.querySelector(".export-presets");
    if (!bar || naming) return;
    const active = current();
    const modified = !active || !same(active.spec, spec);
    const badge = bar.querySelector(".export-badge");
    if (active && modified && !badge)
      bar.firstChild.after(node("span", "modified", "export-badge"));
    if (!(active && modified) && badge) badge.remove();
    const save = [...bar.querySelectorAll("button")].find(
      (b) => b.textContent === "Save",
    );
    if (save) save.disabled = !modified;
  }
  function open() {
    naming = false;
    draw();
    show(view.dialog);
    snapshot = null; // the report or recordings may have changed since
    refresh();
  }
  return { open };
}

import { analyzeActivityTypes } from "./activity-core.mjs";
import { configFingerprint, readDays, writeDays } from "./day-cache.mjs";
import { analyze, discoverBrowsers, loadRange } from "./projects-core.mjs";
import { localDate, projectSpan, stable } from "./rule-engine.mjs";
import { pref, setPref, persistControl, restoredOption } from "./ui-prefs.mjs";
import {
  chartBuckets,
  daySummaries,
  reportDates,
  sliceData,
  workloadFromSummaries,
} from "./workload-core.mjs";
export function setupWorkload({ state, api, resizeFrame }) {
  const section = document.createElement("section");
  section.className = "timeline-panel workload-panel";
  section.id = "workload-panel";
  section.innerHTML =
    '<div class="section-heading"><div><p class="eyebrow">HISTORY</p><h2>Daily workload</h2><p class="muted">Hours per day over this chart’s own range, independent of the report period above. The report’s days are highlighted.</p></div><div class="workload-controls"><label>Project<select id="workload-project" aria-label="Workload project"></select></label><button id="workload-open" type="button" title="Show this chart’s range in the report above">Open this range in the report</button><button id="workload-load" type="button" title="Ignore the browser cache and recalculate the range from ActivityWatch">Recalculate</button></div></div><div class="workload-controls workload-range"><label>Range<select id="workload-range" aria-label="Workload range"><option value="week">Week</option><option value="month">Month</option><option value="last7">Last 7 days</option><option value="last30">Last 30 days</option><option value="project">Whole project</option><option value="custom">Custom</option></select></label><button id="workload-prev" aria-label="Previous chart period">←</button><button id="workload-next" aria-label="Next chart period">→</button><label>From<input id="workload-from" type="date" aria-label="Chart from"></label><label>Through<input id="workload-through" type="date" aria-label="Chart through"></label><button id="workload-apply">Apply range</button></div><p id="workload-status" class="muted" role="status">Loading the current week…</p><div class="workload-overlays"><label class="check-label"><input type="checkbox" id="workload-trend" checked> 7-day trend</label><label class="check-label"><input type="checkbox" id="workload-total" checked> All active time</label><label class="check-label"><input type="checkbox" id="workload-all" checked> All project work</label><label class="check-label"><input type="checkbox" id="workload-nonproject" checked> Non-project %</label><div id="workload-activities" class="activity-toggles" role="group" aria-label="Activity lines"></div><label>Daily target (hours)<input id="workload-target" value="8" type="number" min="0.25" max="24" step="0.25" placeholder="Not set" aria-label="Daily work target"></label></div><div id="workload-stats" class="workload-stats"></div><div id="workload-chart" class="workload-chart"></div><p class="field-help workload-hint">Click a day to open it in the report above; drag across days, or click one and Shift+click another, to open a range.</p><div id="workload-detail" class="workload-detail" role="status"></div><details class="panel-help"><summary>How this chart is calculated</summary><p class="field-help">Active time only. With All projects, layers stack project work, then non-project categories, then unclassified time (not assigned and needs review), so the top of the stack is all active time for the day. Project totals exclude unresolved conflicts. Days follow your ActivityWatch start-of-day setting. Non-project % = non-project time / all recorded active time, not a procrastination score. Target excess uses work across all projects. Days without recordings break the lines. The chart always fits the panel: when days get too narrow, each point becomes a week or a month, showing the average per recorded day (so the axis stays in hours per day). The trend averages recorded days within the last seven calendar days. Click a point to open that day (week, month) in the report above; drag across points, or click one and Shift+click another, to open the span as a custom range.</p></details>';
  document.getElementById("history").append(section);
  const $ = (id) => document.getElementById(id);
  let summaries = null, // day summaries of the shown days
    shown = null, // { host, from, through } of the shown days
    raw = null, // raw events in memory: { host, start, end, fetchedAt, data }
    key = null, // configuration the summaries were computed with
    host = null,
    busy = false,
    requestedHost = null,
    token = 0;
  const hours = (s) =>
    `${(s / 3600).toLocaleString(undefined, { maximumFractionDigits: 2 })} h`;
  const el = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  // Report day containing a timestamp, honouring the start-of-day setting.
  function reportDay(ms) {
    const [h, m] = (state.settings?.startOfDay || "04:00")
      .split(":")
      .map(Number);
    return localDate(new Date(ms - (h * 60 + m) * 60000));
  }
  function preset(mode, anchor = new Date()) {
    if (mode === "last7" || mode === "last30") {
      const last = new Date(reportDay(+anchor) + "T12:00:00"),
        first = new Date(last);
      first.setDate(first.getDate() - (mode === "last7" ? 6 : 29));
      $("workload-from").value = localDate(first);
      $("workload-through").value = localDate(last);
      return;
    }
    if (mode === "project") return; // resolved from data in load()
    const first = new Date(anchor);
    first.setHours(12, 0, 0, 0);
    if (mode === "week")
      first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    else first.setDate(1);
    const last = new Date(first);
    if (mode === "week") last.setDate(last.getDate() + 6);
    else {
      last.setMonth(last.getMonth() + 1);
      last.setDate(0);
    }
    $("workload-from").value = localDate(first);
    $("workload-through").value = localDate(last);
  }
  // Presets are remembered by name so rolling ranges recalculate from today;
  // custom ranges keep their dates.
  const savedRange = restoredOption(
    $("workload-range"),
    "workloadRange",
    "week",
  );
  $("workload-range").value = savedRange;
  $("workload-prev").disabled = $("workload-next").disabled =
    savedRange === "project";
  const savedDates = pref("workloadDates");
  if (savedRange === "custom" && Array.isArray(savedDates)) {
    $("workload-from").value = savedDates[0];
    $("workload-through").value = savedDates[1];
  } else preset(savedRange === "custom" ? "week" : savedRange);
  $("workload-range").addEventListener("change", () =>
    setPref("workloadRange", $("workload-range").value),
  );
  $("workload-range").onchange = () => {
    const mode = $("workload-range").value;
    $("workload-prev").disabled = $("workload-next").disabled =
      mode === "project";
    if (mode !== "custom") {
      preset($("workload-range").value);
      load();
    }
  };
  for (const id of ["workload-from", "workload-through"])
    $(id).onchange = () => {
      $("workload-range").value = "custom";
      setPref("workloadRange", "custom");
    };
  $("workload-apply").onclick = () => load();
  for (const [id, direction] of [
    ["workload-prev", -1],
    ["workload-next", 1],
  ])
    $(id).onclick = () => {
      const mode = $("workload-range").value;
      if (mode === "project") return;
      const first = new Date($("workload-from").value + "T12:00:00");
      if (mode === "month") first.setMonth(first.getMonth() + direction);
      else if (mode === "week") first.setDate(first.getDate() + 7 * direction);
      else {
        const last = new Date($("workload-through").value + "T12:00:00");
        const span = Math.round((last - first) / 86400000) + 1;
        if (!Number.isFinite(span) || span < 1) return;
        first.setDate(first.getDate() + span * direction);
        last.setDate(last.getDate() + span * direction);
        $("workload-from").value = localDate(first);
        $("workload-through").value = localDate(last);
        load();
        return;
      }
      preset(mode, first);
      load();
    };
  const hiddenTypes = new Set(pref("hiddenActivityLines", []));
  const chartCache = new WeakMap();
  // Drill down: show the clicked day in the main report above the chart.
  function openDay(date, unit = "day") {
    const period = document.getElementById("report-period");
    if (period && period.value !== unit) {
      period.value = unit;
      setPref("reportPeriod", unit);
    }
    const input = document.getElementById("date");
    input.value = date;
    input.dispatchEvent(new Event("change"));
    document
      .querySelector(".stats")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  // A selected span of days becomes the report's custom range.
  function openRange(from, through) {
    document.getElementById("report-period").value = "range";
    setPref("reportPeriod", "range");
    const last = document.getElementById("date-through");
    last.value = through;
    last.hidden = false;
    openDay(from, "range");
  }
  let anchor = null; // first point of a Shift+click range (its first date)
  // Redraw at the new width when the panel resizes (cached data, no reload).
  let drawnWidth = 0;
  new ResizeObserver(() => {
    const width = $("workload-chart").clientWidth;
    if (summaries && width && Math.abs(width - drawnWidth) > 4) chart();
  }).observe($("workload-chart"));
  let drawnReport = null;
  function chart() {
    drawnWidth = $("workload-chart").clientWidth;
    drawnReport = `${state.start}|${state.end}`;
    if (!summaries) return;
    const aggregate = $("workload-project").value === "";
    const project = aggregate
      ? { id: null, name: "All projects", color: "#65d6b4" }
      : state.config.projects.find((p) => p.id === $("workload-project").value);
    const activityTypes = (state.config.activityTypes || []).filter(
      (t) => !hiddenTypes.has(t.id),
    );
    if (!project) {
      $("workload-stats").replaceChildren();
      $("workload-chart").replaceChildren();
      $("workload-detail").textContent = "No projects to display.";
      return;
    }
    const target = Number($("workload-target").value) || null;
    let cached = chartCache.get(summaries);
    if (!cached) {
      cached = new Map();
      chartCache.set(summaries, cached);
    }
    const cacheKey = JSON.stringify([
      project.id,
      target,
      activityTypes.map((t) => t.id),
      state.config.projects.map((p) => [p.id, p.name, p.color, p.kind]),
    ]);
    if (!cached.has(cacheKey)) {
      if (cached.size >= 30) cached.clear();
      cached.set(
        cacheKey,
        workloadFromSummaries(summaries, state.config.projects, {
          projectId: project.id,
          target,
          types: activityTypes,
        }),
      );
    }
    const { summary, layers, stack, activities } = cached.get(cacheKey);
    $("workload-stats").replaceChildren();
    $("workload-chart").replaceChildren();
    $("workload-detail").textContent = "";
    const percent = (value) => (value === null ? "—" : `${value.toFixed(1)}%`);
    for (const [label, value] of [
      [aggregate ? "All project time" : "Project total", hours(summary.total)],
      [
        project.kind === "non-project"
          ? "Share of recorded time"
          : "Share of project work",
        (project.kind === "non-project" ? layers.tracked : layers.work)
          ? percent(
              (summary.total /
                (project.kind === "non-project"
                  ? layers.tracked
                  : layers.work)) *
                100,
            )
          : "—",
      ],
      [
        "Above daily target",
        layers.overtime === null ? "Set a target" : hours(layers.overtime),
      ],
      ["Classified time", percent(layers.coverage)],
    ]) {
      const card = el("div");
      card.append(el("span", label), el("strong", value));
      $("workload-stats").append(card);
    }
    if (!summary.days.length) {
      $("workload-detail").textContent =
        "No time attributed to this project in recorded history.";
      resizeFrame();
      return;
    }
    const trend = $("workload-trend").checked,
      all = $("workload-all").checked && !aggregate,
      totalLine = $("workload-total").checked,
      nonProject = $("workload-nonproject").checked;
    const ns = "http://www.w3.org/2000/svg",
      svg = document.createElementNS(ns, "svg");
    // Always the panel's width: long ranges become weekly or monthly averages.
    const W = $("workload-chart").clientWidth || 900,
      H = 330,
      L = 58,
      R = nonProject ? 58 : 24,
      T = 24,
      B = 46,
      PW = W - L - R,
      PH = H - T - B;
    const view = chartBuckets(layers.days, stack, PW),
      days = view.days,
      unit = view.unit,
      spacing = PW / Math.max(1, days.length - 1);
    const max = Math.max(
      1,
      Math.ceil(
        Math.max(
          target || 0,
          ...days.map(
            (d) =>
              Math.max(
                d.seconds,
                ...activities.map((t) => d[t.field]),
                all || target ? d.work : 0,
                totalLine || aggregate ? d.tracked : 0,
                trend ? d.trend || 0 : 0,
              ) / 3600,
          ),
        ) * 1.12,
      ),
    );
    const x = (i) =>
        L + (days.length === 1 ? PW / 2 : (i * PW) / (days.length - 1)),
      y = (s) => T + PH - (s / 3600 / max) * PH;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.width = "100%";
    svg.style.height = H + "px";
    svg.setAttribute("role", "group");
    svg.setAttribute(
      "aria-label",
      `${project.name}: daily workload lines, ${days[0].date} to ${days.at(-1).date}`,
    );
    const shape = (tag, attrs, text) => {
      const n = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      if (text !== undefined) n.textContent = text;
      svg.append(n);
      return n;
    };
    for (let i = 0; i <= 4; i++) {
      const yy = T + PH - (i * PH) / 4;
      shape("line", {
        x1: L,
        y1: yy,
        x2: W - R,
        y2: yy,
        stroke: "#34404b",
        "stroke-dasharray": "3 6",
      });
      shape(
        "text",
        {
          x: L - 10,
          y: yy + 4,
          "text-anchor": "end",
          fill: "#a7b5c4",
          "font-size": 12,
        },
        `${((max * i) / 4).toLocaleString(undefined, { maximumFractionDigits: 2 })} h`,
      );
      if (nonProject)
        shape(
          "text",
          { x: W - R + 10, y: yy + 4, fill: "#e6b56d", "font-size": 12 },
          `${i * 25}%`,
        );
    }
    // The report period's days, so it is clear what the panels above show.
    if (state.start && state.end) {
      const first = reportDay(state.start),
        last = reportDay(state.end - 1);
      const shown = days
        .map((d, i) => (d.to >= first && d.from <= last ? i : -1))
        .filter((i) => i >= 0);
      if (shown.length) {
        const left = (i) => (i === 0 ? L : (x(i - 1) + x(i)) / 2),
          right = (i) =>
            i === days.length - 1 ? W - R : (x(i) + x(i + 1)) / 2;
        const from = left(shown[0]),
          to = right(shown.at(-1));
        shape("rect", {
          x: from,
          y: T,
          width: to - from,
          height: PH,
          fill: "#d5e5f0",
          opacity: 0.1,
          "data-report-days": `${first}|${last}`,
        });
        // Above the plot, clear of the axis labels.
        shape(
          "text",
          {
            x: (from + to) / 2,
            y: T - 8,
            "text-anchor": "middle",
            fill: "#a7b5c4",
            "font-size": 11,
          },
          "Report",
        );
      }
    }
    const runs = [];
    let run = [];
    days.forEach((d, i) => {
      if (d.tracked) {
        run.push(i);
      } else if (run.length) {
        runs.push(run);
        run = [];
      }
    });
    if (run.length) runs.push(run);
    const line = (field, color, width, dash = "", pct = false) => {
      for (const indexes of runs) {
        const path = indexes
          .map(
            (i, k) =>
              `${k ? "L" : "M"} ${x(i)} ${pct ? T + PH - (days[i][field] / 100) * PH : y(days[i][field])}`,
          )
          .join(" ");
        shape("path", {
          d: path,
          fill: "none",
          stroke: color,
          "stroke-width": width,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          "stroke-dasharray": dash,
          "data-series": field,
        });
      }
    };
    // Straight segments retain measured day-to-day values; no decorative smoothing.
    if (aggregate) {
      for (const layer of view.stack)
        for (const indexes of runs) {
          const upper = indexes.map((i) => `${x(i)} ${y(layer.days[i].top)}`),
            lower = [...indexes]
              .reverse()
              .map((i) => `${x(i)} ${y(layer.days[i].bottom)}`);
          shape("path", {
            d: "M " + upper.join(" L ") + " L " + lower.join(" L ") + " Z",
            fill: layer.color,
            opacity: layer.extra ? 0.14 : 0.28,
            "data-stack": layer.id,
          });
          shape("path", {
            d: "M " + upper.join(" L "),
            fill: "none",
            stroke: layer.color,
            "stroke-width": layer.extra ? 1 : 1.5,
            "stroke-dasharray": layer.extra ? "4 3" : "",
          });
        }
    } else {
      for (const indexes of runs) {
        const points = indexes
          .map((i) => `${x(i)} ${y(days[i].seconds)}`)
          .join(" L ");
        shape("path", {
          d: `M ${x(indexes[0])} ${y(0)} L ${points} L ${x(indexes.at(-1))} ${y(0)} Z`,
          fill: project.color,
          opacity: 0.09,
        });
      }
    }
    if (target) {
      const yy = y(target * 3600);
      shape("line", {
        x1: L,
        y1: yy,
        x2: W - R,
        y2: yy,
        stroke: "#ec8b98",
        "stroke-dasharray": "6 6",
      });
      shape(
        "text",
        { x: L + 8, y: yy - 7, fill: "#ec8b98", "font-size": 12 },
        `Daily target · ${target} h`,
      );
      const clip = shape("clipPath", { id: "workload-above-target" });
      const clipRect = document.createElementNS(ns, "rect");
      for (const [attr, value] of Object.entries({
        x: L,
        y: T,
        width: PW,
        height: Math.max(0, yy - T),
      }))
        clipRect.setAttribute(attr, value);
      clip.append(clipRect);
      for (const indexes of runs)
        shape("path", {
          d:
            `M ${x(indexes[0])} ${y(0)} ` +
            indexes.map((i) => `L ${x(i)} ${y(days[i].work)}`).join(" ") +
            ` L ${x(indexes.at(-1))} ${y(0)} Z`,
          fill: "#ec8b98",
          opacity: 0.2,
          "clip-path": "url(#workload-above-target)",
        });
    }
    if (totalLine) line("tracked", "#cfd8e3", 1.5, "2 4");
    if (all) line("work", "#8495ad", 1.5);
    if (trend) line("trend", "#d6e2ee", 1.7, "5 5");
    line("seconds", project.color, 3);
    for (const activity of activities) {
      line(activity.field, activity.color, 2, "7 4");
      days.forEach((d, i) => {
        if (d.tracked && spacing >= 8)
          shape("circle", {
            cx: x(i),
            cy: y(d[activity.field]),
            r: 3,
            fill: activity.color,
            "data-activity": activity.id,
          });
      });
    }
    if (nonProject) line("nonProjectPercent", "#e6b56d", 2, "3 5", true);
    days.forEach((d, i) => {
      if (d.tracked && spacing >= 6)
        shape("circle", {
          cx: x(i),
          cy: y(d.seconds),
          r: spacing >= 14 ? 4 : 2.5,
          fill: project.color,
          stroke: "#16202a",
          "stroke-width": 2,
        });
    });
    const cursor = shape("line", {
      x1: L,
      y1: T,
      x2: L,
      y2: T + PH,
      stroke: "#d5e5f0",
      opacity: 0,
      "stroke-dasharray": "2 3",
    });
    const period = (d) => (unit === "day" ? d.date : `${d.from} – ${d.to}`);
    const describe = (d, i) => {
      cursor.setAttribute("x1", x(i));
      cursor.setAttribute("x2", x(i));
      cursor.setAttribute("opacity", 0.5);
      const detail = $("workload-detail");
      detail.replaceChildren();
      const metric = (text, color, style = "solid") => {
        const item = el("span", text);
        if (color) {
          item.style.color = color;
          item.style.setProperty("--legend-color", color);
          item.className = "detail-series " + style;
        }
        detail.append(item);
      };
      const value = (seconds) => (d.tracked ? hours(seconds) : "—");
      metric(
        unit === "day"
          ? d.date
          : `${d.from} – ${d.to} · average per recorded day (${d.recorded} of ${d.count} days)`,
      );
      if (!d.tracked) metric("No recorded active time — workload unknown.");
      if (totalLine)
        metric(`All active time: ${value(d.tracked)}`, "#cfd8e3", "dotted");
      metric(`${project.name}: ${value(d.seconds)}`, project.color);
      if (aggregate)
        for (const p of view.stack)
          metric(`${p.name}: ${value(p.days[i].seconds)}`, p.color);
      for (const activity of activities)
        metric(
          `${activity.name}: ${value(d[activity.field])} · ${aggregate ? "all active time" : "within project"}`,
          activity.color,
          "dashed",
        );
      if (trend)
        metric(
          `7-day trend: ${d.tracked && d.trend !== null ? hours(d.trend) : "—"}`,
          "#d6e2ee",
          "dashed",
        );
      if (all) metric(`All project work: ${value(d.work)}`, "#8495ad");
      if (nonProject)
        metric(
          `Non-project · right axis: ${d.tracked ? percent(d.nonProjectPercent) : "—"}`,
          "#e6b56d",
          "dotted",
        );
      if (target)
        metric(
          `Above target · all projects: ${value(d.overtime)}`,
          "#ec8b98",
          "area",
        );
      if (!aggregate) metric(`Unclassified: ${value(d.unclassified)}`);
    };
    // Range selection: drag across points, or click one and Shift+click
    // another. A single click opens that day (week, month) as before.
    const edges = (i) => [
      i === 0 ? L : (x(i - 1) + x(i)) / 2,
      i === days.length - 1 ? W - R : (x(i) + x(i + 1)) / 2,
    ];
    const band = shape("rect", {
      x: L,
      y: T,
      width: 0,
      height: PH,
      fill: "#65d6b4",
      opacity: 0,
      "pointer-events": "none",
      "data-selection": "",
    });
    const mark = (a, b) => {
      const [left] = edges(Math.min(a, b)),
        [, right] = edges(Math.max(a, b));
      band.setAttribute("x", left);
      band.setAttribute("width", right - left);
      band.setAttribute("opacity", 0.16);
    };
    const indexAt = (e) => {
      const box = svg.getBoundingClientRect();
      const px = ((e.clientX - box.left) * W) / box.width;
      const i = days.length === 1 ? 0 : Math.round((px - L) / spacing);
      return Math.max(0, Math.min(days.length - 1, i));
    };
    const open = (a, b) => {
      const lo = Math.min(a, b),
        hi = Math.max(a, b);
      if (lo === hi) openDay(days[lo].from, unit);
      else openRange(days[lo].from, days[hi].to);
    };
    let drag = null;
    svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const i = indexAt(e);
      const first = days.findIndex((d) => d.from === anchor);
      if (e.shiftKey && first >= 0) {
        e.preventDefault();
        mark(first, i);
        open(first, i);
        return;
      }
      drag = { from: i, to: i };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const i = indexAt(e);
      if (i === drag.to) return;
      drag.to = i;
      mark(drag.from, i);
      describe(days[i], i);
    });
    svg.addEventListener("pointerup", () => {
      if (!drag) return;
      const { from, to } = drag;
      drag = null;
      if (from === to) band.setAttribute("opacity", 0);
      anchor = days[from].from;
      open(from, to);
    });
    svg.addEventListener("pointercancel", () => {
      drag = null;
      band.setAttribute("opacity", 0);
    });
    days.forEach((d, i) => {
      const left = i === 0 ? L : (x(i - 1) + x(i)) / 2,
        right = i === days.length - 1 ? W - R : (x(i) + x(i + 1)) / 2;
      const hit = shape("rect", {
        x: left,
        y: T,
        width: right - left,
        height: PH,
        fill: "transparent",
        tabindex: 0,
        role: "button",
        "aria-label": `${period(d)}: ${hours(d.seconds)}${unit === "day" ? "" : " per recorded day"}. Open this ${unit} in the report`,
      });
      const tip = document.createElementNS(ns, "title");
      tip.textContent = `${period(d)} · click to open this ${unit} in the report · drag or Shift+click to select a range`;
      hit.append(tip);
      for (const event of ["pointerenter", "focus"])
        hit.addEventListener(event, () => describe(d, i));
      hit.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          const first = days.findIndex((p) => p.from === anchor);
          if (e.shiftKey && first >= 0) {
            mark(first, i);
            open(first, i);
          } else {
            anchor = d.from;
            openDay(d.from, unit);
          }
        }
      });
      // Regular labels plus the last day; skip a regular label that would
      // crowd the last one.
      const step = Math.max(
          1,
          Math.ceil(days.length / Math.max(2, Math.floor(PW / 70))),
        ),
        lastIndex = days.length - 1;
      if (
        i === lastIndex ||
        (i % step === 0 && (step === 1 || lastIndex - i >= step / 2))
      )
        shape(
          "text",
          {
            x: x(i),
            y: H - 16,
            "text-anchor": "middle",
            fill: "#a7b5c4",
            "font-size": 12,
          },
          unit === "month" ? d.date.slice(0, 7) : d.date.slice(5),
        );
    });
    if (unit !== "day")
      shape(
        "text",
        { x: L, y: 14, fill: "#a7b5c4", "font-size": 12 },
        `${unit === "week" ? "Weekly" : "Monthly"} averages per recorded day · ${days.length} ${unit}s`,
      );
    $("workload-chart").append(svg);
    describe(days.at(-1), days.length - 1);
    resizeFrame();
  }
  const startOfDay = () => state.settings.startOfDay || "04:00";
  const dayStart = (day) => +new Date(day + "T" + startOfDay() + ":00");
  const dayEnd = (day) => {
    const next = new Date(day + "T12:00:00");
    next.setDate(next.getDate() + 1);
    return dayStart(localDate(next));
  };
  // Days still being recorded are never cached (watchers may flush late).
  const complete = (date, fetchedAt) => dayEnd(date) <= fetchedAt - 300000;
  const configKey = () => stable({ config: state.config, host: state.host });
  // Day summaries of already loaded raw events, with the given configuration.
  function summarize(config, data, dates, fetchedAt) {
    const start = dayStart(dates[0]),
      end = Math.min(dayEnd(dates.at(-1)), fetchedAt);
    const result = analyze(data, config.projects, start, end, {
      host: state.host,
      manualAssignments: config.manualAssignments || [],
    });
    const types = analyzeActivityTypes(
      data,
      config.activityTypes || [],
      start,
      end,
    );
    return daySummaries(result, types, dates, startOfDay());
  }
  // Raw events for [start, end): the report's snapshot when it covers them.
  async function fetchRaw(device, start, end, force) {
    const report = state.dataRange;
    if (
      !force &&
      state.data &&
      report?.host === device &&
      report.start <= start &&
      report.requestedEnd >= end
    ) {
      // Let the report finish its own analysis/render first.
      await Promise.resolve();
      return { data: state.data, fetchedAt: report.end };
    }
    const loaded = await loadRange(api, state.buckets, device, start, end);
    return { data: loaded.data, fetchedAt: Math.min(end, Date.now()) };
  }
  // Summaries for the dates: cached days as they are, the span of missing
  // days computed from ActivityWatch (and cached when complete).
  async function summariesFor(device, dates, force, run) {
    const config = state.config;
    const fingerprint = await configFingerprint(config, device, startOfDay());
    const found = force
      ? new Map()
      : await readDays(device, fingerprint, dates);
    const missing = dates.filter((d) => !found.has(d));
    let fetched = null;
    if (missing.length) {
      const span = reportDates(missing[0], missing.at(-1));
      const start = dayStart(span[0]),
        end = dayEnd(span.at(-1));
      const { data, fetchedAt } = await fetchRaw(device, start, end, force);
      if (run !== token) return null;
      const computed = summarize(config, data, span, fetchedAt);
      writeDays(
        device,
        fingerprint,
        computed.filter((s) => complete(s.date, fetchedAt)),
      );
      for (const s of computed) found.set(s.date, s);
      fetched = { host: device, start, end, fetchedAt, data };
    }
    return {
      days: dates.map((d) => found.get(d)),
      key: stable({ config, host: device }),
      fetched,
    };
  }
  // Raw events are kept for recalculating after settings changes, but only
  // for short ranges: a long history would take hundreds of MB of memory.
  const RAW_DAYS = 62;
  function keepRaw(fetched, from, through) {
    if (!fetched || reportDates(from, through).length > RAW_DAYS) return null;
    const start = dayStart(from),
      end = dayEnd(through);
    if (fetched.start > start || fetched.end < end) return null;
    return {
      host: fetched.host,
      start,
      end,
      fetchedAt: fetched.fetchedAt,
      data: sliceData(fetched.data, start, end),
    };
  }
  const rawCovers = () =>
    raw &&
    shown &&
    raw.host === shown.host &&
    raw.start <= dayStart(shown.from) &&
    raw.end >= dayEnd(shown.through);
  // After drawing from cache: fetch the shown range's raw events quietly.
  async function prefetchRaw(run) {
    if (!shown || rawCovers()) return;
    if (reportDates(shown.from, shown.through).length > RAW_DAYS) return;
    const { host: device, from, through } = shown;
    try {
      const start = dayStart(from),
        end = dayEnd(through);
      const { data, fetchedAt } = await fetchRaw(device, start, end, false);
      if (run !== token) return;
      raw = { host: device, start, end, fetchedAt, data };
      if (configKey() !== key) scheduleCalculate();
    } catch {}
  }
  // Recalculate after settings changes: from raw events in memory when
  // possible, otherwise reload the shown range (cache first).
  function calculate() {
    if (!summaries || !shown) return;
    const nextKey = configKey();
    if (nextKey === key) return chart();
    if (!rawCovers()) return load({ keepRange: true });
    const config = state.config,
      dates = reportDates(shown.from, shown.through);
    summaries = summarize(config, raw.data, dates, raw.fetchedAt);
    key = nextKey;
    const done = summaries.filter((s) => complete(s.date, raw.fetchedAt));
    configFingerprint(config, shown.host, startOfDay()).then((fp) =>
      writeDays(shown.host, fp, done),
    );
    chart();
  }
  // Report days to scan for "Whole project": recorded history, narrowed to
  // when the selected project can receive time (its common and per-rule
  // dates, manual assignments). All projects scan the whole history.
  function projectScan() {
    // Window bucket creation marks the start of recorded history.
    // Imported history (scripts/import-manictime.mjs) predates the bucket.
    const created = Math.min(
      ...[
        state.buckets?.["aw-watcher-window_" + state.host]?.created,
        state.settings?.project_tracker_history_start?.[state.host],
      ]
        .map((t) => Date.parse(t))
        .filter(Number.isFinite),
    );
    let start = Number.isFinite(created) ? created : Date.now(),
      end = Date.now();
    const project = state.config.projects.find(
      (p) => p.id === $("workload-project").value,
    );
    if (project) {
      const span = projectSpan(project, state.config.manualAssignments || []);
      if (span.start < span.end) {
        start = Math.min(end, Math.max(start, span.start));
        end = Math.max(start, Math.min(end, span.end - 1));
      }
    }
    return [reportDay(start), reportDay(end)];
  }
  async function load({ force = false, keepRange = false } = {}) {
    if (!state.config) return;
    // keepRange: recalculate the shown days as they are ("Whole project" is
    // not rescanned after a settings change).
    const projectMode = !keepRange && $("workload-range").value === "project";
    let from = keepRange && shown ? shown.from : $("workload-from").value,
      through =
        keepRange && shown ? shown.through : $("workload-through").value;
    if (projectMode) [from, through] = projectScan();
    if ($("workload-range").value === "custom" && from && through)
      setPref("workloadDates", [from, through]);
    if (!from || !through || from > through) {
      $("workload-status").textContent =
        "Choose a valid range: From must be on or before Through.";
      return;
    }
    busy = true;
    const run = ++token;
    const device = state.host;
    requestedHost = device;
    $("workload-load").disabled = true;
    $("workload-status").textContent = projectMode
      ? "Scanning recorded history for the project span… Other panels remain available."
      : "Loading selected range… Other panels remain available.";
    try {
      const warnings = discoverBrowsers(state.buckets, device).warnings;
      const loaded = await summariesFor(
        device,
        reportDates(from, through),
        force,
        run,
      );
      if (!loaded || run !== token || device !== state.host) return;
      let days = loaded.days,
        status = `${from} – ${through} · selected range loaded.`;
      if (projectMode) {
        // First to last day with time in the project (or any category).
        const id = $("workload-project").value;
        const used = (d) =>
          id
            ? (d.projects[id] || 0) > 0
            : Object.entries(d.projects).some(
                ([k, v]) => v > 0 && k !== "unassigned" && k !== "conflict",
              );
        const first = days.findIndex(used);
        if (first >= 0) days = days.slice(first, days.findLastIndex(used) + 1);
        from = days[0].date;
        through = days.at(-1).date;
        $("workload-from").value = from;
        $("workload-through").value = through;
        status =
          first >= 0
            ? `${from} – ${through} · whole project, first to last recorded day.`
            : `No recorded time for this selection · showing all history, ${from} – ${through}.`;
      }
      summaries = days;
      shown = { host: device, from, through };
      host = device;
      key = loaded.key;
      raw =
        keepRaw(loaded.fetched, from, through) || (rawCovers() ? raw : null);
      $("workload-status").textContent = [status, ...warnings].join(" ");
      chart();
      $("workload-load").textContent = "Recalculate";
      if (key !== configKey()) scheduleCalculate();
      // Quietly after the page settles, so it never delays the first view.
      else if (!rawCovers()) setTimeout(() => prefetchRaw(run), 1500);
    } catch (e) {
      if (run === token)
        $("workload-status").textContent = "Could not load range: " + e.message;
    } finally {
      if (run === token) {
        busy = false;
        $("workload-load").disabled = false;
        resizeFrame();
      }
    }
  }
  for (const id of [
    "workload-trend",
    "workload-total",
    "workload-all",
    "workload-nonproject",
    "workload-target",
  ]) {
    persistControl($(id), id);
    $(id).oninput = () => {
      if ($("workload-target").validity.valid) chart();
    };
  }
  $("workload-load").onclick = () => load({ force: true });
  $("workload-open").onclick = () => {
    if (shown) openRange(shown.from, shown.through);
  };
  $("workload-project").onchange = () => {
    setPref("workloadProject", $("workload-project").value);
    // Summaries hold every category, so another project only redraws; a
    // project span is found again (from cache after the first scan).
    if ($("workload-range").value !== "project") return calculate();
    load();
  };
  function update() {
    const selected = $("workload-project").value;
    const projects = state.config.projects;
    const signature = projects
      .map((p) => [p.id, p.name, p.archived, p.kind].join(":"))
      .join("|");
    if (section.dataset.projects !== signature) {
      $("workload-project").replaceChildren(
        new Option("All projects", ""),
        ...projects.map(
          (p) => new Option(p.name + (p.archived ? " (archived)" : ""), p.id),
        ),
      );
      $("workload-project").value = restoredOption(
        $("workload-project"),
        "workloadProject",
        projects.some((p) => p.id === selected) ? selected : "",
      );
      section.dataset.projects = signature;
    }
    const typeSignature = JSON.stringify(
      (state.config.activityTypes || []).map((t) => [t.id, t.name, t.color]),
    );
    if (section.dataset.activityTypes !== typeSignature) {
      $("workload-activities").replaceChildren();
      for (const type of state.config.activityTypes || []) {
        const label = el("label");
        label.className = "check-label";
        const input = el("input");
        input.type = "checkbox";
        input.checked = !hiddenTypes.has(type.id);
        input.setAttribute("aria-label", `Show activity ${type.name}`);
        input.style.accentColor = type.color;
        input.onchange = () => {
          if (input.checked) hiddenTypes.delete(type.id);
          else hiddenTypes.add(type.id);
          setPref("hiddenActivityLines", [...hiddenTypes]);
          chart();
        };
        label.append(input, document.createTextNode(type.name));
        $("workload-activities").append(label);
      }
      section.dataset.activityTypes = typeSignature;
    }
    if (host && host !== state.host) {
      summaries = null;
      shown = null;
      raw = null;
      key = null;
      token++;
      $("workload-chart").replaceChildren();
      $("workload-stats").replaceChildren();
      $("workload-detail").textContent = "";
      $("workload-status").textContent = "Load history for this device.";
    }
    $("workload-load").disabled =
      busy || (!projects.length && !(state.config.activityTypes || []).length);
    if (requestedHost !== state.host) load();
    if (summaries && !busy && configKey() !== key) scheduleCalculate();
    // The report period moved: redraw its highlight (no recalculation).
    else if (summaries && drawnReport !== `${state.start}|${state.end}`)
      chart();
  }
  // Let the rest of the page update first; the chart follows a moment later.
  let pendingCalculation = false;
  function scheduleCalculate() {
    if (pendingCalculation) return;
    pendingCalculation = true;
    $("workload-detail").textContent = "Updating chart…";
    requestAnimationFrame(() =>
      setTimeout(() => {
        pendingCalculation = false;
        calculate();
      }, 0),
    );
  }
  return {
    update,
    // Main "Refresh": new days only; complete days come from the cache.
    reload: () => load(),
  };
}

import { analyzeActivityTypes, activitySegments } from "./activity-core.mjs";
import { analyze, discoverBrowsers } from "./projects-core.mjs";
import { stable } from "./rule-engine.mjs";
import {
  projectWorkload,
  workloadLayers,
  stackedWorkload,
} from "./workload-core.mjs";
export function setupWorkload({ state, api, resizeFrame }) {
  const section = document.createElement("section");
  section.className = "timeline-panel workload-panel";
  section.id = "workload-panel";
  section.innerHTML =
    '<div class="section-heading"><div><p class="eyebrow">PROJECT HISTORY</p><h2>Daily workload</h2><p class="muted">Hours per day · first to latest tracked day · current device</p></div><div class="workload-controls"><label>Project<select id="workload-project" aria-label="Workload project"></select></label><button id="workload-load" type="button">Load full history</button></div></div><p id="workload-status" class="muted" role="status">Load recorded history once to explore every project. This chart is independent of the report period above.</p><div class="workload-overlays"><label class="check-label"><input type="checkbox" id="workload-trend" checked> 7-day trend</label><label class="check-label"><input type="checkbox" id="workload-all" checked> All project work</label><label class="check-label"><input type="checkbox" id="workload-nonproject" checked> Non-project %</label><label>Activity overlay<select id="workload-activity" aria-label="Workload activity type"><option value="">No activity overlay</option></select></label><label>Daily target (hours)<input id="workload-target" value="8" type="number" min="0.25" max="24" step="0.25" placeholder="Not set" aria-label="Daily work target"></label></div><div id="workload-legend" class="workload-legend"></div><div id="workload-stats" class="workload-stats"></div><p id="workload-detail" class="workload-detail" role="status"></p><div id="workload-chart" class="workload-chart"></div><details class="panel-help"><summary>How this chart is calculated</summary><p class="field-help">Active time only. Unresolved conflicts are excluded. Days follow your ActivityWatch start-of-day setting. Non-project % = non-project time / all recorded active time, not a procrastination score. Target excess uses work across all projects. Days without recordings break the lines. The trend averages recorded days within the last seven calendar days.</p></details>';
  document.getElementById("projects").previousElementSibling.before(section);
  const $ = (id) => document.getElementById(id);
  let data = null,
    result = null,
    typeResult = null,
    key = null,
    host = null,
    busy = false,
    loadedAt = null,
    token = 0;
  const hours = (s) =>
    `${(s / 3600).toLocaleString(undefined, { maximumFractionDigits: 2 })} h`;
  const el = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const chartCache = new WeakMap();
  function chart() {
    if (!result) return;
    const aggregate = $("workload-project").value === "";
    const project = aggregate
      ? { id: null, name: "All projects", color: "#65d6b4" }
      : state.config.projects.find((p) => p.id === $("workload-project").value);
    const activityType = (state.config.activityTypes || []).find(
      (t) => t.id === $("workload-activity").value,
    );
    if (!project) {
      $("workload-stats").replaceChildren();
      $("workload-chart").replaceChildren();
      $("workload-detail").textContent = "No projects to display.";
      return;
    }
    const target = Number($("workload-target").value) || null;
    let cached = chartCache.get(result);
    if (!cached) {
      cached = new Map();
      chartCache.set(result, cached);
    }
    const cacheKey = JSON.stringify([
      project.id,
      state.settings.startOfDay,
      target,
      activityType?.id,
    ]);
    if (!cached.has(cacheKey)) {
      const summary = projectWorkload(
        result,
        project.id,
        state.settings.startOfDay || "04:00",
      );
      if (cached.size >= 30) cached.clear();
      cached.set(cacheKey, {
        summary,
        stack: aggregate
          ? stackedWorkload(
              result,
              summary,
              state.settings.startOfDay || "04:00",
            )
          : [],
        activity: activityType
          ? new Map(
              projectWorkload(
                {
                  segments: activitySegments(
                    result,
                    typeResult,
                    activityType.id,
                    project.id,
                  ),
                },
                activityType.id,
                state.settings.startOfDay || "04:00",
              ).days.map((d) => [d.date, d.seconds]),
            )
          : new Map(),
        layers: workloadLayers(
          result,
          summary,
          state.settings.startOfDay || "04:00",
          target,
        ),
      });
    }
    const { summary, layers, stack, activity } = cached.get(cacheKey);
    for (const d of layers.days) d.activitySeconds = activity.get(d.date) || 0;
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
    $("workload-legend").replaceChildren();
    if (!summary.days.length) {
      $("workload-detail").textContent =
        "No time attributed to this project in recorded history.";
      resizeFrame();
      return;
    }
    const trend = $("workload-trend").checked,
      all = $("workload-all").checked && !aggregate,
      nonProject = $("workload-nonproject").checked;
    for (const [name, color, dashed] of [
      ...(aggregate
        ? stack.map((p) => [p.name, p.color, false])
        : [[project.name, project.color, false]]),
      ...(activityType
        ? [
            [
              activityType.name +
                (aggregate ? " · all active time" : " · within project"),
              "#d6a3ee",
              true,
            ],
          ]
        : []),
      ...(trend ? [["7-day trend", "#d6e2ee", true]] : []),
      ...(all ? [["All project work", "#8495ad", false]] : []),
      ...(nonProject ? [["Non-project % · right axis", "#e6b56d", true]] : []),
      ...(target ? [["Above target · all projects", "#ec8b98", false]] : []),
    ]) {
      const item = el("span", name);
      item.style.setProperty("--legend-color", color);
      item.className = dashed ? "dashed" : "";
      $("workload-legend").append(item);
    }
    const days = layers.days,
      ns = "http://www.w3.org/2000/svg",
      svg = document.createElementNS(ns, "svg");
    const W = Math.max(900, days.length * 14 + 110),
      H = 330,
      L = 58,
      R = nonProject ? 58 : 24,
      T = 24,
      B = 46,
      PW = W - L - R,
      PH = H - T - B;
    const max = Math.max(
      1,
      Math.ceil(
        Math.max(
          target || 0,
          ...days.map(
            (d) =>
              Math.max(
                d.seconds,
                activityType ? d.activitySeconds : 0,
                all || target ? d.work : 0,
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
    svg.style.minWidth = W + "px";
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
      for (const layer of stack)
        for (const indexes of runs) {
          const upper = indexes.map((i) => `${x(i)} ${y(layer.days[i].top)}`),
            lower = [...indexes]
              .reverse()
              .map((i) => `${x(i)} ${y(layer.days[i].bottom)}`);
          shape("path", {
            d: "M " + upper.join(" L ") + " L " + lower.join(" L ") + " Z",
            fill: layer.color,
            opacity: 0.28,
            "data-stack": layer.id,
          });
          shape("path", {
            d: "M " + upper.join(" L "),
            fill: "none",
            stroke: layer.color,
            "stroke-width": 1.5,
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
    if (all) line("work", "#8495ad", 1.5);
    if (trend) line("trend", "#d6e2ee", 1.7, "5 5");
    line("seconds", project.color, 3);
    if (activityType) line("activitySeconds", "#d6a3ee", 2, "7 4");
    if (nonProject) line("nonProjectPercent", "#e6b56d", 2, "3 5", true);
    days.forEach((d, i) => {
      if (d.tracked)
        shape("circle", {
          cx: x(i),
          cy: y(d.seconds),
          r: days.length < 90 ? 4 : 2.5,
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
    const describe = (d, i) => {
      cursor.setAttribute("x1", x(i));
      cursor.setAttribute("x2", x(i));
      cursor.setAttribute("opacity", 0.5);
      $("workload-detail").textContent = d.tracked
        ? `${d.date} · ${project.name}: ${hours(d.seconds)} · all project work: ${hours(d.work)} · non-project: ${percent(d.nonProjectPercent)} · unclassified: ${hours(d.unclassified)}${target ? " · above target: " + hours(d.overtime) : ""}`
        : `${d.date} · No recorded active time — workload unknown.`;
      if (d.tracked && aggregate)
        $("workload-detail").textContent +=
          " · " +
          stack
            .filter((p) => p.days[i].seconds > 0)
            .map((p) => `${p.name}: ${hours(p.days[i].seconds)}`)
            .join(" · ");
      if (d.tracked && activityType)
        $("workload-detail").textContent +=
          ` · ${activityType.name}: ${hours(d.activitySeconds)} (overlay, not additional time)`;
    };
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
        "aria-label": `${d.date}: ${hours(d.seconds)}`,
      });
      for (const event of ["pointerenter", "focus", "click"])
        hit.addEventListener(event, () => describe(d, i));
      if (
        i % Math.max(1, Math.ceil(days.length / 9)) === 0 ||
        i === days.length - 1
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
          d.date.slice(5),
        );
    });
    $("workload-chart").append(svg);
    describe(days.at(-1), days.length - 1);
    resizeFrame();
  }
  function calculate() {
    if (!data) return;
    const nextKey = stable({ config: state.config, host: state.host });
    if (nextKey !== key) {
      result = analyze(data, state.config.projects, 0, loadedAt, {
        host: state.host,
        manualAssignments: state.config.manualAssignments || [],
      });
      typeResult = analyzeActivityTypes(
        data,
        state.config.activityTypes || [],
        0,
        loadedAt,
      );
      key = nextKey;
    }
    chart();
  }
  async function load() {
    if (busy || !state.config) return;
    busy = true;
    const run = ++token;
    const device = state.host;
    $("workload-load").disabled = true;
    $("workload-status").textContent =
      "Loading recorded history… Other panels remain available.";
    try {
      const { sources, warnings } = discoverBrowsers(state.buckets, device);
      const ids = {
        windows: "aw-watcher-window_" + device,
        afk: "aw-watcher-afk_" + device,
      };
      const query = Object.entries(ids).map(
        ([k, id]) => `${k} = flood(query_bucket(${JSON.stringify(id)}));`,
      );
      sources.forEach((s, i) =>
        query.push(`web${i} = flood(query_bucket(${JSON.stringify(s.id)}));`),
      );
      query.push(
        'RETURN = {"windows": windows, "afk": afk' +
          sources.map((s, i) => `, "web${i}": web${i}`).join("") +
          "};",
      );
      const end = Date.now();
      const raw = (
        await api("query/", {
          timeperiods: [
            new Date(0).toISOString() + "/" + new Date(end).toISOString(),
          ],
          query,
        })
      )[0];
      if (run !== token || device !== state.host) return;
      data = {
        windows: raw.windows,
        afk: raw.afk,
        browsers: sources.map((s, i) => ({ ...s, events: raw["web" + i] })),
      };
      host = device;
      loadedAt = end;
      key = null;
      calculate();
      $("workload-status").textContent =
        `Full recorded history · updated ${new Date(end).toLocaleString()}. Includes archived projects and manual assignments. ${warnings.join(" ")}`;
      $("workload-load").textContent = "Refresh history";
    } catch (e) {
      $("workload-status").textContent = "Could not load history: " + e.message;
    } finally {
      busy = false;
      $("workload-load").disabled = false;
      resizeFrame();
    }
  }
  for (const id of [
    "workload-trend",
    "workload-all",
    "workload-nonproject",
    "workload-target",
    "workload-activity",
  ])
    $(id).oninput = () => {
      if ($("workload-target").validity.valid) chart();
    };
  $("workload-load").onclick = load;
  $("workload-project").onchange = () => calculate();
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
      if (projects.some((p) => p.id === selected))
        $("workload-project").value = selected;
      section.dataset.projects = signature;
    }
    const selectedType = $("workload-activity").value;
    const typeSignature = JSON.stringify(
      (state.config.activityTypes || []).map((t) => [t.id, t.name]),
    );
    if (section.dataset.activityTypes !== typeSignature) {
      $("workload-activity").replaceChildren(
        new Option("No activity overlay", ""),
        ...(state.config.activityTypes || []).map(
          (t) => new Option(t.name, t.id),
        ),
      );
      if ((state.config.activityTypes || []).some((t) => t.id === selectedType))
        $("workload-activity").value = selectedType;
      section.dataset.activityTypes = typeSignature;
    }
    if (host && host !== state.host) {
      data = null;
      result = null;
      key = null;
      token++;
      $("workload-chart").replaceChildren();
      $("workload-stats").replaceChildren();
      $("workload-detail").textContent = "";
      $("workload-status").textContent = "Load history for this device.";
    }
    $("workload-load").disabled = busy || !projects.length;
    if (data && stable({ config: state.config, host: state.host }) !== key)
      calculate();
  }
  return { update };
}

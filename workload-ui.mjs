import { analyze, discoverBrowsers } from "./projects-core.mjs";
import { stable } from "./rule-engine.mjs";
import { projectWorkload } from "./workload-core.mjs";
export function setupWorkload({ state, api, resizeFrame }) {
  const section = document.createElement("section");
  section.className = "timeline-panel workload-panel";
  section.id = "workload-panel";
  section.innerHTML =
    '<div class="section-heading"><div><p class="eyebrow">PROJECT HISTORY</p><h2>Daily workload</h2><p class="muted">Hours per day · first to latest tracked day · current device</p></div><div class="workload-controls"><label>Project<select id="workload-project" aria-label="Workload project"></select></label><button id="workload-load" type="button">Load full history</button></div></div><p id="workload-status" class="muted" role="status">Load recorded history once to explore every project. This chart is independent of the report period above.</p><div id="workload-stats" class="workload-stats"></div><p id="workload-detail" class="workload-detail" role="status"></p><div id="workload-chart" class="workload-chart"></div><p class="field-help">Active time only. Unresolved conflicts are excluded. Days follow your ActivityWatch start-of-day setting. Zero-height days have no attributed time; they may also contain gaps in recording.</p>';
  document.getElementById("projects").previousElementSibling.before(section);
  const $ = (id) => document.getElementById(id);
  let data = null,
    result = null,
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
  function chart() {
    if (!result) return;
    const project = state.config.projects.find(
      (p) => p.id === $("workload-project").value,
    );
    if (!project) {
      $("workload-stats").replaceChildren();
      $("workload-chart").replaceChildren();
      $("workload-detail").textContent = "No projects to display.";
      return;
    }
    const summary = projectWorkload(
      result,
      project.id,
      state.settings.startOfDay || "04:00",
    );
    $("workload-stats").replaceChildren();
    $("workload-chart").replaceChildren();
    $("workload-detail").textContent = "";
    for (const [label, value] of [
      ["Total time", hours(summary.total)],
      ["Active days", String(summary.activeDays)],
      ["Average / active day", hours(summary.average)],
      [
        "Busiest day",
        summary.busiest
          ? `${hours(summary.busiest.seconds)} · ${summary.busiest.date}`
          : "—",
      ],
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
    const ns = "http://www.w3.org/2000/svg",
      svg = document.createElementNS(ns, "svg");
    const W = Math.max(900, summary.days.length * 12 + 80),
      H = 280,
      L = 58,
      R = 20,
      T = 28,
      B = 48,
      plotW = W - L - R,
      plotH = H - T - B,
      max = Math.max(
        1,
        Math.ceil(Math.max(...summary.days.map((d) => d.seconds)) / 3600),
      ),
      step = plotW / summary.days.length;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.minWidth = W + "px";
    svg.setAttribute("role", "group");
    svg.setAttribute(
      "aria-label",
      `${project.name}: daily tracked hours from ${summary.days[0].date} to ${summary.days.at(-1).date}`,
    );
    const shape = (tag, attrs, text) => {
      const n = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      if (text !== undefined) n.textContent = text;
      svg.append(n);
      return n;
    };
    for (let i = 0; i <= 4; i++) {
      const y = T + plotH - (i * plotH) / 4;
      shape("line", {
        x1: L,
        y1: y,
        x2: W - R,
        y2: y,
        stroke: "#34404b",
        "stroke-dasharray": "3 5",
      });
      shape(
        "text",
        {
          x: L - 10,
          y: y + 4,
          "text-anchor": "end",
          fill: "#a7b5c4",
          "font-size": 12,
        },
        `${((max * i) / 4).toLocaleString(undefined, { maximumFractionDigits: 2 })} h`,
      );
    }
    const describe = (d) => {
      $("workload-detail").textContent =
        `${d.date} · ${hours(d.seconds)} tracked${d === summary.busiest ? " · busiest day" : ""}`;
    };
    for (let i = 0; i < summary.days.length; i++) {
      const d = summary.days[i],
        height = (d.seconds / 3600 / max) * plotH,
        x = L + i * step,
        width = Math.max(1, step * 0.68);
      shape("rect", {
        x: x + (step - width) / 2,
        y: T + plotH - height,
        width,
        height,
        rx: Math.min(4, width / 3),
        fill: project.color,
        opacity: d === summary.busiest ? 1 : 0.78,
      });
      const hit = shape("rect", {
        x,
        y: T,
        width: step,
        height: plotH,
        fill: "transparent",
        tabindex: 0,
        role: "button",
        "aria-label": `${d.date}: ${hours(d.seconds)}`,
      });
      hit.addEventListener("pointerenter", () => describe(d));
      hit.addEventListener("focus", () => describe(d));
      hit.addEventListener("click", () => describe(d));
      const title = document.createElementNS(ns, "title");
      title.textContent = `${d.date}: ${hours(d.seconds)}`;
      hit.append(title);
      const every = Math.max(1, Math.ceil(summary.days.length / 10));
      if (i % every === 0 || i === summary.days.length - 1)
        shape(
          "text",
          {
            x: x + step / 2,
            y: H - 17,
            "text-anchor": "middle",
            fill: "#a7b5c4",
            "font-size": 12,
          },
          d.date.slice(5),
        );
    }
    $("workload-chart").append(svg);
    describe(summary.days.at(-1));
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
        ...projects.map(
          (p) => new Option(p.name + (p.archived ? " (archived)" : ""), p.id),
        ),
      );
      if (projects.some((p) => p.id === selected))
        $("workload-project").value = selected;
      section.dataset.projects = signature;
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

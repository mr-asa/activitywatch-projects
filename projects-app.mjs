import { lockScrollBehindDialogs, openModal } from "./dialogs.mjs";
import { setupActivities } from "./activity-ui.mjs";
import { setupWorkload } from "./workload-ui.mjs";
import { setupWorkflow } from "./workflow-ui.mjs";
import { reportBounds, revisionHistory } from "./workflow-core.mjs";
import { projectRules, stable, localDate } from "./rule-engine.mjs";
import { setupRuleEditor } from "./compact-rule-editor.mjs";
import { setupManual } from "./manual-ui.mjs";
import { renderTimeCharts } from "./time-charts.mjs";
import { setupUnassigned } from "./unassigned-ui.mjs";
import {
  PALETTE,
  normalizeProject,
  analyze,
  discoverBrowsers,
  loadEditors,
} from "./projects-core.mjs";
const KEY = "project_tracker";
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const state = {
  config: null,
  settings: null,
  info: null,
  buckets: null,
  data: null,
  result: null,
  start: 0,
  end: 0,
  editId: null,
  busy: false,
  saving: false,
  ownDate: false,
  sourceWarnings: [],
};
const fmt = (s) => {
  s = Math.round(s);
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};
const precise = (s) => `${fmt(s)} ${Math.round(s) % 60}s`;
const timelineTime = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});
function notice(message, type = "") {
  $("notice").textContent = message;
  $("notice").className = "notice " + type;
  $("notice").hidden = !message;
}
function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}
// Only the keys the dashboard uses: all settings include the configuration
// history (megabytes) and would be transferred on every refresh.
const SETTINGS_KEYS = [
  "startOfDay",
  KEY,
  "project_tracker_export_presets",
  "project_tracker_history_start",
];
async function readSettings(keys) {
  const values = await Promise.all(keys.map((k) => api("settings/" + k)));
  return Object.fromEntries(keys.map((k, i) => [k, values[i] ?? undefined]));
}
async function api(path, body) {
  const started = performance.now();
  const response = await fetch("/api/0/" + path, {
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok)
    throw Error(
      `ActivityWatch request failed (${response.status}). Please try again.`,
    );
  const result = await response.json();
  timing(`api:${path}`, started);
  return result;
}
// Keep only the latest measurement for each stage; never include event data.
function timing(stage, start) {
  const name = `projects:${stage}`;
  performance.clearMeasures(name);
  performance.measure(name, { start, end: performance.now() });
}
function resizeFrame() {
  if (window.frameElement) {
    const f = window.frameElement;
    f.style.width = "100%";
    f.style.scrollMarginTop = "76px";
    f.style.height =
      Math.max(
        760,
        document.querySelector("main").getBoundingClientRect().height + 12,
      ) + "px";
    const col = f.closest(".col-md-6");
    if (col) {
      col.classList.remove("col-md-6", "col-lg-4");
      col.classList.add("col-md-12", "col-lg-12");
    }
  }
}
function todayDate() {
  const d = new Date();
  const [h, m] = (state.settings?.startOfDay || "04:00").split(":").map(Number);
  if (d.getHours() * 60 + d.getMinutes() < h * 60 + m)
    d.setDate(d.getDate() - 1);
  return localDate(d);
}
function period() {
  const [h, m] = (state.settings.startOfDay || "04:00").split(":").map(Number);
  let start, end;
  if (!state.ownDate && params.has("start") && params.has("end")) {
    start = new Date(params.get("start"));
    end = new Date(params.get("end"));
  } else {
    const mode = $("report-period")?.value || "day";
    // A range never ends before it starts.
    if (mode === "range" && !($("date-through").value >= $("date").value))
      $("date-through").value = $("date").value;
    const bounds = reportBounds(
      $("date").value,
      mode,
      state.settings.startOfDay || "04:00",
      $("date-through").value,
    );
    start = new Date(bounds[0]);
    end = new Date(bounds[1]);
  }
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || end <= start)
    throw Error("Select a valid report date.");
  state.start = +start;
  state.end = +end;
  $("range-label").textContent =
    `${start.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} – ${end.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  $("period-label").textContent =
    "Day starts at " + (state.settings.startOfDay || "04:00");
  const link = new URL(location.href);
  link.searchParams.set("start", start.toISOString());
  link.searchParams.set("end", end.toISOString());
  $("full-page").href = link.href;
  return [
    start.toISOString(),
    new Date(Math.min(+end, Date.now())).toISOString(),
  ];
}
let reloadPending = false,
  loaded = null;
async function load({ auto = false } = {}) {
  if (state.busy || state.saving) {
    // Navigation during a load must not be dropped; run once more afterwards.
    if (!auto) reloadPending = true;
    return;
  }
  state.busy = true;
  $("refresh").disabled = true;
  try {
    const [settings, info, buckets] = await Promise.all([
      readSettings(SETTINGS_KEYS),
      api("info"),
      api("buckets"),
    ]);
    state.settings = settings;
    state.info = info;
    state.buckets = buckets;
    if (!state.config) state.config = settings[KEY];
    else if (
      settings[KEY]?.revision !== state.config.revision &&
      !document.querySelector("dialog[open]")
    ) {
      state.config = settings[KEY];
    }
    if (!state.config)
      state.config = { version: 1, projects: [], manualAssignments: [] };
    if (state.config.version !== 1)
      throw Error("Project settings could not be loaded. Reload the page.");
    if (!$("date").value)
      $("date").value = params.has("start")
        ? localDate(new Date(params.get("start")))
        : todayDate();
    const [start, end] = period(),
      host = params.get("hostname") || info.hostname;
    state.host = host;
    const ids = {
      windows: "aw-watcher-window_" + host,
      afk: "aw-watcher-afk_" + host,
    };
    for (const id of Object.values(ids))
      if (!buckets[id])
        throw Error("Window or idle tracking is unavailable for this device.");
    const { sources, warnings } = discoverBrowsers(buckets, host);
    state.sourceWarnings = warnings;
    if (!sources.length)
      warnings.push(
        "No browser extension data found. Title rules still work; URL rules need the ActivityWatch browser extension.",
      );
    $("sources").textContent =
      `Window + idle tracking · ${sources.length} browser source${sources.length === 1 ? "" : "s"} connected`;
    const signature = [start, state.end, host, sources.map((s) => s.id)].join(
      "|",
    );
    // A period that had already ended when it was fetched cannot gain events.
    if (auto && loaded?.signature === signature && loaded.at >= state.end) {
      $("sources").textContent +=
        ` · ${state.data.editors.filter((s) => !s.unavailable).length} editor sources`;
      render();
      $("updated").textContent =
        "Updated " +
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
      return;
    }
    const fetchedAt = Date.now();
    const editors = loadEditors(api, buckets, host, start, end);
    if (Date.parse(end) <= Date.parse(start)) {
      state.data = { windows: [], afk: [], browsers: [] };
    } else {
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
      const raw = (
        await api("query/", { timeperiods: [start + "/" + end], query })
      )[0];
      state.data = {
        windows: raw.windows,
        afk: raw.afk,
        browsers: sources.map((s, i) => ({ ...s, events: raw["web" + i] })),
      };
    }
    state.data.editors = await editors;
    state.dataRange = {
      start: Date.parse(start),
      end: Date.parse(end),
      requestedEnd: state.end,
      host,
    };
    loaded = { signature, at: fetchedAt };
    $("sources").textContent +=
      ` · ${state.data.editors.filter((s) => !s.unavailable).length} editor sources`;
    render();
    $("add-project").disabled = false;
    if (warnings.length) notice(warnings.join(" "));
    else if ($("notice").classList.contains("error")) notice("");
    $("updated").textContent =
      "Updated " +
      new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (error) {
    notice(error.message, "error");
    $("updated").textContent = "Could not refresh";
  } finally {
    state.busy = false;
    $("refresh").disabled = false;
    resizeFrame();
    if (reloadPending) {
      reloadPending = false;
      load();
    }
  }
}
let analysisCache = null;
function render() {
  if (!state.data || !state.config) return;
  const renderStarted = performance.now();
  if (
    !analysisCache ||
    analysisCache.data !== state.data ||
    analysisCache.config !== state.config ||
    analysisCache.start !== state.start ||
    analysisCache.end !== state.end ||
    analysisCache.host !== state.host
  ) {
    state.resultEnd = Math.min(state.end, state.dataRange?.end ?? Date.now());
    const analysisStarted = performance.now();
    const result = analyze(
      state.data,
      state.config.projects,
      state.start,
      state.resultEnd,
      {
        host: state.host,
        manualAssignments: state.config.manualAssignments || [],
      },
    );
    analysisCache = {
      data: state.data,
      config: state.config,
      start: state.start,
      end: state.end,
      host: state.host,
      result,
    };
    timing("analysis", analysisStarted);
  }
  const result = analysisCache.result;
  state.result = result;
  for (const [id, value] of [
    ["assigned", result.assigned],
    ["unassigned", result.unassigned],
    ["conflicts", result.conflict],
  ]) {
    $(id).textContent = fmt(value);
    $(id).title =
      precise(value) +
      (id === "conflicts"
        ? " · Matches two or more categories; excluded from their totals until resolved."
        : "");
  }
  const visibleProjects = result.projects.filter(
    (p) => !p.archived || $("show-archived")?.checked,
  );
  $("project-count").textContent = visibleProjects.length;
  $("projects").replaceChildren();
  for (const p of visibleProjects) {
    const card = node("article", "project-card");
    card.style.setProperty("--project-color", p.color);
    card.dataset.projectId = p.id;
    const head = node("div", "card-heading");
    head.append(node("h3", "", p.name));
    const edit = node("button", "edit", "Edit");
    edit.setAttribute("aria-label", "Edit " + p.name);
    edit.onclick = () => openEditor(p.id);
    head.append(edit);
    card.append(head);
    if (p.kind === "non-project" || p.archived)
      card.append(
        node(
          "p",
          "muted",
          [
            p.kind === "non-project" ? "Non-project" : "",
            p.archived ? "Archived" : "",
          ]
            .filter(Boolean)
            .join(" · "),
        ),
      );
    card.append(
      Object.assign(node("button", "", "Explain time"), {
        onclick: () => workflow.explain(p.id),
      }),
    );
    const total = node("div", "project-total", fmt(p.total));
    total.title = precise(p.total);
    card.append(total);
    const breakdown = node("div", "breakdown");
    breakdown.append(
      node("span", "", `Apps ${fmt(p.desktop)}`),
      node("span", "", `Browser ${fmt(p.browser)}`),
    );
    card.append(breakdown);
    const progress = node("div", "progress");
    const fill = node("div");
    fill.style.width =
      (result.assigned + result.nonProject
        ? (p.total / (result.assigned + result.nonProject)) * 100
        : 0) + "%";
    progress.append(fill);
    card.append(
      progress,
      node(
        "div",
        "rule-summary",
        `${projectRules(p).length} automatic rules · ${projectRules(p).filter((r) => r.mode === "regex").length} regex`,
      ),
    );
    const details = node("details");
    details.append(
      node(
        "summary",
        "",
        p.evidence.length
          ? "Matched activity"
          : "No matching activity for this period",
      ),
    );
    if (p.evidence.length) {
      const list = node("ul");
      for (const label of p.evidence) list.append(node("li", "", label));
      details.append(list);
    }
    card.append(details);
    $("projects").append(card);
  }
  if (!visibleProjects.length)
    $("projects").append(
      node(
        "div",
        "empty",
        "No visible categories. Add a project or enable Show archived.",
      ),
    );
  const colors = new Map(result.projects.map((p) => [p.id, p.color])),
    names = new Map(result.projects.map((p) => [p.id, p.name]));
  colors.set("conflict", "#edb96d");
  colors.set("unassigned", "#566171");
  names.set("conflict", "Needs review");
  names.set("unassigned", "Not assigned");
  $("timeline").replaceChildren();
  // Merge neighbours of one category that are closer than ~1/4000 of the bar.
  const gap = (state.end - state.start) / 4000,
    blocks = [];
  for (const s of result.segments) {
    const last = blocks.at(-1);
    if (last && last.project === s.project && s.start - last.end <= gap)
      last.end = s.end;
    else blocks.push({ start: s.start, end: s.end, project: s.project });
  }
  const timeline = document.createDocumentFragment();
  for (const s of blocks) {
    const block = node("span", "segment");
    block.dataset.start = s.start;
    block.dataset.end = s.end;
    block.dataset.project = s.project;
    block.style.left =
      ((s.start - state.start) / (state.end - state.start)) * 100 + "%";
    block.style.width =
      ((s.end - s.start) / (state.end - state.start)) * 100 + "%";
    block.style.backgroundColor = colors.get(s.project);
    block.title = `${names.get(s.project)} · ${timelineTime.format(s.start)} – ${timelineTime.format(s.end)}`;
    timeline.append(block);
  }
  $("timeline").append(timeline);
  $("timeline").setAttribute(
    "aria-label",
    `Project timeline. Assigned ${fmt(result.assigned)}. Not assigned ${fmt(result.unassigned)}. Needs review ${fmt(result.conflict)}.`,
  );
  $("legend").replaceChildren();
  for (const [id, color] of colors) {
    const item = node("span", "legend-item");
    const chip = node("span", "chip");
    chip.style.backgroundColor = color;
    item.append(chip, document.createTextNode(names.get(id)));
    $("legend").append(item);
  }
  $("review").hidden = result.conflict === 0;
  $("review-list").replaceChildren();
  const groups = new Map();
  for (const s of result.segments.filter((s) => s.project === "conflict")) {
    const key = s.ids.map((id) => names.get(id)).join(" + ");
    groups.set(key, (groups.get(key) || 0) + (s.end - s.start) / 1000);
  }
  for (const [key, sec] of groups)
    $("review-list").append(
      node(
        "li",
        "",
        `${key}: ${precise(sec)}. Edit these projects to narrow their rules.`,
      ),
    );
  renderTimeCharts(result);
  inspector.update();
  manual.update();
  workflow.update();
  workload.update();
  activities.update();
  resizeFrame();
  timing("render", renderStarted);
}
function setColor(color) {
  $("project-color").value = color;
  $("color-preview").style.backgroundColor = color;
  $("color-preview").style.color = "#10221b";
  for (const b of $("swatches").children)
    b.classList.toggle("selected", b.dataset.color === color);
}
function openEditor(id = null, seed = null) {
  state.editId = id;
  const p = state.config.projects.find((p) => p.id === id);
  $("editor-title").textContent = p ? "Edit project" : "Add project";
  $("project-name").value = p?.name || "";
  ruleEditor.load(p, seed);
  workflow.loadMetadata(p);
  setColor(p?.color || PALETTE[state.config.projects.length % PALETTE.length]);
  $("form-error").textContent = "";
  $("delete-project").hidden = !p;
  $("delete-confirm").hidden = true;
  openModal($("editor"));
  $("project-name").focus({ preventScroll: true });
}
function closeEditor() {
  if (!state.saving) $("editor").close();
}
async function persist(
  projects,
  manualAssignments = state.config.manualAssignments || [],
  activityTypes = state.config.activityTypes || [],
) {
  const candidate = {
    ...state.config,
    activityTypes,
    projects,
    manualAssignments: manualAssignments.filter((a) =>
      projects.some((p) => p.id === a.projectId),
    ),
  };
  if (!(await workflow.previewChanges(candidate, true)))
    throw Error("Changes were not saved.");
  const latest = await readSettings([KEY, "project_tracker_history"]);
  if (latest[KEY]?.revision !== state.config.revision)
    throw Error(
      "Projects changed in another tab. Close this editor and refresh before saving again.",
    );
  const next = {
    ...state.config,
    version: 1,
    revision: crypto.randomUUID(),
    activityTypes,
    projects,
    manualAssignments: manualAssignments.filter((a) =>
      projects.some((p) => p.id === a.projectId),
    ),
  };
  if (latest[KEY]) {
    await api(
      "settings/project_tracker_history",
      revisionHistory(latest.project_tracker_history, latest[KEY]),
    );
    await api("settings/project_tracker_backup", latest[KEY]);
  }
  await api("settings/" + KEY, next);
  const saved = await api("settings/" + KEY);
  if (stable(saved) !== stable(next))
    throw Error("Save could not be verified. Refresh before trying again.");
  state.config = saved;
}
async function saveProject(e) {
  e.preventDefault();
  if (state.saving) return;
  $("form-error").textContent = "";
  try {
    const p = normalizeProject(
      {
        id: state.editId || crypto.randomUUID(),
        name: $("project-name").value,
        color: $("project-color").value,
        rules: ruleEditor.read(),
        ...workflow.readMetadata(),
      },
      state.config.projects,
    );
    state.saving = true;
    setSaving(true);
    const projects = state.config.projects.some((x) => x.id === p.id)
      ? state.config.projects.map((x) => (x.id === p.id ? p : x))
      : [...state.config.projects, p];
    await persist(projects);
    $("editor").close();
    notice(`${p.name} saved. Its rules apply to recorded days too.`, "success");
    render();
  } catch (error) {
    $("form-error").textContent = error.message;
  } finally {
    state.saving = false;
    setSaving(false);
  }
}
function setSaving(value) {
  for (const id of [
    "save-project",
    "confirm-delete",
    "delete-project",
    "cancel-editor",
    "close-editor",
  ])
    $(id).disabled = value;
  $("save-project").textContent = value ? "Saving…" : "Save project";
}
async function removeProject() {
  if (state.saving) return;
  state.saving = true;
  setSaving(true);
  try {
    await persist(state.config.projects.filter((p) => p.id !== state.editId));
    $("editor").close();
    notice("Project deleted. Recorded activity is unchanged.", "success");
    render();
  } catch (error) {
    $("form-error").textContent = error.message;
  } finally {
    state.saving = false;
    setSaving(false);
  }
}
for (const color of PALETTE) {
  const b = node("button", "swatch");
  b.type = "button";
  b.style.backgroundColor = color;
  b.dataset.color = color;
  b.setAttribute("aria-label", "Use color " + color);
  b.onclick = () => setColor(color);
  $("swatches").append(b);
}
$("project-color").oninput = (e) => setColor(e.target.value);
$("project-form").onsubmit = saveProject;
$("add-project").onclick = () => openEditor();
$("close-editor").onclick = closeEditor;
$("cancel-editor").onclick = closeEditor;
$("delete-project").onclick = () => {
  $("delete-confirm").hidden = false;
};
$("cancel-delete").onclick = () => {
  $("delete-confirm").hidden = true;
};
$("confirm-delete").onclick = removeProject;
$("editor").addEventListener("cancel", (e) => {
  if (state.saving) e.preventDefault();
});
$("refresh").onclick = () => load();
$("date").onchange = $("date-through").onchange = () => {
  state.ownDate = true;
  load();
};
for (const [id, delta] of [
  ["prev-day", -1],
  ["next-day", 1],
])
  $(id).onclick = () => {
    const d = new Date($("date").value + "T12:00:00");
    const mode = $("report-period").value;
    if (mode === "range") {
      // Move the whole range by its own length.
      const last = new Date($("date-through").value + "T12:00:00");
      const days = Math.round((last - d) / 86400000) + 1;
      d.setDate(d.getDate() + delta * days);
      last.setDate(last.getDate() + delta * days);
      $("date-through").value = localDate(last);
    } else if (mode === "month") {
      d.setDate(1);
      d.setMonth(d.getMonth() + delta);
    } else d.setDate(d.getDate() + delta * (mode === "week" ? 7 : 1));
    $("date").value = localDate(d);
    state.ownDate = true;
    load();
  };
$("today").onclick = () => {
  $("date").value = todayDate();
  state.ownDate = true;
  load();
};
const ruleEditor = setupRuleEditor({ state });
const manual = setupManual({ state, persist, render, notice });
state.manualUI = manual;
lockScrollBehindDialogs();
const workflow = setupWorkflow({
  state,
  api,
  persist,
  render,
  load,
  notice,
  resizeFrame,
});
const previewButton = node("button", "", "Preview changes");
previewButton.type = "button";
previewButton.id = "preview-project";
previewButton.onclick = () => {
  try {
    const p = normalizeProject(
      {
        id: state.editId || "preview-new-project",
        name: $("project-name").value,
        color: $("project-color").value,
        rules: ruleEditor.read(),
        ...workflow.readMetadata(),
      },
      state.config.projects,
    );
    const projects = state.config.projects.some((x) => x.id === p.id)
      ? state.config.projects.map((x) => (x.id === p.id ? p : x))
      : [...state.config.projects, p];
    workflow.previewChanges({ ...state.config, projects });
  } catch (e) {
    $("form-error").textContent = e.message;
  }
};
$("save-project").before(previewButton);
const activities = setupActivities({
  state,
  persist,
  render,
  notice,
  resizeFrame,
});
const workload = setupWorkload({ state, api, resizeFrame });
// Keep related summaries side by side while charts retain the full canvas.
const summaryGrid = document.createElement("div");
summaryGrid.className = "summary-grid";
const projectBlock = document.createElement("section");
projectBlock.className = "project-block";
const projectHeading = $("projects").previousElementSibling;
projectHeading.before(summaryGrid);
projectBlock.append(projectHeading, $("projects"));
summaryGrid.append(projectBlock, $("activity-types-panel"));

const inspector = setupUnassigned({
  state,
  persist,
  render,
  openEditor,
  openActivityType: activities.open,
  notice,
  resizeFrame,
});
new ResizeObserver(resizeFrame).observe(document.querySelector("main"));
load();
setInterval(() => {
  if (!document.querySelector("dialog[open]") && !document.hidden)
    load({ auto: true });
}, 30000);

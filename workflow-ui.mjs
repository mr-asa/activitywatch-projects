import { openModal } from "./dialogs.mjs";
import { compareConfigs, validateConfig } from "./workflow-core.mjs";
import { setupExport } from "./export-ui.mjs";
import { unassignedActivities } from "./unassigned-core.mjs";
import { clipSorted } from "./projects-core.mjs";
import { readableUrl } from "./rule-engine.mjs";
import { persistControl } from "./ui-prefs.mjs";

export function setupWorkflow({
  state,
  api,
  persist,
  render,
  load,
  notice,
  resizeFrame,
}) {
  const $ = (id) => document.getElementById(id);
  const node = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const time = (seconds) => {
    const s = Math.round(seconds);
    return `${s < 0 ? "-" : ""}${Math.floor(Math.abs(s) / 3600)}h ${Math.floor((Math.abs(s) % 3600) / 60)}m ${Math.abs(s) % 60}s`;
  };
  const button = (name, run) => {
    const b = node("button", name);
    b.type = "button";
    b.onclick = run;
    return b;
  };
  function dialog(id, title) {
    const d = node("dialog");
    d.id = id;
    d.className = "workflow-dialog";
    const header = node("div");
    header.className = "dialog-heading";
    header.append(
      node("h2", title),
      button("Close", () => d.close()),
    );
    const body = node("div");
    d.append(header, body);
    document.body.append(d);
    return { dialog: d, body };
  }
  function show(d) {
    openModal(d);
  }
  function download(text, name, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = node("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const toolbar = node("section");
  toolbar.className = "workflow-toolbar";
  toolbar.innerHTML =
    '<label>Report period<select id="report-period"><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></label><label class="check-label"><input type="checkbox" id="show-archived"> Show archived</label>';
  toolbar.append(
    button("Explain activities", () => explain()),
    button("Reports & export", () => exporter.open()),
    button("Settings & recovery", () => recovery()),
  );
  document.querySelector(".toolbar").after(toolbar);
  $("report-period").onchange = () => {
    state.ownDate = true;
    load();
  };
  $("show-archived").onchange = render;
  persistControl($("report-period"), "reportPeriod");
  persistControl($("show-archived"), "showArchived");
  const stat = node("div");
  stat.append(node("span", "Non-project time"));
  const total = node("strong", "—");
  total.id = "non-project-total";
  stat.append(total);
  document.querySelector(".stats .stat-note").before(stat);
  const fields = node("div");
  fields.className = "workflow-fields";
  fields.innerHTML =
    '<label>Category type<select id="project-kind"><option value="project">Project work</option><option value="non-project">Non-project / intentionally ignored</option></select></label><label class="check-label"><input type="checkbox" id="project-archived"> Archived (hide from cards)</label><label>Automatic rules start on<input type="date" id="project-rules-from"></label><label>Automatic rules end on<input type="date" id="project-rules-through"></label><p class="field-help">Archiving keeps historical totals. The optional dates limit all automatic rules of this project at once (each rule can still have its own, narrower dates); manual assignments still apply.</p>';
  $("rule-editor").before(fields);
  const activity = dialog("activity-explanations", "Why was this assigned?");
  const explanationCache = new WeakMap();
  function explain(projectId = null) {
    activity.body.replaceChildren();
    const help = node(
      "p",
      "Choose an activity to see its recorded application, final allocation, and matching rules. Manual assignments take precedence; overlapping automatic categories require review.",
    );
    activity.body.append(help);
    const search = node("input");
    search.type = "search";
    search.placeholder = "Search activity titles, apps, or URLs";
    search.setAttribute("aria-label", "Search explanations");
    activity.body.append(search);
    const list = node("div");
    activity.body.append(list);
    const segments = state.result.segments.filter(
      (s) => !projectId || s.project === projectId || s.ids.includes(projectId),
    );
    let cached = explanationCache.get(state.result);
    if (!cached) {
      cached = new Map();
      explanationCache.set(state.result, cached);
    }
    if (!cached.has(projectId))
      cached.set(
        projectId,
        unassignedActivities(state.data, {
          segments: segments.map((s) => ({ ...s, project: "unassigned" })),
        }),
      );
    const rows = cached.get(projectId);
    let limit = 50;
    function draw() {
      list.replaceChildren();
      const term = search.value.toLowerCase(),
        filtered = rows.filter((r) =>
          [r.title, r.app, r.url].join(" ").toLowerCase().includes(term),
        );
      for (const row of filtered.slice(0, limit)) {
        const detail = node("details");
        detail.className = "explanation-row";
        detail.append(
          node("summary", `${row.title} · ${row.app} · ${time(row.seconds)}`),
        );
        let populated = false;
        detail.addEventListener("toggle", () => {
          if (!detail.open || populated) return;
          populated = true;
          if (row.url) detail.append(node("p", readableUrl(row.url)));
          const allocations = new Map();
          for (const s of state.result.segments) {
            const sec = clipSorted(row.ranges, s.start, s.end).reduce(
              (sum, [a, b]) => sum + (b - a) / 1000,
              0,
            );
            if (sec) {
              const name =
                state.config.projects.find((p) => p.id === s.project)?.name ||
                (s.project === "conflict" ? "Needs review" : "Not assigned");
              allocations.set(name, (allocations.get(name) || 0) + sec);
            }
          }
          detail.append(
            node(
              "p",
              "Final allocation: " +
                [...allocations]
                  .map(([name, sec]) => `${name}: ${time(sec)}`)
                  .join("; "),
            ),
          );
          const seen = new Set();
          for (const e of state.result.evidence || []) {
            if (!clipSorted(row.ranges, e.s, e.e).length) continue;
            const p = state.config.projects.find((p) => p.id === e.project);
            const label = e.manual
              ? `${p.name} — manual assignment: ${e.assignment.note || "No note"} (${new Date(e.assignment.start).toLocaleString()} – ${new Date(e.assignment.end).toLocaleString()})`
              : `${p.name} — ${e.rule.type} / ${e.rule.mode}: ${e.rule.pattern}; app: ${e.rule.appFilter || "any"}; dates: ${e.rule.from || "unlimited"} → ${e.rule.through || "unlimited"}`;
            if (!seen.has(label)) {
              detail.append(node("p", label));
              seen.add(label);
            }
          }
          if (!seen.size)
            detail.append(node("p", "No matching rule or manual assignment."));
        });
        list.append(detail);
      }
      if (!filtered.length)
        list.append(node("p", "No activities in this selection."));
      if (filtered.length > limit)
        list.append(
          button(`Show more (${filtered.length - limit} remaining)`, () => {
            limit += 50;
            draw();
          }),
        );
    }
    search.oninput = () => {
      limit = 50;
      draw();
    };
    draw();
    show(activity.dialog);
  }
  const preview = dialog("change-preview", "Preview changes");
  let resolvePreview = null;
  preview.dialog.addEventListener("close", () => {
    if (resolvePreview) {
      const done = resolvePreview;
      resolvePreview = null;
      done(false);
    }
  });
  function previewChanges(next, confirm = false) {
    const diff = compareConfigs(
      state.data,
      state.config,
      next,
      state.start,
      state.resultEnd,
      state.host,
      state.result,
    );
    preview.body.replaceChildren(
      node(
        "p",
        "Effect on the loaded report period only. Rules may also change other dates within their validity range.",
      ),
    );
    const overview = node("ul");
    for (const [label, key] of [
      ["Project time", "assigned"],
      ["Non-project time", "nonProject"],
      ["Needs review", "conflict"],
      ["Not assigned", "unassigned"],
    ])
      overview.append(
        node(
          "li",
          `${label}: ${time(diff.previous[key] || 0)} → ${time(diff.next[key] || 0)}`,
        ),
      );
    preview.body.append(overview);
    for (const p of diff.changes)
      preview.body.append(
        node(
          "p",
          `${p.name}: ${time(p.before)} → ${time(p.after)} (${p.delta > 0 ? "+" : ""}${time(p.delta)})`,
        ),
      );
    if (diff.activityChanges.length) {
      preview.body.append(
        node("h3", "Activity types · independent of projects"),
      );
      for (const t of diff.activityChanges)
        preview.body.append(
          node("p", `${t.name}: ${time(t.before)} → ${time(t.after)}`),
        );
    }
    if (!diff.changes.length)
      preview.body.append(
        node(
          "p",
          "No category total changes in this period. Settings can still change, including archive state and future matching.",
        ),
      );
    if (confirm)
      preview.body.append(
        button("Confirm save", () => {
          const done = resolvePreview;
          resolvePreview = null;
          preview.dialog.close();
          done?.(true);
        }),
      );
    show(preview.dialog);
    return confirm
      ? new Promise((resolve) => {
          resolvePreview = resolve;
        })
      : Promise.resolve(false);
  }
  const exporter = setupExport({
    state,
    api,
    dialog,
    show,
    download,
    notice,
  });
  const settings = dialog("recovery-dialog", "Settings & recovery");
  async function restore(config) {
    if (state.saving) return;
    try {
      const validated = validateConfig(config);
      state.saving = true;
      await persist(
        validated.projects,
        validated.manualAssignments,
        validated.activityTypes,
      );
      settings.dialog.close();
      render();
      notice("Settings restored. Raw activity was not changed.", "success");
    } catch (e) {
      notice(e.message, "error");
    } finally {
      state.saving = false;
    }
  }
  async function recovery() {
    settings.body.replaceChildren();
    settings.body.append(
      node(
        "p",
        "Backups contain project rules, colors, archive settings and manual assignments, not raw activity. Restoring replaces the current configuration after a preview. Up to 20 previous configurations are retained locally.",
      ),
    );
    settings.body.append(
      button("Export settings", () =>
        download(
          JSON.stringify(
            {
              version: 1,
              projects: state.config.projects,
              activityTypes: state.config.activityTypes || [],
              manualAssignments: state.config.manualAssignments || [],
            },
            null,
            2,
          ),
          "project-settings.json",
          "application/json",
        ),
      ),
    );
    const file = node("input");
    file.type = "file";
    file.accept = ".json,application/json";
    file.setAttribute("aria-label", "Import settings JSON");
    file.onchange = async () => {
      try {
        if (!file.files[0]) return;
        if (file.files[0].size > 5 * 1024 * 1024)
          throw Error("Settings backup is larger than 5 MB.");
        await restore(JSON.parse(await file.files[0].text()));
      } catch (e) {
        notice("Import failed: " + e.message, "error");
      } finally {
        file.value = "";
      }
    };
    settings.body.append(file);
    const list = node("div");
    list.append(node("p", "Loading previous versions…"));
    settings.body.append(list);
    show(settings.dialog);
    try {
      const stored = await api("settings");
      const revisions = stored.project_tracker_history || [];
      list.replaceChildren();
      if (!revisions.length && stored.project_tracker_backup)
        revisions.push({
          savedAt: null,
          config: stored.project_tracker_backup,
        });
      for (const revision of revisions) {
        const row = node("div");
        row.className = "manual-item";
        row.append(
          node(
            "span",
            `${revision.savedAt ? new Date(revision.savedAt).toLocaleString() : "Previous configuration"} · ${revision.config.projects.length} categories`,
          ),
          button("Restore this version", () => restore(revision.config)),
        );
        list.append(row);
      }
      if (!revisions.length)
        list.append(node("p", "No prior configurations saved yet."));
    } catch (e) {
      list.textContent = e.message;
    }
  }
  function update() {
    total.textContent = time(state.result.nonProject || 0).replace(
      / \d+s$/,
      "",
    );
    total.title = time(state.result.nonProject || 0);
    toolbar
      .querySelectorAll("button")
      .forEach((b) => (b.disabled = !state.result));
    resizeFrame();
  }
  return {
    update,
    explain,
    previewChanges,
    loadMetadata(p) {
      $("project-kind").value = p?.kind || "project";
      $("project-archived").checked = p?.archived || false;
      $("project-rules-from").value = p?.rulesFrom || "";
      $("project-rules-through").value = p?.rulesThrough || "";
    },
    readMetadata() {
      return {
        kind: $("project-kind").value,
        archived: $("project-archived").checked,
        rulesFrom: $("project-rules-from").value,
        rulesThrough: $("project-rules-through").value,
      };
    },
  };
}

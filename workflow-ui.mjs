import { openModal } from "./dialogs.mjs";
import { conflictActivities, validateConfig } from "./workflow-core.mjs";
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
  openEditor,
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
  // Tools live in the page header; the period select and "Show archived"
  // are part of the page (period bar, projects heading).
  const toolbar = $("tool-buttons");
  toolbar.append(
    button("Explain activities", () => explain()),
    button("Reports & export", () => exporter.open()),
    button("Settings & recovery", () => recovery()),
  );
  $("report-period").onchange = () => {
    state.ownDate = true;
    syncRangeInput();
    load();
  };
  // "Custom range" shows a second date: the last day of the report.
  function syncRangeInput() {
    const range = $("report-period").value === "range";
    $("date-through").hidden = !range;
    if (range && !($("date-through").value >= $("date").value))
      $("date-through").value = $("date").value;
  }
  $("show-archived").onchange = render;
  persistControl($("report-period"), "reportPeriod");
  syncRangeInput();
  persistControl($("show-archived"), "showArchived");
  const stat = node("div");
  stat.append(node("span", "Non-project time"));
  const total = node("strong", "—");
  total.id = "non-project-total";
  stat.append(total);
  document.querySelector(".stats").append(stat);
  const fields = node("div");
  fields.className = "workflow-fields";
  fields.innerHTML =
    '<label>Category type<select id="project-kind"><option value="project">Project work</option><option value="non-project">Non-project / intentionally ignored</option></select></label><label class="check-label"><input type="checkbox" id="project-archived"> Archived (hide from cards)</label><div class="rule-dates project-rule-dates"><label>Automatic rules start on<input type="date" id="project-rules-from"></label><label>Automatic rules end on<input type="date" id="project-rules-through"></label></div><p class="field-help">Archiving keeps historical totals. The optional dates limit all automatic rules of this project at once (each rule can still have its own, narrower dates); manual assignments still apply.</p>';
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
  // "Needs review": which activities several categories claim, and why.
  const conflictView = dialog(
    "conflict-dialog",
    "Matched by more than one project",
  );
  const ruleText = (rule) => {
    const field =
      rule.type === "url"
        ? "page URL"
        : rule.type.startsWith("editor-")
          ? "editor path"
          : "window title";
    const how =
      rule.mode === "regex"
        ? "matches regex"
        : rule.type === "url"
          ? "is under"
          : "contains";
    const pattern =
      rule.type === "url" ? readableUrl(rule.pattern) : rule.pattern;
    const dates =
      rule.from || rule.through
        ? ` · ${rule.from || "…"} – ${rule.through || "…"}`
        : "";
    return `${field} ${how} "${pattern}"${rule.appFilter ? ` in ${rule.appFilter}` : ""}${dates}`;
  };
  function explainConflict(ids) {
    const name = (id) =>
      state.config.projects.find((p) => p.id === id)?.name || id;
    const rows = conflictActivities(state.result, ids);
    const total = rows.reduce((n, r) => n + r.seconds, 0);
    conflictView.body.replaceChildren(
      node(
        "p",
        `${ids.map(name).join(" + ")} · ${time(total)} in this period. Each activity below is claimed by all of these projects; make one rule more specific (another pattern, an application or dates), or assign the minutes manually.`,
      ),
    );
    for (const row of rows) {
      const card = node("div");
      card.className = "explanation-row conflict-row";
      card.append(
        node(
          "strong",
          `${/^https?:/.test(row.label) ? readableUrl(row.label) : row.label} · ${row.app} · ${time(row.seconds)}`,
        ),
      );
      const list = node("ul");
      for (const id of ids) {
        const item = node("li");
        const reasons = (row.matches.get(id) || []).map((r) =>
          r.rule
            ? ruleText(r.rule)
            : `manual assignment${r.assignment.note ? ` "${r.assignment.note}"` : ""}`,
        );
        item.append(
          node("span", `${name(id)} ← ${reasons.join("; ") || "—"} `),
          button(`Edit ${name(id)}`, () => {
            conflictView.dialog.close();
            openEditor(id);
          }),
        );
        list.append(item);
      }
      card.append(
        list,
        button("Assign these minutes manually…", () => {
          conflictView.dialog.close();
          state.manualUI.open(
            row.ranges,
            "",
            `${row.label} · ${row.app} · needs review`,
          );
        }),
      );
      conflictView.body.append(card);
    }
    if (!rows.length)
      conflictView.body.append(node("p", "Nothing needs review here now."));
    show(conflictView.dialog);
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
        "Backups contain project rules, colors, archive settings and manual assignments, not raw activity. Restoring replaces the current configuration after a preview. Up to 20 previous configurations are retained locally (fewer when the configuration is large: about 3 MB in total).",
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
      const [history, backup] = await Promise.all([
        api("settings/project_tracker_history"),
        api("settings/project_tracker_backup"),
      ]);
      const stored = {
        project_tracker_history: history,
        project_tracker_backup: backup,
      };
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
    explainConflict,
    exportProject: (id) => exporter.openFor(id),
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

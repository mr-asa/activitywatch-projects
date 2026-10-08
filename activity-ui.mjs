import { openModal } from "./dialogs.mjs";
import { createRuleEditor } from "./compact-rule-editor.mjs";
import {
  normalizeActivityType,
  analyzeActivityTypes,
  scopedActivityTypes,
} from "./activity-core.mjs";
import { restoredOption, setPref } from "./ui-prefs.mjs";
export function setupActivities({
  state,
  persist,
  render,
  notice,
  resizeFrame,
}) {
  const panel = document.createElement("section");
  panel.id = "activity-types-panel";
  panel.className = "timeline-panel";
  panel.innerHTML =
    '<div class="section-heading"><div><h2>Activity types</h2><p class="muted">What you did, independently of which project it belonged to.</p></div><button type="button" id="add-activity-type">+ Add activity type</button></div><div class="workload-controls"><label>Show activity within<select id="activity-scope" aria-label="Activity project scope"></select></label></div><details class="panel-help"><summary>How activity types work</summary><p class="field-help">The same minute can belong to a project and an activity type. These are separate views, not time to add together. An activity may carry several types; its time counts in each of them. Types do not affect project attribution.</p></details><div id="activity-type-totals"></div><p id="activity-untyped" class="muted"></p>';
  document.getElementById("projects").after(panel);
  const $ = (id) => document.getElementById(id);
  let editing = null,
    cache = null;
  const dialog = document.createElement("dialog");
  dialog.id = "activity-type-editor";
  dialog.className = "workflow-dialog";
  dialog.innerHTML =
    '<form id="activity-type-form"><div class="dialog-heading"><h2>Activity type</h2><button type="button" id="activity-close">Close</button></div><label>Name<input id="activity-name" maxlength="80" required></label><label>Color<input id="activity-color" type="color" value="#8ca8ff"></label><p id="activity-type-error" role="alert" class="error"></p><div class="dialog-actions"><button id="activity-delete" class="danger" type="button">Delete type</button><span class="spacer"></span><button id="activity-save" class="primary" type="submit">Save activity type</button></div></form>';
  document.body.append(dialog);
  // The same rule editor as projects: any field, text or regex, dates.
  const ruleEditor = createRuleEditor({
    state,
    ids: {
      section: "type-rule-editor",
      rows: "type-rule-rows",
      add: "type-add-rule",
    },
    title: "Rules",
  });
  ruleEditor.element.insertAdjacentHTML(
    "beforeend",
    '<p class="field-help">A type is a label: a moment may carry several types, and the time counts in each. Types never assign a project. Rules apply to recorded history too; website rules need browser tracking.</p>',
  );
  $("activity-type-error").before(ruleEditor.element);
  ruleEditor.element.addEventListener("input", () => {
    $("activity-type-error").textContent = "";
  });
  const node = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const time = (s) =>
    `${(s / 3600).toLocaleString(undefined, { maximumFractionDigits: 2 })} h`;
  // `type` is an existing type, or a seed (no id) with prefilled rules.
  function open(type = null) {
    editing = type?.id || null;
    $("activity-name").value = type?.name || "";
    $("activity-color").value = type?.color || "#8ca8ff";
    ruleEditor.load(type?.rules || []);
    if (!type?.rules?.length) ruleEditor.add();
    $("activity-type-error").textContent = "";
    $("activity-delete").hidden = !editing;
    $("activity-delete").textContent = "Delete type";
    openModal(dialog);
  }
  async function save(types) {
    if (state.saving) return;
    state.saving = true;
    $("activity-save").disabled = true;
    try {
      await persist(
        state.config.projects,
        state.config.manualAssignments || [],
        types,
      );
      dialog.close();
      render();
      notice(
        "Activity types saved. Project attribution is unchanged.",
        "success",
      );
    } catch (e) {
      $("activity-type-error").textContent = e.message;
    } finally {
      state.saving = false;
      $("activity-save").disabled = false;
    }
  }
  $("activity-type-form").onsubmit = (e) => {
    e.preventDefault();
    if (state.saving) return;
    try {
      const types = state.config.activityTypes || [];
      const type = normalizeActivityType(
        {
          id: editing || crypto.randomUUID(),
          name: $("activity-name").value,
          color: $("activity-color").value,
          rules: ruleEditor.read(),
        },
        types,
      );
      save(
        editing
          ? types.map((t) => (t.id === editing ? type : t))
          : [...types, type],
      );
    } catch (e) {
      $("activity-type-error").textContent = e.message;
    }
  };
  $("activity-delete").onclick = () => {
    if ($("activity-delete").textContent !== "Confirm delete type") {
      $("activity-delete").textContent = "Confirm delete type";
      return;
    }
    save((state.config.activityTypes || []).filter((t) => t.id !== editing));
  };
  $("activity-close").onclick = () => {
    if (!state.saving) dialog.close();
  };
  dialog.addEventListener("cancel", (e) => {
    if (state.saving) e.preventDefault();
  });
  $("add-activity-type").onclick = () => open();
  $("activity-scope").onchange = () => {
    setPref("activityScope", $("activity-scope").value);
    draw();
  };
  function draw() {
    if (!cache) return;
    const summary = scopedActivityTypes(
      state.result,
      cache.result,
      $("activity-scope").value || null,
    );
    $("activity-type-totals").replaceChildren();
    for (const t of summary.types) {
      const row = node("div");
      row.className = "activity-type-row";
      const label = node("strong", t.name);
      label.style.color = t.color;
      const metric = node(
        "span",
        `${time(t.total)} · ${summary.total ? ((t.total / summary.total) * 100).toFixed(1) : "0"}%`,
      );
      const bar = node("div");
      bar.className = "activity-type-bar";
      const fill = node("span");
      fill.style.width =
        (summary.total ? (t.total / summary.total) * 100 : 0) + "%";
      fill.style.background = t.color;
      bar.append(fill);
      const edit = node("button", "Edit type");
      edit.type = "button";
      edit.setAttribute("aria-label", "Edit activity type " + t.name);
      edit.onclick = () =>
        open((state.config.activityTypes || []).find((a) => a.id === t.id));
      row.append(label, metric, bar, edit);
      $("activity-type-totals").append(row);
    }
    $("activity-untyped").textContent = summary.types.length
      ? `No activity type: ${time(summary.untyped)} · Total in scope: ${time(summary.total)}`
      : "No activity types yet. Create one with + Add activity type, or from an activity in the Not assigned list. Types do not replace projects or non-project categories.";
    resizeFrame();
  }
  function typeResult() {
    if (!state.result) return null;
    if (
      !cache ||
      cache.data !== state.data ||
      cache.config !== state.config ||
      cache.projectResult !== state.result
    ) {
      cache = {
        data: state.data,
        config: state.config,
        projectResult: state.result,
        result: analyzeActivityTypes(
          state.data,
          state.config.activityTypes || [],
          state.start,
          state.resultEnd,
        ),
      };
    }
    return cache.result;
  }
  state.activityTypeResult = typeResult;
  function update() {
    const selected = $("activity-scope").value;
    $("activity-scope").replaceChildren(
      new Option("All active time", ""),
      ...state.config.projects.map((p) => new Option(p.name, p.id)),
      new Option("Unassigned project time", "unassigned"),
      new Option("Project conflicts", "conflict"),
    );
    $("activity-scope").value = restoredOption(
      $("activity-scope"),
      "activityScope",
      [...$("activity-scope").options].some((o) => o.value === selected)
        ? selected
        : "",
    );
    typeResult();
    draw();
  }
  // A seed without an id opens the editor for a new, prefilled activity type.
  return { update, open };
}

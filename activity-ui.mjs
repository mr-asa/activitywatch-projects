import {
  normalizeActivityType,
  analyzeActivityTypes,
  scopedActivityTypes,
} from "./activity-core.mjs";
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
    '<div class="section-heading"><div><h2>Activity types</h2><p class="muted">What you did, independently of which project it belonged to.</p></div><button type="button" id="add-activity-type">+ Add activity type</button></div><div class="workload-controls"><label>Show activity within<select id="activity-scope" aria-label="Activity project scope"></select></label></div><details class="panel-help"><summary>How activity types work</summary><p class="field-help">The same minute can belong to a project and an activity type. These are separate views, not time to add together. Overlapping activity rules appear as Type needs review and do not affect project attribution.</p></details><div id="activity-type-totals"></div><p id="activity-untyped" class="muted"></p>';
  document.getElementById("projects").after(panel);
  const $ = (id) => document.getElementById(id);
  let editing = null,
    cache = null;
  const dialog = document.createElement("dialog");
  dialog.id = "activity-type-editor";
  dialog.className = "workflow-dialog";
  dialog.innerHTML =
    '<form id="activity-type-form"><div class="dialog-heading"><h2>Activity type</h2><button type="button" id="activity-close">Close</button></div><label>Name<input id="activity-name" maxlength="80" required></label><label>Color<input id="activity-color" type="color" value="#8ca8ff"></label><div class="activity-rule-fields"><label>Applications · one per line<textarea id="activity-apps" rows="3" placeholder="Telegram&#10;Discord"></textarea></label><label>Title patterns · one per line<textarea id="activity-titles" rows="3" placeholder="Optional title fragments"></textarea></label><label>Title matching<select id="activity-mode"><option value="text">Plain text</option><option value="regex">Regex</option></select></label><label>Website URLs · one per line<textarea id="activity-urls" rows="3" placeholder="https://www.youtube.com/"></textarea></label></div><p class="field-help">Applications alone match any title in those apps. When titles are entered, both app and title must match; blank apps means any app. Website rules are alternatives and need browser tracking. These rules apply to recorded history and never assign a project.</p><p id="activity-type-error" role="alert" class="error"></p><div class="dialog-actions"><button id="activity-delete" class="danger" type="button">Delete type</button><span class="spacer"></span><button id="activity-save" class="primary" type="submit">Save activity type</button></div></form>';
  document.body.append(dialog);
  const node = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const time = (s) =>
    `${(s / 3600).toLocaleString(undefined, { maximumFractionDigits: 2 })} h`;
  function open(type = null) {
    editing = type?.id || null;
    $("activity-name").value = type?.name || "";
    $("activity-color").value = type?.color || "#8ca8ff";
    for (const [id, key] of [
      ["activity-apps", "applications"],
      ["activity-titles", "titles"],
      ["activity-urls", "urls"],
    ])
      $(id).value = (type?.[key] || []).join("\n");
    $("activity-mode").value = type?.mode || "text";
    $("activity-type-error").textContent = "";
    $("activity-delete").hidden = !editing;
    $("activity-delete").textContent = "Delete type";
    if (window.frameElement) {
      dialog.style.top = "16px";
      dialog.style.bottom = "auto";
      dialog.style.margin = "0 auto";
      dialog.style.maxHeight =
        Math.max(240, window.parent.innerHeight - 100) + "px";
      window.frameElement.scrollIntoView({
        block: "start",
        behavior: "instant",
      });
    }
    dialog.showModal();
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
      const lines = (id) =>
        $(id)
          .value.split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
      const type = normalizeActivityType(
        {
          id: editing || crypto.randomUUID(),
          name: $("activity-name").value,
          color: $("activity-color").value,
          applications: lines("activity-apps"),
          titles: lines("activity-titles"),
          urls: lines("activity-urls"),
          mode: $("activity-mode").value,
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
  $("activity-scope").onchange = () => draw();
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
      ? `No activity type: ${time(summary.untyped)} · Type needs review: ${time(summary.conflict)} · Total in scope: ${time(summary.total)}`
      : "No activity types yet. Use a starter above or create your own. They do not replace projects or non-project categories.";
    resizeFrame();
  }
  function update() {
    const selected = $("activity-scope").value;
    $("activity-scope").replaceChildren(
      new Option("All active time", ""),
      ...state.config.projects.map((p) => new Option(p.name, p.id)),
      new Option("Unassigned project time", "unassigned"),
      new Option("Project conflicts", "conflict"),
    );
    $("activity-scope").value = [...$("activity-scope").options].some(
      (o) => o.value === selected,
    )
      ? selected
      : "";
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
    draw();
  }
  return { update };
}

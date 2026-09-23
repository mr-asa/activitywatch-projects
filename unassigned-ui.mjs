import { projectRules, normalizeRule } from "./rule-engine.mjs";
import { unassignedActivities, suggestedRule } from "./unassigned-core.mjs";
import { normalizeProject } from "./projects-core.mjs";
export function setupUnassigned({
  state,
  persist,
  render,
  openEditor,
  notice,
  resizeFrame,
}) {
  const $ = (id) => document.getElementById(id);
  let scope = null,
    rows = [],
    selected = null,
    open = false;
  const time = (s) => {
    s = Math.round(s);
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
  };
  const panel = document.createElement("section");
  panel.id = "unassigned-panel";
  panel.className = "unassigned-panel";
  panel.hidden = true;
  panel.innerHTML =
    '<div class="section-heading"><div><h2>Not assigned · activities</h2><p id="unassigned-scope" class="muted"></p></div><button id="close-unassigned" aria-label="Close unassigned activities">×</button></div><div class="unassigned-tools"><input id="unassigned-search" type="search" aria-label="Search unassigned activities" placeholder="Search titles, applications, or URLs"><button id="all-unassigned">Show whole day</button></div><p id="unassigned-count" class="muted"></p><div id="unassigned-rows"></div>';
  document.querySelector(".timeline-panel").after(panel);
  const dialog = document.createElement("dialog");
  dialog.id = "assign-dialog";
  dialog.innerHTML =
    '<form id="assign-form"><div class="dialog-heading"><h2>Add activity to a project</h2><button type="button" id="close-assign" aria-label="Close assignment">×</button></div><p id="assign-source" class="assignment-source"></p><label for="assign-project">Project</label><select id="assign-project"></select><label for="assign-kind">Match using</label><select id="assign-kind"><option value="keyword">Window title keyword</option><option value="url">Page URL</option><option value="regex">Window title regex</option></select><label for="assign-app">Application (optional)</label><input id="assign-app" list="recorded-apps" placeholder="Any app · e.g. Telegram"><label for="assign-rule">Rule to add</label><textarea id="assign-rule" rows="3" required></textarea><div class="rule-dates"><label>Valid from<input id="assign-from" type="date" aria-label="Assignment rule valid from"></label><label>Valid through<input id="assign-through" type="date" aria-label="Assignment rule valid through"></label></div><p id="assign-hint" class="field-help"></p><p class="field-help">This rule will apply to other matching activity and previously recorded days too.</p><p id="assign-error" class="error" role="alert"></p><div class="dialog-actions"><span class="spacer"></span><button id="cancel-assign" type="button">Cancel</button><button id="save-assign" class="primary" type="submit">Add rule</button></div></form>';
  document.body.append(dialog);
  function node(tag, cls, text) {
    const n = document.createElement(tag);
    n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function show(nextScope = null) {
    scope = nextScope;
    open = true;
    panel.hidden = false;
    update();
    panel.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function update() {
    const trigger = $("unassigned").parentElement;
    trigger.classList.add("unassigned-trigger");
    trigger.setAttribute("role", "button");
    trigger.tabIndex = 0;
    trigger.setAttribute("aria-label", "Show unassigned activities");
    trigger.onclick = () => show();
    trigger.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        show();
      }
    };
    for (const item of $("legend").children)
      if (item.textContent === "Not assigned") {
        item.classList.add("clickable");
        item.role = "button";
        item.tabIndex = 0;
        item.onclick = () => show();
        item.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            show();
          }
        };
      }
    const blocks = [...$("timeline").children];
    state.result?.segments.forEach((segment, i) => {
      if (segment.project === "unassigned" && blocks[i]) {
        const block = blocks[i];
        block.classList.add("clickable");
        block.role = "button";
        block.tabIndex = 0;
        block.setAttribute(
          "aria-label",
          "Inspect unassigned interval " +
            new Date(segment.start).toLocaleTimeString(),
        );
        block.onclick = () => show([segment.start, segment.end]);
        block.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            show([segment.start, segment.end]);
          }
        };
      }
    });
    if (!open || !state.result) return;
    if (scope && (scope[1] <= state.start || scope[0] >= state.end))
      scope = null;
    rows = unassignedActivities(state.data, state.result, scope);
    $("unassigned-scope").textContent = scope
      ? `${new Date(scope[0]).toLocaleTimeString()} – ${new Date(scope[1]).toLocaleTimeString()} · selected gray interval`
      : "Entire selected period · largest time first";
    $("all-unassigned").hidden = !scope;
    drawRows();
  }
  let visibleLimit = 50;
  function drawRows() {
    const term = $("unassigned-search").value.trim().toLocaleLowerCase();
    const filtered = rows.filter((r) =>
      [r.title, r.app, r.url].join(" ").toLocaleLowerCase().includes(term),
    );
    $("unassigned-count").textContent =
      `${filtered.length} activities · ${time(filtered.reduce((n, r) => n + r.seconds, 0))}`;
    $("unassigned-rows").replaceChildren();
    for (const row of filtered.slice(0, visibleLimit)) {
      const card = node("article", "unassigned-row");
      const content = node("div", "activity-description");
      content.append(
        node("strong", "", row.title),
        node("div", "muted", row.app),
      );
      if (row.url) content.append(node("div", "activity-url", row.url));
      const action = node("div", "activity-action");
      action.append(node("strong", "", time(row.seconds)));
      const button = node("button", "", "Add to project");
      button.onclick = () => assign(row);
      action.append(button);
      const manual = document.createElement("button");
      manual.textContent = "Assign time only";
      manual.onclick = () => state.manualUI.open(row.ranges, row.title);
      action.append(manual);
      card.append(content, action);
      $("unassigned-rows").append(card);
    }
    if (filtered.length > visibleLimit) {
      const more = node(
        "button",
        "",
        `Show more (${filtered.length - visibleLimit} remaining)`,
      );
      more.onclick = () => {
        visibleLimit += 50;
        drawRows();
      };
      $("unassigned-rows").append(more);
    }
    if (!filtered.length)
      $("unassigned-rows").append(
        node(
          "p",
          "empty",
          rows.length
            ? "No activities match this search."
            : "No unassigned activity in this period.",
        ),
      );
    resizeFrame();
  }
  function chooseKind() {
    $("assign-app").disabled = $("assign-kind").value === "url";
    const suggested = suggestedRule(selected),
      kind = $("assign-kind").value;
    $("assign-rule").value = kind === "url" ? suggested.url : suggested.keyword;
    $("assign-hint").textContent =
      kind === "url"
        ? "Use a project-specific URL. Its subpages also match; a homepage would match the whole site."
        : kind === "regex"
          ? "Enter a JavaScript regex without / delimiters. Matching ignores capitalization."
          : "Use a distinctive part of the title. Matching ignores capitalization.";
  }
  function assign(row) {
    selected = row;
    $("assign-app").value = "";
    $("assign-from").value = "";
    $("assign-through").value = "";
    $("assign-error").textContent = "";
    $("assign-source").textContent = row.title + " · " + time(row.seconds);
    $("assign-project").replaceChildren();
    for (const p of state.config.projects.filter((p) => !p.archived)) {
      $("assign-project").append(
        new Option(
          p.name + (p.kind === "non-project" ? " (non-project)" : ""),
          p.id,
        ),
      );
    }
    $("assign-project").append(new Option("+ Create new project", "__new__"));
    const suggested = suggestedRule(row);
    $("assign-kind").querySelector('[value="url"]').disabled = !suggested.url;
    $("assign-kind").value = suggested.kind;
    chooseKind();
    updateSubmit();
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
    $("assign-project").focus();
  }
  function updateSubmit() {
    $("save-assign").textContent =
      $("assign-project").value === "__new__"
        ? "Continue to new project"
        : "Add rule";
  }
  function close() {
    if (!state.saving) dialog.close();
  }
  $("assign-form").onsubmit = async (e) => {
    e.preventDefault();
    if (state.saving) return;
    const kind = $("assign-kind").value,
      value = $("assign-rule").value.trim();
    if (!value) {
      $("assign-error").textContent = "Enter a rule before continuing.";
      return;
    }
    try {
      const rule = normalizeRule({
        type: kind === "url" ? "url" : "title",
        mode: kind === "regex" ? "regex" : "text",
        pattern: value,
        appFilter: $("assign-app").value,
        from: $("assign-from").value,
        through: $("assign-through").value,
        ignoreCase: true,
      });
      if ($("assign-project").value === "__new__") {
        dialog.close();
        openEditor(null, rule);
        return;
      }
      const p = state.config.projects.find(
        (p) => p.id === $("assign-project").value,
      );
      if (!p) throw Error("Select an existing project or create a new one.");
      const next = normalizeProject(
        { ...p, rules: [...projectRules(p), rule] },
        state.config.projects,
      );
      state.saving = true;
      for (const id of ["save-assign", "cancel-assign", "close-assign"])
        $(id).disabled = true;
      await persist(
        state.config.projects.map((p) => (p.id === next.id ? next : p)),
      );
      dialog.close();
      render();
      notice(
        `Rule added to ${next.name}. Project totals have been recalculated.`,
        "success",
      );
    } catch (error) {
      $("assign-error").textContent = error.message;
    } finally {
      state.saving = false;
      for (const id of ["save-assign", "cancel-assign", "close-assign"])
        $(id).disabled = false;
    }
  };
  $("assign-kind").onchange = chooseKind;
  $("assign-project").onchange = updateSubmit;
  $("close-assign").onclick = close;
  $("cancel-assign").onclick = close;
  dialog.addEventListener("cancel", (e) => {
    if (state.saving) e.preventDefault();
  });
  $("close-unassigned").onclick = () => {
    open = false;
    panel.hidden = true;
    resizeFrame();
  };
  $("unassigned-search").oninput = () => {
    visibleLimit = 50;
    drawRows();
  };
  $("all-unassigned").onclick = () => show();
  return { update };
}

import { projectRules, normalizeRule } from "./rule-engine.mjs";
import {
  unassignedActivities,
  suggestedRule,
  activityTypeBreakdown,
} from "./unassigned-core.mjs";
import { merge, normalizeProject } from "./projects-core.mjs";
import { persistControl } from "./ui-prefs.mjs";
import { normalizeActivityType, addActivityMatcher } from "./activity-core.mjs";
export function setupUnassigned({
  state,
  persist,
  render,
  openEditor,
  openActivityType,
  notice,
  resizeFrame,
}) {
  const $ = (id) => document.getElementById(id);
  const intervalTime = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
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
    '<div class="section-heading"><div><h2>Not assigned · activities</h2><p id="unassigned-scope" class="muted"></p></div><button id="close-unassigned" aria-label="Close unassigned activities">×</button></div><div class="unassigned-tools"><input id="unassigned-search" type="search" aria-label="Search unassigned activities" placeholder="Search titles, applications, or URLs"><label id="hide-typed-label" class="check-label" title="Hide rows that match any activity type, leaving only completely unmarked activity"><input type="checkbox" id="hide-typed-unassigned"> Hide activities</label><button id="all-unassigned">Show whole day</button></div><p id="unassigned-count" class="muted"></p><div id="unassigned-rows"></div>';
  document.querySelector(".timeline-panel").after(panel);
  const dialog = document.createElement("dialog");
  dialog.id = "assign-dialog";
  dialog.innerHTML =
    '<form id="assign-form"><div class="dialog-heading"><h2>Add activity to a project</h2><button type="button" id="close-assign" aria-label="Close assignment">×</button></div><p id="assign-source" class="assignment-source"></p><label for="assign-project">Project</label><select id="assign-project"></select><label for="assign-kind">Match using</label><select id="assign-kind"><option value="keyword">Window title keyword</option><option value="url">Page URL</option><option value="regex">Window title regex</option></select><label for="assign-app">Application (optional)</label><input id="assign-app" list="recorded-apps" placeholder="Any app · e.g. Telegram"><label for="assign-rule">Rule to add</label><textarea id="assign-rule" rows="3" required></textarea><div class="rule-dates"><label>Valid from<input id="assign-from" type="date" aria-label="Assignment rule valid from"></label><label>Valid through<input id="assign-through" type="date" aria-label="Assignment rule valid through"></label></div><p id="assign-hint" class="field-help"></p><p class="field-help">This rule will apply to other matching activity and previously recorded days too.</p><p id="assign-error" class="error" role="alert"></p><div class="dialog-actions"><span class="spacer"></span><button id="cancel-assign" type="button">Cancel</button><button id="save-assign" class="primary" type="submit">Add rule</button></div></form>';
  document.body.append(dialog);
  const typeDialog = document.createElement("dialog");
  typeDialog.id = "type-assign-dialog";
  typeDialog.innerHTML =
    '<form id="type-assign-form"><div class="dialog-heading"><h2>Add activity to an activity type</h2><button type="button" id="close-type-assign" aria-label="Close activity type assignment">×</button></div><p id="type-assign-source" class="assignment-source"></p><label for="type-assign-type">Activity type</label><select id="type-assign-type"></select><label for="type-assign-kind">Match using</label><select id="type-assign-kind"><option value="url">Website URL</option><option value="application">Whole application</option><option value="app-title">Window title · in this application</option><option value="title">Window title · in any application</option></select><label for="type-assign-value">Value to add</label><input id="type-assign-value" required><p id="type-assign-hint" class="field-help"></p><p class="field-help">Activity types never change project attribution. The matcher applies to previously recorded days too.</p><p id="type-assign-error" class="error" role="alert"></p><div class="dialog-actions"><span class="spacer"></span><button id="cancel-type-assign" type="button">Cancel</button><button id="save-type-assign" class="primary" type="submit">Add to type</button></div></form>';
  document.body.append(typeDialog);
  function node(tag, cls, text) {
    const n = document.createElement(tag);
    n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  // Short visible label; the full wording stays as tooltip and accessible name.
  function actionButton(label, name, tip) {
    const b = node("button", "", label);
    b.setAttribute("aria-label", name);
    b.title = tip;
    return b;
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
    for (const block of $("timeline").children) {
      if (block.dataset.project === "unassigned") {
        const segment = {
          start: +block.dataset.start,
          end: +block.dataset.end,
        };
        block.classList.add("clickable");
        block.role = "button";
        block.tabIndex = 0;
        block.setAttribute(
          "aria-label",
          "Inspect unassigned interval " + intervalTime.format(segment.start),
        );
        block.onclick = () => show([segment.start, segment.end]);
        block.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            show([segment.start, segment.end]);
          }
        };
      }
    }
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
  const typeCache = new WeakMap();
  function rowTypes(row, typeResult) {
    let cached = typeCache.get(row);
    if (cached?.typeResult !== typeResult) {
      cached = {
        typeResult,
        found: activityTypeBreakdown(row.ranges, typeResult),
      };
      typeCache.set(row, cached);
    }
    return cached.found;
  }
  function drawRows() {
    const term = $("unassigned-search").value.trim().toLocaleLowerCase();
    const typeResult = state.activityTypeResult?.();
    const hasTypes = Boolean(typeResult?.projects.length);
    $("hide-typed-label").hidden = !hasTypes;
    const hideTyped = hasTypes && $("hide-typed-unassigned").checked;
    const matching = rows.filter((r) =>
      [r.title, r.app, r.url].join(" ").toLocaleLowerCase().includes(term),
    );
    // Rows carrying any activity type tag (including Type needs review).
    const filtered = hideTyped
      ? matching.filter((r) => !rowTypes(r, typeResult).length)
      : matching;
    const hidden = matching.length - filtered.length;
    $("unassigned-count").textContent =
      `${filtered.length} activities · ${time(filtered.reduce((n, r) => n + r.seconds, 0))}` +
      (hidden ? ` · ${hidden} with activity types hidden` : "");
    $("unassigned-rows").replaceChildren();
    for (const row of filtered.slice(0, visibleLimit)) {
      const card = node("article", "unassigned-row");
      const content = node("div", "activity-description");
      content.append(
        node("strong", "", row.title),
        node("div", "muted", row.app),
      );
      if (row.url) content.append(node("div", "activity-url", row.url));
      if (hasTypes) {
        const types = node("div", "activity-type-tags");
        const found = rowTypes(row, typeResult);
        let typed = 0;
        for (const t of found) {
          typed += t.seconds;
          const tag = node("span", "activity-type-tag");
          const chip = node("span", "chip");
          if (t.color) chip.style.background = t.color;
          else tag.classList.add("review");
          const share = Math.round((t.seconds / row.seconds) * 100);
          tag.append(
            chip,
            t.name +
              (share >= 100 ? "" : share < 1 ? " · <1%" : ` · ${share}%`),
          );
          types.append(tag);
        }
        if (row.seconds - typed > 1)
          types.append(
            node(
              "span",
              "activity-type-tag untyped",
              found.length ? "rest: no activity type" : "No activity type",
            ),
          );
        content.append(types);
      }
      const action = node("div", "activity-action");
      action.append(node("strong", "", time(row.seconds)));
      const button = actionButton(
        "+ Project",
        "Add to project",
        "Add a matching rule to a project",
      );
      button.onclick = () => assign(row);
      action.append(button);
      const typeButton = actionButton(
        "+ Type",
        "Add to activity type…",
        "Add this activity to an activity type",
      );
      typeButton.onclick = () => assignType(row);
      action.append(typeButton);
      const manual = actionButton(
        "Assign",
        "Assign time only",
        "Assign this time to a project once, without creating a rule",
      );
      manual.onclick = () => state.manualUI.open(row.ranges, row.title);
      action.append(manual);
      if (row.app) {
        const application = actionButton(
          "App time…",
          "Assign app time…",
          "Assign all unassigned time from this application in the selected report period, across every title.",
        );
        application.onclick = () => {
          const appRows = unassignedActivities(
            state.data,
            state.result,
            null,
          ).filter(
            (r) => r.app.toLocaleLowerCase() === row.app.toLocaleLowerCase(),
          );
          const ranges = merge(appRows.flatMap((r) => r.ranges));
          if (!ranges.length) return;
          state.manualUI.open(
            ranges,
            `${row.app} · unassigned application time`,
            `${row.app} · all titles · entire selected report period · unassigned time only`,
          );
        };
        action.append(application);
      }

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
          !rows.length
            ? "No unassigned activity in this period."
            : hidden
              ? "Every matching activity already has an activity type."
              : "No activities match this search.",
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
    placeDialog(dialog);
    dialog.showModal();
    $("assign-project").focus();
  }
  function placeDialog(d) {
    if (!window.frameElement) return;
    d.style.top = "16px";
    d.style.bottom = "auto";
    d.style.margin = "0 auto";
    d.style.maxHeight = Math.max(240, window.parent.innerHeight - 100) + "px";
    window.frameElement.scrollIntoView({ block: "start", behavior: "instant" });
  }
  function typeValue(kind) {
    if (kind === "url") return suggestedRule(selected).url;
    if (kind === "application") return selected.app;
    return suggestedRule(selected).keyword;
  }
  function chooseTypeKind() {
    const id = $("type-assign-type").value,
      type = (state.config.activityTypes || []).find((t) => t.id === id);
    const url = $("type-assign-kind").querySelector('[value="url"]');
    url.disabled = !typeValue("url");
    if (url.disabled && $("type-assign-kind").value === "url")
      $("type-assign-kind").value = "app-title";
    const kind = $("type-assign-kind").value;
    $("type-assign-value").value = typeValue(kind);
    // Say when an addition becomes a separate combination, so it is clear
    // that the type's existing app × title matching stays as it was.
    const separate =
      kind === "app-title" ||
      (type && kind === "title" && type.applications.length) ||
      (type && kind === "application" && type.titles.length);
    $("type-assign-hint").textContent =
      {
        url: "Matches this page and its subpages. Needs browser tracking.",
        application: "Matches every window of this application.",
        "app-title": `Matches ${selected.app} windows whose title contains this text.`,
        title:
          "Matches windows whose title contains this text, in any application.",
      }[kind] +
      (separate
        ? " Added as a separate combination; the type's other matchers are unchanged."
        : "");
    $("save-type-assign").textContent =
      id === "__new__" ? "Continue to new type" : "Add to type";
  }
  function assignType(row) {
    selected = row;
    $("type-assign-error").textContent = "";
    $("type-assign-source").textContent =
      row.title + " · " + row.app + " · " + time(row.seconds);
    $("type-assign-type").replaceChildren(
      ...(state.config.activityTypes || []).map(
        (t) => new Option(t.name, t.id),
      ),
      new Option("+ Create new activity type", "__new__"),
    );
    $("type-assign-kind").querySelector('[value="app-title"]').textContent =
      `Window title · in ${row.app}`;
    const suggested = suggestedRule(row);
    $("type-assign-kind").value =
      suggested.kind === "url"
        ? "url"
        : suggested.keyword
          ? "app-title"
          : "application";
    chooseTypeKind();
    placeDialog(typeDialog);
    typeDialog.showModal();
    $("type-assign-type").focus();
  }
  $("type-assign-type").onchange = chooseTypeKind;
  $("type-assign-kind").onchange = chooseTypeKind;
  $("type-assign-form").onsubmit = async (e) => {
    e.preventDefault();
    if (state.saving) return;
    const kind = $("type-assign-kind").value,
      value = $("type-assign-value").value.trim(),
      id = $("type-assign-type").value,
      types = state.config.activityTypes || [];
    try {
      if (id === "__new__") {
        if (!value) throw Error("Enter a value to match.");
        typeDialog.close();
        openActivityType({
          name: "",
          applications: kind === "application" ? [value] : [],
          titles: kind === "title" ? [value] : [],
          urls: kind === "url" ? [value] : [],
          combinations:
            kind === "app-title" ? [{ app: selected.app, title: value }] : [],
        });
        return;
      }
      const type = types.find((t) => t.id === id);
      if (!type) throw Error("Select an activity type.");
      const next = normalizeActivityType(
        addActivityMatcher(type, kind, value, selected.app),
        types,
      );
      state.saving = true;
      for (const b of [
        "save-type-assign",
        "cancel-type-assign",
        "close-type-assign",
      ])
        $(b).disabled = true;
      await persist(
        state.config.projects,
        state.config.manualAssignments || [],
        types.map((t) => (t.id === next.id ? next : t)),
      );
      typeDialog.close();
      render();
      notice(
        `Added to activity type ${next.name}. Project attribution is unchanged.`,
        "success",
      );
    } catch (error) {
      $("type-assign-error").textContent = error.message;
    } finally {
      state.saving = false;
      for (const b of [
        "save-type-assign",
        "cancel-type-assign",
        "close-type-assign",
      ])
        $(b).disabled = false;
    }
  };
  const closeType = () => {
    if (!state.saving) typeDialog.close();
  };
  $("close-type-assign").onclick = closeType;
  $("cancel-type-assign").onclick = closeType;
  typeDialog.addEventListener("cancel", (e) => {
    if (state.saving) e.preventDefault();
  });
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
  persistControl($("hide-typed-unassigned"), "hideTypedUnassigned");
  $("unassigned-search").oninput = $("hide-typed-unassigned").onchange = () => {
    visibleLimit = 50;
    drawRows();
  };
  $("all-unassigned").onclick = () => show();
  return { update };
}

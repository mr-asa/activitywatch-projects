import { placeDialog } from "./dialogs.mjs";
import {
  projectRules,
  normalizeRule,
  readableUrl,
  projectDatesBlock,
} from "./rule-engine.mjs";
import { addRule } from "./rule-groups.mjs";
import {
  unassignedActivities,
  suggestedRule,
  activityTypeBreakdown,
  untypedSeconds,
  urlLevels,
  urlCoverage,
  rulePreview,
} from "./unassigned-core.mjs";
import { merge, normalizeProject } from "./projects-core.mjs";
import { persistControl } from "./ui-prefs.mjs";
import {
  normalizeActivityType,
  addActivityMatcher,
  matcherPreview,
} from "./activity-core.mjs";
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
    '<div class="section-heading"><div><h2>Not assigned · activities</h2><p id="unassigned-scope" class="muted"></p></div><button id="close-unassigned" aria-label="Close unassigned activities">×</button></div><div class="unassigned-tools"><input id="unassigned-search" type="search" aria-label="Search unassigned activities" placeholder="Search titles, applications, or URLs"><label class="unassigned-sort">Sort<select id="unassigned-sort" aria-label="Sort unassigned activities"><option value="largest">Largest first</option><option value="recent">Most recent first</option></select></label><label id="hide-typed-label" class="check-label" title="Hide rows that match any activity type, leaving only completely unmarked activity"><input type="checkbox" id="hide-typed-unassigned"> Hide activities</label><button id="all-unassigned">Show whole day</button></div><p id="unassigned-count" class="muted"></p><div id="unassigned-rows"></div>';
  document.querySelector(".timeline-panel").after(panel);
  const dialog = document.createElement("dialog");
  dialog.id = "assign-dialog";
  dialog.innerHTML =
    '<form id="assign-form"><div class="dialog-heading"><h2>Add activity to a project</h2><button type="button" id="close-assign" aria-label="Close assignment">×</button></div><p id="assign-source" class="assignment-source"></p><label for="assign-project">Project</label><select id="assign-project"></select><label for="assign-kind">Match using</label><select id="assign-kind"><option value="keyword">Window title keyword</option><option value="url">Page URL</option><option value="regex">Window title regex</option></select><label for="assign-app">Application (optional)</label><input id="assign-app" list="recorded-apps" placeholder="Any app · e.g. Telegram"><label for="assign-rule">Rule to add</label><textarea id="assign-rule" rows="3" required></textarea><div id="assign-levels" class="url-levels" role="group" aria-label="Page URL level" hidden></div><p id="assign-coverage" class="field-help" role="status"></p><div class="rule-dates"><label>Valid from<input id="assign-from" type="date" aria-label="Assignment rule valid from"></label><label>Valid through<input id="assign-through" type="date" aria-label="Assignment rule valid through"></label></div><p id="assign-hint" class="field-help"></p><div id="assign-preview" class="match-preview" role="status" aria-label="Matches preview"></div><p class="field-help">This rule will apply to other matching activity and previously recorded days too.</p><p id="assign-error" class="error" role="alert"></p><div class="dialog-actions"><span class="spacer"></span><button id="cancel-assign" type="button">Cancel</button><button id="save-assign" class="primary" type="submit">Add rule</button></div></form>';
  document.body.append(dialog);
  const typeDialog = document.createElement("dialog");
  typeDialog.id = "type-assign-dialog";
  typeDialog.innerHTML =
    '<form id="type-assign-form"><div class="dialog-heading"><h2>Add activity to an activity type</h2><button type="button" id="close-type-assign" aria-label="Close activity type assignment">×</button></div><p id="type-assign-source" class="assignment-source"></p><label for="type-assign-type">Activity type</label><select id="type-assign-type"></select><label for="type-assign-kind">Match using</label><select id="type-assign-kind"><option value="url">Website URL</option><option value="application">Whole application</option><option value="app-title">Window title · in this application</option><option value="title">Window title · in any application</option></select><label for="type-assign-value">Value to add</label><input id="type-assign-value" required><p id="type-assign-hint" class="field-help"></p><div id="type-assign-preview" class="match-preview" role="status" aria-label="Matches preview"></div><p class="field-help">Activity types never change project attribution. The matcher applies to previously recorded days too.</p><p id="type-assign-error" class="error" role="alert"></p><div class="dialog-actions"><span class="spacer"></span><button id="cancel-type-assign" type="button">Cancel</button><button id="save-type-assign" class="primary" type="submit">Add to type</button></div></form>';
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
      : "Entire selected period";
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
      [r.title, r.app, r.url, readableUrl(r.url || "")]
        .join(" ")
        .toLocaleLowerCase()
        .includes(term),
    );
    // Rows carrying any activity type tag.
    const filtered = hideTyped
      ? matching.filter((r) => !rowTypes(r, typeResult).length)
      : matching;
    const hidden = matching.length - filtered.length;
    // Most recent: by the end of each activity's last interval, so what you
    // just worked on is at the top.
    const recent = $("unassigned-sort").value === "recent";
    const lastSeen = (r) => r.ranges.at(-1)?.[1] ?? 0;
    if (recent) filtered.sort((a, b) => lastSeen(b) - lastSeen(a));
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
      if (row.url) {
        const link = node("div", "activity-url", readableUrl(row.url));
        link.title = row.url;
        content.append(link);
      }
      if (hasTypes) {
        const types = node("div", "activity-type-tags");
        const found = rowTypes(row, typeResult);
        for (const t of found) {
          const tag = node("span", "activity-type-tag");
          const chip = node("span", "chip");
          if (t.color) chip.style.background = t.color;
          const share = Math.round((t.seconds / row.seconds) * 100);
          tag.append(
            chip,
            t.name +
              (share >= 100 ? "" : share < 1 ? " · <1%" : ` · ${share}%`),
          );
          types.append(tag);
        }
        if (untypedSeconds(row.ranges, typeResult) > 1)
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
      if (recent)
        action.append(
          node("span", "last-seen muted", `last ${seenAt(lastSeen(row))}`),
        );
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
  // URL rules: clickable path levels and how much unassigned time a rule covers.
  function drawLevels() {
    const box = $("assign-levels"),
      url = $("assign-kind").value === "url";
    box.hidden = !url;
    box.replaceChildren();
    if (!url) return;
    const current = $("assign-rule").value.trim();
    box.append(node("span", "url-levels-label", "Match from:"));
    urlLevels(selected.url).forEach((level, i) => {
      if (i) box.append(node("span", "url-levels-sep", level.query ? "" : "/"));
      const covered = urlCoverage(rows, level.value);
      const b = node("button", "url-level", level.label);
      b.type = "button";
      b.dataset.value = level.value;
      b.title = `${level.value}\n${covered.count} unassigned ${covered.count === 1 ? "entry" : "entries"} · ${time(covered.seconds)}`;
      b.setAttribute(
        "aria-label",
        `Match ${level.site ? "the whole site" : level.query ? "only this exact link" : level.label + " and below"}`,
      );
      b.setAttribute("aria-pressed", String(level.value === current));
      b.onclick = () => {
        $("assign-rule").value = level.value;
        drawLevels();
        coverage();
        rulePreviewSoon();
      };
      box.append(b);
    });
  }
  function coverage() {
    const out = $("assign-coverage");
    out.textContent = "";
    if ($("assign-kind").value !== "url") return;
    const value = $("assign-rule").value.trim();
    let site = false;
    try {
      site = new URL(value).pathname === "/";
    } catch {
      return;
    }
    const covered = urlCoverage(rows, value);
    out.textContent =
      `Matches ${covered.count} unassigned ${covered.count === 1 ? "entry" : "entries"} in this list · ${time(covered.seconds)}` +
      (site ? " · the whole site" : " · this folder and everything below it");
  }
  // Live preview: which entries the rule catches and how the totals change.
  let rulePreviewTimer = null;
  function rulePreviewSoon() {
    clearTimeout(rulePreviewTimer);
    rulePreviewTimer = setTimeout(drawRulePreview, 250);
  }
  function drawRulePreview() {
    const box = $("assign-preview");
    box.replaceChildren();
    if (!state.data || !state.result || !selected || !dialog.open) return;
    const value = $("assign-rule").value.trim();
    if (!value) return;
    const kind = $("assign-kind").value;
    const projectId = $("assign-project").value,
      project = state.config.projects.find((p) => p.id === projectId);
    let rule, next, added;
    try {
      rule = normalizeRule({
        type: kind === "url" ? "url" : "title",
        mode: kind === "regex" ? "regex" : "text",
        pattern: value,
        appFilter: $("assign-app").value,
        from: $("assign-from").value,
        through: $("assign-through").value,
        ignoreCase: true,
      });
      if (project) {
        added = addRule(projectRules(project), rule);
        const changed = normalizeProject(
          { ...project, rules: added.rules },
          state.config.projects,
        );
        next = state.config.projects.map((p) =>
          p.id === changed.id ? changed : p,
        );
      }
    } catch (error) {
      box.append(node("p", "error", error.message));
      return;
    }
    const preview = rulePreview(
      state.data,
      rule,
      state.start,
      state.resultEnd,
      {
        previous: added && !added.duplicate ? state.result : null,
        next,
        projectId,
        options: {
          host: state.host,
          manualAssignments: state.config.manualAssignments || [],
        },
      },
    );
    const own = preview.changes?.find((c) => c.id === projectId);
    box.append(
      node(
        "p",
        "match-preview-summary",
        added?.duplicate
          ? `${project.name} already has this pattern.`
          : !preview.total
            ? "Matches nothing in the loaded period. Check the text."
            : `Matches ${time(preview.total)} in the loaded period` +
              (own
                ? ` · ${project.name}: ${time(own.before)} → ${time(own.after)}`
                : project
                  ? ` · nothing new for ${project.name} (already counted, or claimed by a manual assignment)`
                  : ""),
      ),
    );
    const others = (preview.changes || []).filter((c) => c.id !== projectId);
    if (others.length) {
      const list = node("ul", "match-preview-list");
      for (const c of others) {
        const item = node("li", "");
        item.append(
          node("span", "", c.name),
          node(
            "span",
            "muted",
            ` · ${time(c.before)} → ${time(c.after)} (${c.after > c.before ? "+" : "−"}${time(Math.abs(c.after - c.before))})`,
          ),
        );
        list.append(item);
      }
      box.append(node("p", "muted", "Also changes:"), list);
    }
    if (preview.matches.length) {
      const list = node("ul", "match-preview-list");
      for (const m of preview.matches.slice(0, 8)) {
        const item = node("li", "");
        item.append(
          node("span", "", readableUrl(m.label)),
          node("span", "muted", ` · ${m.app} · ${time(m.seconds)}`),
        );
        list.append(item);
      }
      box.append(node("p", "muted", "Entries it catches:"), list);
      if (preview.matches.length > 8)
        box.append(
          node("p", "muted", `… and ${preview.matches.length - 8} more`),
        );
    }
    resizeFrame();
  }
  function chooseKind() {
    $("assign-app").disabled = $("assign-kind").value === "url";
    const suggested = suggestedRule(selected),
      kind = $("assign-kind").value;
    $("assign-rule").value =
      kind === "url" ? readableUrl(suggested.url) : suggested.keyword;
    $("assign-hint").textContent =
      kind === "url"
        ? "Use a project-specific URL. Its subpages also match; a homepage would match the whole site."
        : kind === "regex"
          ? "Enter a JavaScript regex without / delimiters. Matching ignores capitalization."
          : "Use a distinctive part of the title. Matching ignores capitalization.";
    drawLevels();
    coverage();
    rulePreviewSoon();
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
  function typeValue(kind) {
    if (kind === "url") return readableUrl(suggestedRule(selected).url);
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
    typePreview();
  }
  // Live preview: what the matcher catches in the loaded report period.
  let previewTimer = null;
  function typePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(drawTypePreview, 150);
  }
  function drawTypePreview() {
    const box = $("type-assign-preview");
    box.replaceChildren();
    if (!state.data || !selected) return;
    const id = $("type-assign-type").value,
      type = (state.config.activityTypes || []).find((t) => t.id === id);
    let preview;
    try {
      preview = matcherPreview(
        state.data,
        type || null,
        $("type-assign-kind").value,
        $("type-assign-value").value,
        selected.app,
        state.start,
        state.resultEnd,
      );
    } catch {
      return;
    }
    const summary = node(
      "p",
      "match-preview-summary",
      preview.total
        ? `Matches ${time(preview.total)} in the loaded period` +
            (!type
              ? ""
              : preview.added > 0
                ? ` · adds ${time(preview.added)} to ${type.name}`
                : ` · already counted in ${type.name}`)
        : "Matches nothing in the loaded period. Check the text.",
    );
    box.append(summary);
    if (!preview.matches.length) return;
    const list = node("ul", "match-preview-list");
    for (const m of preview.matches.slice(0, 8)) {
      const item = node("li", "");
      item.append(
        node("span", "", readableUrl(m.label)),
        node("span", "muted", ` · ${m.app} · ${time(m.seconds)}`),
      );
      list.append(item);
    }
    box.append(list);
    if (preview.matches.length > 8)
      box.append(
        node("p", "muted", `… and ${preview.matches.length - 8} more`),
      );
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
  $("type-assign-value").oninput = typePreview;
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
      const added = addRule(projectRules(p), rule);
      // The project's own dates can keep even a matching rule away from
      // this activity: say so, and offer to widen them.
      const blocked = projectDatesBlock(rule, p, selected.ranges || []);
      if (blocked) {
        const limits = [
          p.rulesFrom && `start on ${p.rulesFrom}`,
          p.rulesThrough && `end on ${p.rulesThrough}`,
        ]
          .filter(Boolean)
          .join(" and ");
        const days =
          blocked.first === blocked.last
            ? blocked.first
            : `${blocked.first} – ${blocked.last}`;
        const widen = node(
          "button",
          "",
          `Widen ${p.name}'s dates to include it`,
        );
        widen.type = "button";
        widen.onclick = () =>
          saveRule(
            {
              ...p,
              rulesFrom: blocked.rulesFrom,
              rulesThrough: blocked.rulesThrough,
            },
            added,
            `${p.name}'s automatic rules now cover ${days}.`,
          );
        $("assign-error").replaceChildren(
          `${p.name}'s automatic rules ${limits}, but this activity is from ${days}` +
            (added.duplicate
              ? `, so its existing pattern does not apply. `
              : `. `),
          widen,
        );
        return;
      }
      if (added.duplicate) {
        $("assign-error").textContent =
          `${p.name} already has this pattern in a rule group with the same settings.`;
        return;
      }
      await saveRule(
        p,
        added,
        `${added.merged ? "Pattern added to an existing rule group" : "Rule added"} in ${p.name}.`,
      );
    } catch (error) {
      $("assign-error").textContent = error.message;
    }
  };
  // Saves a project with the rule list from addRule (unchanged when the
  // pattern was already there) after the usual preview.
  async function saveRule(project, added, message) {
    if (state.saving) return;
    try {
      const next = normalizeProject(
        { ...project, rules: added.rules },
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
      notice(`${message} Project totals have been recalculated.`, "success");
    } catch (error) {
      $("assign-error").textContent = error.message;
    } finally {
      state.saving = false;
      for (const id of ["save-assign", "cancel-assign", "close-assign"])
        $(id).disabled = false;
    }
  }
  $("assign-kind").onchange = chooseKind;
  for (const id of ["assign-app", "assign-from", "assign-through"])
    $(id).oninput = rulePreviewSoon;
  $("assign-rule").oninput = () => {
    rulePreviewSoon();
    if ($("assign-kind").value !== "url") return;
    const current = $("assign-rule").value.trim();
    for (const b of $("assign-levels").querySelectorAll(".url-level"))
      b.setAttribute("aria-pressed", String(b.dataset.value === current));
    coverage();
  };
  $("assign-project").onchange = () => {
    updateSubmit();
    rulePreviewSoon();
  };
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
  persistControl($("unassigned-sort"), "unassignedSort");
  // Time only for one-day reports; date and time otherwise.
  const seenAt = (ms) =>
    new Date(ms).toLocaleString(
      [],
      state.end - state.start > 90000000
        ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
        : { hour: "2-digit", minute: "2-digit" },
    );
  $("unassigned-search").oninput =
    $("hide-typed-unassigned").onchange =
    $("unassigned-sort").onchange =
      () => {
        visibleLimit = 50;
        drawRows();
      };
  $("all-unassigned").onclick = () => show();
  return { update };
}

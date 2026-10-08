import { placeDialog } from "./dialogs.mjs";
import {
  projectRules,
  normalizeRule,
  readableUrl,
  projectDatesBlock,
} from "./rule-engine.mjs";
import { addRule } from "./rule-groups.mjs";
import { regexHelp } from "./regex-help.mjs";
import {
  suggestedRule,
  urlLevels,
  urlCoverage,
  rulePreview,
} from "./unassigned-core.mjs";
import { normalizeProject, analyze } from "./projects-core.mjs";
import {
  normalizeActivityType,
  addTypeRule,
  analyzeActivityTypes,
} from "./activity-core.mjs";

// One dialog to turn an activity into a rule of a project or of an activity
// type: whole application, window title (text or regex), or page URL, with
// optional application, dates and a live preview of what it would change.
export function setupAddRuleDialog({
  state,
  persist,
  render,
  openEditor,
  openActivityType,
  notice,
  resizeFrame,
  rows,
}) {
  const $ = (id) => document.getElementById(id);
  const time = (s) => {
    s = Math.round(s);
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
  };
  const node = (tag, cls, text) => {
    const n = document.createElement(tag);
    n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  let selected = null;
  const dialog = document.createElement("dialog");
  dialog.id = "assign-dialog";
  dialog.innerHTML =
    '<form id="assign-form"><div class="dialog-heading"><h2>Add activity to a rule</h2><button type="button" id="close-assign" aria-label="Close assignment">×</button></div><p id="assign-source" class="assignment-source"></p><label for="assign-target-kind">Add to</label><select id="assign-target-kind"><option value="project">Project</option><option value="type">Activity type</option></select><label for="assign-project" id="assign-project-label">Project</label><select id="assign-project"></select><label for="assign-kind">Match using</label><select id="assign-kind"><option value="keyword">Window title keyword</option><option value="application">Whole application</option><option value="url">Page URL</option><option value="regex">Window title regex</option></select><label for="assign-app" id="assign-app-label">Application (optional)</label><div class="assign-app-row"><input id="assign-app" list="recorded-apps" placeholder="Any app · e.g. Telegram"><button type="button" id="assign-use-app" hidden></button></div><label for="assign-rule" id="assign-rule-label">Rule to add</label><textarea id="assign-rule" rows="3" required></textarea><div id="assign-levels" class="url-levels" role="group" aria-label="Page URL level" hidden></div><p id="assign-coverage" class="field-help" role="status"></p><div class="rule-dates"><label>Valid from<input id="assign-from" type="date" aria-label="Assignment rule valid from"></label><label>Valid through<input id="assign-through" type="date" aria-label="Assignment rule valid through"></label></div><p id="assign-hint" class="field-help"></p><div id="assign-preview" class="match-preview" role="status" aria-label="Matches preview"></div><p id="assign-note" class="field-help"></p><p id="assign-error" class="error" role="alert"></p><div class="dialog-actions"><span class="spacer"></span><button id="cancel-assign" type="button">Cancel</button><button id="save-assign" class="primary" type="submit">Add rule</button></div></form>';
  document.body.append(dialog);
  const assignHelp = regexHelp();
  $("assign-hint").after(assignHelp);

  const isType = () => $("assign-target-kind").value === "type";
  const types = () => state.config.activityTypes || [];
  function fillTargets() {
    const select = $("assign-project");
    select.replaceChildren();
    if (isType()) {
      for (const t of types()) select.append(new Option(t.name, t.id));
      select.append(new Option("+ Create new activity type", "__new__"));
    } else {
      for (const p of state.config.projects.filter((p) => !p.archived))
        select.append(
          new Option(
            p.name + (p.kind === "non-project" ? " (non-project)" : ""),
            p.id,
          ),
        );
      select.append(new Option("+ Create new project", "__new__"));
    }
    $("assign-project-label").textContent = isType()
      ? "Activity type"
      : "Project";
    $("assign-note").textContent = isType()
      ? "Activity types never change project attribution. The rule applies to previously recorded days too."
      : "This rule will apply to other matching activity and previously recorded days too.";
    updateSubmit();
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
      const covered = urlCoverage(rows(), level.value);
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
        previewSoon();
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
    const covered = urlCoverage(rows(), value);
    out.textContent =
      `Matches ${covered.count} unassigned ${covered.count === 1 ? "entry" : "entries"} in this list · ${time(covered.seconds)}` +
      (site ? " · the whole site" : " · this folder and everything below it");
  }
  // What the rule field starts with for each way of matching.
  function suggestedValue(kind) {
    const suggested = suggestedRule(selected);
    return kind === "url"
      ? readableUrl(suggested.url)
      : kind === "application"
        ? selected.app
        : suggested.keyword;
  }
  function chooseKind() {
    const kind = $("assign-kind").value;
    const wholeApp = kind === "application";
    $("assign-app").disabled = kind === "url" || wholeApp;
    $("assign-app-label").hidden = $("assign-app").parentElement.hidden =
      wholeApp;
    $("assign-use-app").hidden = !selected.app || kind === "url" || wholeApp;
    $("assign-rule-label").textContent = wholeApp
      ? "Application"
      : "Rule to add";
    $("assign-rule").value = suggestedValue(kind);
    assignHelp.hidden = kind !== "regex";
    $("assign-hint").textContent =
      kind === "url"
        ? "Use a project-specific URL. Its subpages also match; a homepage would match the whole site."
        : wholeApp
          ? "Matches every window of this application, whatever its title."
          : kind === "regex"
            ? "Enter a JavaScript regex without / delimiters. Matching ignores capitalization."
            : "Use a distinctive part of the title. Matching ignores capitalization.";
    drawLevels();
    coverage();
    previewSoon();
  }
  function buildRule() {
    const kind = $("assign-kind").value,
      value = $("assign-rule").value.trim();
    return normalizeRule({
      type:
        kind === "url"
          ? "url"
          : kind === "application"
            ? "application"
            : "title",
      mode: kind === "regex" ? "regex" : "text",
      pattern: value,
      appFilter: $("assign-app").value,
      from: $("assign-from").value,
      through: $("assign-through").value,
      ignoreCase: true,
    });
  }

  // Live preview: which entries the rule catches and how the totals change.
  let previewTimer = null;
  function previewSoon() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(drawPreview, 250);
  }
  function drawPreview() {
    const box = $("assign-preview");
    box.replaceChildren();
    if (!state.data || !state.result || !selected || !dialog.open) return;
    if (!$("assign-rule").value.trim()) return;
    const targetId = $("assign-project").value,
      type = isType(),
      target = (type ? types() : state.config.projects).find(
        (t) => t.id === targetId,
      );
    let rule,
      next = null,
      added = null;
    try {
      rule = buildRule();
      if (target && type) {
        added = addTypeRule(target, rule);
        next = types().map((t) => (t.id === target.id ? added.type : t));
      } else if (target) {
        added = addRule(projectRules(target), rule);
        const changed = normalizeProject(
          { ...target, rules: added.rules },
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
    const options = {
      host: state.host,
      manualAssignments: state.config.manualAssignments || [],
    };
    const preview = rulePreview(
      state.data,
      rule,
      state.start,
      state.resultEnd,
      {
        previous:
          added && !added.duplicate
            ? type
              ? state.activityTypeResult?.()
              : state.result
            : null,
        next,
        projectId: targetId,
        unassignedName: type ? "No activity type" : "Not assigned",
        analyzer: type
          ? (data, list, start, end) =>
              analyzeActivityTypes(data, list, start, end)
          : (data, list, start, end) =>
              analyze(data, list, start, end, options),
      },
    );
    const own = preview.changes?.find((c) => c.id === targetId);
    box.append(
      node(
        "p",
        "match-preview-summary",
        added?.duplicate
          ? `${target.name} already has this pattern.`
          : !preview.total
            ? "Matches nothing in the loaded period. Check the text."
            : `Matches ${time(preview.total)} in the loaded period` +
              (own
                ? ` · ${target.name}: ${time(own.before)} → ${time(own.after)}`
                : target
                  ? ` · nothing new for ${target.name} (already counted${type ? "" : ", or claimed by a manual assignment"})`
                  : ""),
      ),
    );
    const others = (preview.changes || []).filter((c) => c.id !== targetId);
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

  // `target` picks what the dialog starts with: "project" or "type".
  function open(row, target = "project") {
    selected = row;
    $("assign-target-kind").value = target;
    $("assign-from").value = "";
    $("assign-through").value = "";
    $("assign-error").textContent = "";
    $("assign-source").textContent = [row.title, row.app, time(row.seconds)]
      .filter(Boolean)
      .join(" · ");
    $("assign-use-app").textContent = `Use ${row.app}`;
    const suggested = suggestedRule(row);
    $("assign-kind").querySelector('[value="url"]').disabled = !suggested.url;
    $("assign-kind").querySelector('[value="application"]').disabled = !row.app;
    // Projects start from the title keyword or link; types, which usually
    // describe a kind of tool, from the application the title came from.
    $("assign-kind").value =
      suggested.kind === "url"
        ? "url"
        : target === "type" && !suggested.keyword && row.app
          ? "application"
          : "keyword";
    $("assign-app").value = target === "type" ? row.app || "" : "";
    fillTargets();
    chooseKind();
    placeDialog(dialog);
    dialog.showModal();
    $("assign-project").focus();
  }
  function updateSubmit() {
    $("save-assign").textContent =
      $("assign-project").value === "__new__"
        ? isType()
          ? "Continue to new type"
          : "Continue to new project"
        : "Add rule";
  }
  function close() {
    if (!state.saving) dialog.close();
  }
  function busy(value) {
    for (const id of ["save-assign", "cancel-assign", "close-assign"])
      $(id).disabled = value;
  }

  $("assign-form").onsubmit = async (e) => {
    e.preventDefault();
    if (state.saving) return;
    if (!$("assign-rule").value.trim()) {
      $("assign-error").textContent = "Enter a rule before continuing.";
      return;
    }
    try {
      const rule = buildRule();
      const type = isType(),
        targetId = $("assign-project").value;
      if (targetId === "__new__") {
        dialog.close();
        if (type) openActivityType({ name: "", rules: [rule] });
        else openEditor(null, rule);
        return;
      }
      if (type) {
        const current = types().find((t) => t.id === targetId);
        if (!current) throw Error("Select an activity type.");
        const added = addTypeRule(current, rule);
        if (added.duplicate) {
          $("assign-error").textContent =
            `${current.name} already has this pattern in a rule group with the same settings.`;
          return;
        }
        const next = normalizeActivityType(added.type, types());
        await save(
          () =>
            persist(
              state.config.projects,
              state.config.manualAssignments || [],
              types().map((t) => (t.id === next.id ? next : t)),
            ),
          `Added to activity type ${next.name}. Project attribution is unchanged.`,
        );
        return;
      }
      const p = state.config.projects.find((p) => p.id === targetId);
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
          saveProjectRule(
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
      await saveProjectRule(
        p,
        added,
        `${added.merged ? "Pattern added to an existing rule group" : "Rule added"} in ${p.name}.`,
      );
    } catch (error) {
      $("assign-error").textContent = error.message;
    }
  };
  // Runs a save with the dialog locked, then closes it and reports.
  async function save(run, message) {
    if (state.saving) return;
    try {
      state.saving = true;
      busy(true);
      await run();
      dialog.close();
      render();
      notice(message, "success");
    } catch (error) {
      $("assign-error").textContent = error.message;
    } finally {
      state.saving = false;
      busy(false);
    }
  }
  // Saves a project with the rule list from addRule (unchanged when the
  // pattern was already there).
  function saveProjectRule(project, added, message) {
    return save(async () => {
      const next = normalizeProject(
        { ...project, rules: added.rules },
        state.config.projects,
      );
      await persist(
        state.config.projects.map((p) => (p.id === next.id ? next : p)),
      );
    }, `${message} Project totals have been recalculated.`);
  }

  $("assign-target-kind").onchange = () => {
    fillTargets();
    previewSoon();
  };
  $("assign-kind").onchange = chooseKind;
  $("assign-rule").oninput = () => {
    previewSoon();
    if ($("assign-kind").value !== "url") return;
    const current = $("assign-rule").value.trim();
    for (const b of $("assign-levels").querySelectorAll(".url-level"))
      b.setAttribute("aria-pressed", String(b.dataset.value === current));
    coverage();
  };
  for (const id of ["assign-app", "assign-from", "assign-through"])
    $(id).oninput = previewSoon;
  $("assign-use-app").onclick = () => {
    $("assign-app").value = selected.app;
    previewSoon();
  };
  $("assign-project").onchange = () => {
    updateSubmit();
    previewSoon();
  };
  $("close-assign").onclick = close;
  $("cancel-assign").onclick = close;
  dialog.addEventListener("cancel", (e) => {
    if (state.saving) e.preventDefault();
  });
  return { open };
}

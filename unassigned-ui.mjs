import { readableUrl } from "./rule-engine.mjs";
import {
  unassignedActivities,
  activityTypeBreakdown,
  untypedSeconds,
} from "./unassigned-core.mjs";
import { merge } from "./projects-core.mjs";
import { persistControl } from "./ui-prefs.mjs";
import { setupAddRuleDialog } from "./add-rule-dialog.mjs";
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
  const addDialog = setupAddRuleDialog({
    state,
    persist,
    render,
    openEditor,
    openActivityType,
    notice,
    resizeFrame,
    rows: () => rows,
  });
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
      button.onclick = () => addDialog.open(row, "project");
      action.append(button);
      const typeButton = actionButton(
        "+ Type",
        "Add to activity type…",
        "Add this activity to an activity type",
      );
      typeButton.onclick = () => addDialog.open(row, "type");
      action.append(typeButton);
      const manual = actionButton(
        "Assign",
        "Assign time only",
        "Assign this time to a project once, without creating a rule",
      );
      manual.onclick = () =>
        state.manualUI.open(
          row.ranges,
          row.title,
          [row.title, row.app].filter(Boolean).join(" · "),
        );
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

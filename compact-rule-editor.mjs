import { editorValue, merge, intersect, duration } from "./projects-core.mjs";
import { regexHelp } from "./regex-help.mjs";
import {
  projectRules,
  ruleMatches,
  clipRule,
  readableUrl,
} from "./rule-engine.mjs";
import { groupRules, expandGroup } from "./rule-groups.mjs";
import { matchTitle, matchUrl } from "./projects-core.mjs";

// The rule editor shared by projects and activity types: rule groups (a
// field, a mode, an optional application, dates and one pattern per line)
// with a live preview. `cutoff()` returns a date after which the rules being
// tried stop (a project's common end date).
export function createRuleEditor({
  state,
  ids = {
    section: "rule-editor",
    rows: "rule-rows",
    add: "add-rule",
  },
  title = "Automatic rules",
  cutoff = () => "",
}) {
  const section = document.createElement("section");
  section.id = ids.section;
  section.className = "rule-editor";
  section.innerHTML = `<div class="section-heading"><div><h3></h3><p class="field-help">One alternative per line. Patterns in a group share the same application and date limits.</p></div><button type="button" id="${ids.add}">+ Add rule group</button></div><div id="${ids.rows}" class="rule-rows"></div><p class="field-help">Blank application = any app. Blank dates = no limit. Date limits include both selected dates.</p>`;
  section.querySelector("h3").textContent = title;
  const rows = section.querySelector(".rule-rows");
  const apps =
    document.getElementById("recorded-apps") ||
    document.body.appendChild(
      Object.assign(document.createElement("datalist"), {
        id: "recorded-apps",
      }),
    );
  function add(input = {}) {
    const group = {
      type: "title",
      mode: "text",
      ignoreCase: true,
      from: "",
      through: "",
      appFilter: "",
      entries: [],
      ...input,
    };
    const card = document.createElement("div");
    card.className = "rule-row compact-rule";
    card._entries = group.entries;
    card.innerHTML =
      '<div class="compact-controls"><label>Field<select data-key="type" aria-label="Rule field"><option value="title">Window title</option><option value="application">Application</option><option value="url">Browser URL</option><option value="editor-project">Editor project / vault path</option><option value="editor-file">Editor file / note path</option></select></label><label class="mode-label">Match mode<select data-key="mode" aria-label="Match mode"><option value="text">Plain text</option><option value="regex">Regex</option></select></label><label class="app-filter-label">Application (optional)<input data-key="appFilter" aria-label="Application filter" list="recorded-apps" placeholder="Any app · e.g. Telegram or maya.exe"></label><label class="check-label case-label"><input data-key="ignoreCase" type="checkbox"> Ignore case</label></div><div class="compact-body"><label><span class="patterns-label">Patterns · one per line</span><textarea data-key="patterns" rows="3" aria-label="Rule pattern" placeholder="TEAM CHAT&#10;SHARED TITLE"></textarea></label><div class="compact-dates"><label>Valid from<input data-key="from" aria-label="Valid from" type="date"></label><label>Valid through<input data-key="through" aria-label="Valid through" type="date"></label></div></div><div class="compact-footer"><p class="rule-mode-hint field-help"></p><div class="rule-actions"><button type="button" class="preview-rule">Preview matches</button><button type="button" class="remove-rule">Remove group</button></div></div><div class="rule-preview" role="status"></div>';
    for (const key of ["type", "mode", "appFilter", "from", "through"])
      card.querySelector(`[data-key="${key}"]`).value = group[key];
    card.querySelector('[data-key="ignoreCase"]').checked = group.ignoreCase;
    const area = card.querySelector('[data-key="patterns"]');
    area.value = group.entries
      .map((r) => (group.type === "url" ? readableUrl(r.pattern) : r.pattern))
      .join("\n");
    area.rows = Math.min(6, Math.max(3, group.entries.length));
    const help = regexHelp();
    card.querySelector(".compact-body").after(help);
    const hint = () => {
      const mode = card.querySelector('[data-key="mode"]').value,
        type = card.querySelector('[data-key="type"]').value;
      const application = type === "application";
      help.hidden = application || mode !== "regex";
      card.querySelector(".app-filter-label").hidden =
        type === "url" || application;
      card.querySelector(".mode-label").hidden = application;
      card.querySelector(".case-label").hidden = application;
      card.querySelector(".patterns-label").textContent = application
        ? "Applications · one per line"
        : "Patterns · one per line";
      area.placeholder = application
        ? "Telegram\nmaya.exe"
        : "TEAM CHAT\nSHARED TITLE";
      card.querySelector(".rule-mode-hint").textContent = application
        ? "Application names, as in the activity list (Telegram, maya.exe). Every window of the application matches, whatever its title."
        : mode === "regex"
          ? "One JavaScript regex per line, without / delimiters."
          : type === "url"
            ? "Full links; subpages and matching query parameters included."
            : "Title fragments. Case-insensitive text also ignores [modified].";
    };
    hint();
    for (const key of ["type", "mode"])
      card.querySelector(`[data-key="${key}"]`).onchange = hint;
    card.querySelector(".remove-rule").onclick = () => card.remove();
    // Live preview: the whole group, or only the line the cursor is on.
    let timer = null;
    const schedule = () => {
      if (!card._previewed) return;
      clearTimeout(timer);
      timer = setTimeout(() => drawPreview(card), 200);
    };
    card.querySelector(".preview-rule").onclick = () => {
      card._previewed = true;
      drawPreview(card);
    };
    for (const type of ["input", "keyup", "click", "blur"])
      area.addEventListener(type, schedule);
    area.addEventListener("focus", () => {
      card._previewed = true;
      schedule();
    });
    card.addEventListener("change", schedule);
    rows.append(card);
    return card;
  }
  function readInput(card) {
    const input = {};
    for (const key of [
      "type",
      "mode",
      "appFilter",
      "patterns",
      "from",
      "through",
    ])
      input[key] = card.querySelector(`[data-key="${key}"]`).value;
    input.ignoreCase = card.querySelector('[data-key="ignoreCase"]').checked;
    return input;
  }
  function readRow(card) {
    return expandGroup(readInput(card), card._entries);
  }
  // The project's cutoff date narrows every rule being tried.
  function withCutoff(rules) {
    const end = cutoff();
    return rules.map((rule) =>
      end && (!rule.through || end < rule.through)
        ? { ...rule, through: end }
        : rule,
    );
  }
  // The line under the caret, only while the pattern box has focus.
  function activeLine(card) {
    const area = card.querySelector('[data-key="patterns"]');
    if (document.activeElement !== area) return null;
    const index =
      area.value.slice(0, area.selectionStart).split("\n").length - 1;
    const pattern = area.value.split("\n")[index]?.trim();
    return pattern ? { index, pattern } : null;
  }
  // Recorded events the rules match in the loaded period: their time and the
  // time per title / link / application.
  function scan(rules) {
    const type = rules[0].type;
    const editor = type.startsWith("editor-");
    const events = editor
      ? (state.data?.editors || []).flatMap((source) =>
          source.events.map((e) => ({
            ...e,
            data: { ...e.data, app: source.app },
          })),
        )
      : type === "title" || type === "application"
        ? state.data?.windows || []
        : (state.data?.browsers || []).flatMap((b) => b.events);
    const all = [],
      labels = new Map();
    for (const e of events) {
      const start = Date.parse(e.timestamp);
      const from = Math.max(start, state.start),
        to = Math.min(start + e.duration * 1000, state.end);
      if (to <= from) continue;
      const value = editor
        ? editorValue(e, type)
        : e.data[type === "url" ? "url" : "title"];
      for (const rule of rules) {
        const pieces = clipRule([[from, to]], rule);
        if (
          !pieces.length ||
          !ruleMatches(rule, value, matchTitle, matchUrl, e.data.app)
        )
          continue;
        all.push(...pieces);
        const label =
          type === "application"
            ? e.data.app
            : type === "title"
              ? `${value} · ${e.data.app}`
              : value;
        labels.set(label, [...(labels.get(label) || []), ...pieces]);
        break;
      }
    }
    return { type, ranges: merge(all), labels };
  }
  const clock = (seconds) => {
    const s = Math.round(seconds);
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
  };
  function drawPreview(card) {
    const out = card.querySelector(".rule-preview");
    out.replaceChildren();
    const line = activeLine(card);
    const text = (tag, value, cls = "") => {
      const n = document.createElement(tag);
      n.textContent = value;
      if (cls) n.className = cls;
      return n;
    };
    try {
      const group = withCutoff(readRow(card)),
        input = readInput(card);
      let rules = group,
        others = [];
      if (line) {
        rules = withCutoff(
          expandGroup({ ...input, patterns: line.pattern }, []),
        );
        const rest = input.patterns
          .split("\n")
          .filter((v, i) => i !== line.index && v.trim())
          .join("\n");
        if (rest) {
          try {
            others = withCutoff(expandGroup({ ...input, patterns: rest }, []));
          } catch {}
        }
      }
      const found = scan(rules);
      const noun = found.type.startsWith("editor-")
        ? "editor records"
        : found.type === "application"
          ? "applications"
          : found.type === "title"
            ? "titles"
            : "URLs";
      out.append(
        text(
          "strong",
          line
            ? `Line ${line.index + 1} only · ${line.pattern}`
            : `Whole group · ${group.length} ${group.length === 1 ? "pattern" : "patterns"}`,
          "rule-preview-head",
        ),
      );
      let summary = found.labels.size
        ? `${found.labels.size} matching ${noun} · ${clock(duration(found.ranges))} in the loaded report period`
        : "Matches nothing in the loaded report period.";
      if (line && others.length && found.labels.size) {
        const covered = scan(others).ranges;
        const added =
          duration(found.ranges) - duration(intersect(found.ranges, covered));
        summary += ` · ${clock(added)} not covered by the other lines`;
      }
      out.append(text("p", summary));
      const ul = document.createElement("ul");
      for (const [label, seconds] of [...found.labels]
        .map(([l, r]) => [l, duration(merge(r))])
        .sort((x, y) => y[1] - x[1])
        .slice(0, 8))
        ul.append(
          text(
            "li",
            `${found.type === "url" ? readableUrl(label) : label} · ${clock(seconds)}`,
          ),
        );
      out.append(ul);
      if (found.labels.size > 8)
        out.append(text("p", `… and ${found.labels.size - 8} more`, "muted"));
    } catch (e) {
      out.append(text("p", e.message, "error"));
    }
  }
  section.querySelector(".section-heading button").onclick = () => add();
  return {
    element: section,
    // Rule groups from existing rules (and an optional new rule to start from).
    load(rules = [], seed = null) {
      rows.replaceChildren();
      for (const g of groupRules([...rules, ...(seed ? [seed] : [])])) add(g);
      apps.replaceChildren(
        ...[
          ...new Set(
            (state.data?.windows || []).map((e) => e.data.app).filter(Boolean),
          ),
        ]
          .sort()
          .map((app) => new Option(app, app)),
      );
    },
    read() {
      return [...rows.children].flatMap(readRow);
    },
    add,
  };
}

// The project editor: moves the name and color fields side by side and puts
// the rule editor in place of the old keyword and link boxes.
export function setupRuleEditor({ state }) {
  const $ = (id) => document.getElementById(id);
  let current = document.querySelector('label[for="project-keywords"]');
  while (current && current.id !== "form-error") {
    const next = current.nextElementSibling;
    current.remove();
    current = next;
  }
  const meta = document.createElement("div");
  meta.className = "project-meta";
  const name = document.createElement("div"),
    color = document.createElement("div");
  const nameLabel = document.querySelector('label[for="project-name"]');
  nameLabel.before(meta);
  name.append(nameLabel, $("project-name"));
  color.append(
    document.querySelector('label[for="project-color"]'),
    document.querySelector(".color-row"),
  );
  meta.append(name, color);
  const editor = createRuleEditor({
    state,
    cutoff: () => $("project-rules-through")?.value || "",
  });
  $("form-error").before(editor.element);
  editor.element.addEventListener("input", () => {
    $("form-error").textContent = "";
  });
  return {
    load: (p, seed) => editor.load(p ? projectRules(p) : [], seed),
    read: editor.read,
    add: editor.add,
  };
}

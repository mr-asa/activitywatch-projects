import { intersect } from "./projects-core.mjs";
import { normalizeAssignment } from "./rule-engine.mjs";
export function setupManual({ state, persist, render, notice }) {
  const $ = (id) => document.getElementById(id);
  const button = document.createElement("button");
  button.id = "assign-interval";
  button.textContent = "Assign interval";
  document.querySelector(".tools").prepend(button);
  const panel = document.createElement("details");
  panel.className = "help";
  panel.id = "manual-list";
  panel.innerHTML =
    '<summary>Manual assignments <span id="manual-count"></span></summary><p class="field-help">Overrides automatic rules only during the chosen interval and on this device. Only recorded non-idle activity counts. Removing an assignment restores automatic matching.</p><div id="manual-items"></div>';
  document.querySelector("footer").before(panel);
  const dialog = document.createElement("dialog");
  dialog.id = "manual-dialog";
  dialog.innerHTML =
    '<form id="manual-form"><div class="dialog-heading"><h2>Assign a time interval</h2><button type="button" id="close-manual" aria-label="Close manual assignment">×</button></div><label for="manual-project">Project</label><select id="manual-project" required></select><div id="manual-occurrences" hidden><label for="manual-occurrence">Recorded interval</label><select id="manual-occurrence"></select><p class="field-help">Assign all occurrences from this row, or choose one interval to adjust. From and Until trim the selected occurrences. Gaps are not included. Dropdown durations use seconds (s), including fractions, before trimming.</p></div><p id="manual-scope" class="field-help" role="status"></p><label for="manual-start">From (local time)</label><input id="manual-start" type="datetime-local" step="0.001" required><label for="manual-end">Until (local time)</label><input id="manual-end" type="datetime-local" step="0.001" required><label for="manual-note">Note (optional)</label><input id="manual-note" maxlength="200" placeholder="e.g. TEAM CHAT discussion for Demo"><p class="field-help">All occurrences assigns only the listed intervals. A custom interval assigns recorded active time inside it, including other applications. Neither option creates a future matching rule.</p><p id="manual-error" class="error" role="alert"></p><div class="dialog-actions"><span class="spacer"></span><button id="cancel-manual" type="button">Cancel</button><button id="save-manual" type="submit" class="primary">Assign time</button></div></form>';
  document.body.append(dialog);
  function local(ms) {
    const d = new Date(ms);
    const z = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
  }
  const secondsLabel = (milliseconds) =>
    `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(milliseconds / 1000)} s`;
  let occurrences = [];
  function times(range) {
    $("manual-start").value = local(range[0]);
    $("manual-end").value = local(range[1]);
  }
  function isAll() {
    return occurrences.length > 1 && $("manual-occurrence").value === "all";
  }
  function selectedRanges() {
    const start = +new Date($("manual-start").value),
      end = +new Date($("manual-end").value);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      throw Error("Until must be later than From.");
    const ranges = isAll()
      ? intersect(occurrences, [[start, end]])
      : [[start, end]];
    if (!ranges.length)
      throw Error("No occurrences inside these limits. Widen From or Until.");
    return ranges;
  }
  function updateScope() {
    $("save-manual").textContent = isAll()
      ? "Assign selected occurrences"
      : "Assign time";
    try {
      const ranges = selectedRanges();
      const seconds = Math.round(
        ranges.reduce((sum, [start, end]) => sum + (end - start) / 1000, 0),
      );
      $("manual-scope").textContent = isAll()
        ? `${ranges.length} of ${occurrences.length} occurrences selected · ${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}s. From and Until trim this row only; gaps stay unchanged.`
        : "One editable interval. The save preview shows the active time that will be assigned.";
      $("manual-error").textContent = "";
      $("save-manual").disabled = state.saving;
    } catch (e) {
      $("manual-scope").textContent = e.message;
      $("save-manual").disabled = true;
    }
  }
  function selectionChanged() {
    if (isAll())
      times([
        Math.min(...occurrences.map((r) => r[0])),
        Math.max(...occurrences.map((r) => r[1])),
      ]);
    else if (occurrences.length)
      times(occurrences[Number($("manual-occurrence").value) || 0]);
    updateScope();
  }
  function open(ranges = null, note = "") {
    if (!state.config || !state.result) return;
    occurrences = ranges?.length ? ranges : [];
    $("manual-project").replaceChildren(
      ...state.config.projects.map((p) => new Option(p.name, p.id)),
    );
    $("manual-error").textContent = "";
    $("manual-note").value = note;
    $("manual-occurrences").hidden = occurrences.length < 2;
    $("manual-occurrence").replaceChildren(
      ...occurrences.map(
        (r, i) =>
          new Option(
            `${new Date(r[0]).toLocaleString()} – ${new Date(r[1]).toLocaleTimeString()} · ${secondsLabel(r[1] - r[0])}`,
            String(i),
          ),
      ),
    );
    if (occurrences.length > 1) {
      $("manual-occurrence").prepend(
        new Option(
          `All occurrences in this row · ${secondsLabel(occurrences.reduce((sum, [start, end]) => sum + end - start, 0))}`,
          "all",
        ),
      );
      $("manual-occurrence").value = "all";
    }
    const end = Math.min(state.end, Date.now());
    times(occurrences[0] || [Math.max(state.start, end - 15 * 60000), end]);
    selectionChanged();
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
  const close = () => {
    if (!state.saving) dialog.close();
  };
  $("manual-occurrence").onchange = selectionChanged;
  $("manual-start").oninput = updateScope;
  $("manual-end").oninput = updateScope;
  $("close-manual").onclick = close;
  $("cancel-manual").onclick = close;
  dialog.addEventListener("cancel", (e) => {
    if (state.saving) e.preventDefault();
  });
  button.onclick = () => open();
  $("manual-form").onsubmit = async (e) => {
    e.preventDefault();
    if (state.saving) return;
    try {
      const ranges = selectedRanges();
      const items = [];
      for (const [start, end] of ranges)
        items.push(
          normalizeAssignment(
            {
              projectId: $("manual-project").value,
              host: state.host,
              start,
              end,
              note: $("manual-note").value,
            },
            state.config.projects,
            [...(state.config.manualAssignments || []), ...items],
          ),
        );
      state.saving = true;
      $("save-manual").disabled = true;
      await persist(state.config.projects, [
        ...(state.config.manualAssignments || []),
        ...items,
      ]);
      dialog.close();
      render();
      notice(
        `${items.length} interval${items.length === 1 ? "" : "s"} assigned. Automatic rules are unchanged.`,
        "success",
      );
    } catch (e) {
      $("manual-error").textContent = e.message;
    } finally {
      state.saving = false;
      $("save-manual").disabled = false;
    }
  };
  async function remove(id) {
    if (state.saving) return;
    state.saving = true;
    try {
      await persist(
        state.config.projects,
        (state.config.manualAssignments || []).filter((a) => a.id !== id),
      );
      render();
      notice(
        "Manual assignment removed. Automatic matching restored.",
        "success",
      );
    } catch (e) {
      notice(e.message, "error");
    } finally {
      state.saving = false;
    }
  }
  function update() {
    button.disabled = !state.config?.projects.length;
    const assignments = (state.config.manualAssignments || []).filter(
      (a) => a.host === state.host,
    );
    $("manual-count").textContent = `(${assignments.length})`;
    $("manual-items").replaceChildren();
    for (const a of assignments) {
      const row = document.createElement("div");
      row.className = "manual-item";
      const label = document.createElement("span");
      const project = state.config.projects.find((p) => p.id === a.projectId);
      label.textContent = `${project?.name || "Deleted project"} · ${new Date(a.start).toLocaleString()} – ${new Date(a.end).toLocaleString()}${a.note ? " · " + a.note : ""}`;
      const del = document.createElement("button");
      del.textContent = "Remove";
      del.onclick = () => {
        del.textContent = "Confirm removal";
        del.onclick = () => remove(a.id);
      };
      row.append(label, del);
      $("manual-items").append(row);
    }
    const blocks = [...$("timeline").children];
    state.result.segments.forEach((s, i) => {
      if (blocks[i]) {
        blocks[i].ondblclick = () => open([[s.start, s.end]]);
        blocks[i].title += " · Double-click to assign this interval";
      }
    });
  }
  return { open, update };
}

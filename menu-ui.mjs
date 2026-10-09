import { pref, setPref } from "./ui-prefs.mjs";
import { addView, hasView, pageName } from "./menu-core.mjs";
const $ = (id) => document.getElementById(id);
// When the dashboard is opened on its own (not inside ActivityWatch) and
// ActivityWatch has no menu entry for it, offers to add one: a view in the
// `views` setting, the same thing "Activity → New view → Custom
// visualization" creates by hand.
export async function setupMenuEntry({ api }) {
  const name = pageName(location.pathname);
  if (!name || window.top !== window || pref("menuEntryDismissed", false))
    return;
  let views;
  try {
    views = await api("settings/views");
  } catch {
    return;
  }
  if (hasView(views, name)) return;
  const box = $("menu-banner");
  const text = document.createElement("span");
  text.textContent =
    "ActivityWatch has no menu entry for this page yet. Add “Projects” to its Activity menu? ";
  const add = document.createElement("button");
  add.textContent = "Add to menu";
  const later = document.createElement("button");
  later.textContent = "Not now";
  const never = document.createElement("button");
  never.textContent = "Don't ask again";
  const status = document.createElement("span");
  box.replaceChildren(text, add, " ", later, " ", never, status);
  box.hidden = false;
  later.onclick = () => {
    box.hidden = true;
  };
  never.onclick = () => {
    setPref("menuEntryDismissed", true);
    box.hidden = true;
  };
  add.onclick = async () => {
    add.disabled = true;
    try {
      // Re-read right before writing so views added meanwhile are kept.
      const current = await api("settings/views");
      if (!hasView(current, name))
        await api("settings/views", addView(current, name));
      status.textContent =
        " Added. Reload the ActivityWatch window (Ctrl+F5): Activity → Projects.";
    } catch (error) {
      add.disabled = false;
      status.textContent = ` Could not add it: ${error.message}`;
    }
  };
}

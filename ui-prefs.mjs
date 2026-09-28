// Per-browser view preferences. They never go to ActivityWatch settings, so
// they stay out of revisions and backups. Storage can be unavailable (private
// windows, blocked site data), so every access falls back silently.
const KEY = "activitywatch-projects.view";
function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}
export function pref(name, fallback) {
  const value = read()[name];
  return value === undefined ? fallback : value;
}
export function setPref(name, value) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [name]: value }));
  } catch {}
}
// Restores a control that exists at setup time and saves every change.
// Existing onchange/oninput handlers keep working alongside.
export function persistControl(el, name) {
  const prop = el.type === "checkbox" ? "checked" : "value";
  const saved = pref(name);
  if (
    saved !== undefined &&
    (el.tagName !== "SELECT" || [...el.options].some((o) => o.value === saved))
  )
    el[prop] = saved;
  const save = () => setPref(name, el[prop]);
  el.addEventListener("change", save);
  if (el.type === "number") el.addEventListener("input", save);
}
// For selects whose options are rebuilt later: the value to select now.
export function restoredOption(el, name, current) {
  const wanted = pref(name, current);
  return [...el.options].some((o) => o.value === wanted) ? wanted : current;
}

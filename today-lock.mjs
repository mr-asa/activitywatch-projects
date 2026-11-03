// The "Today lock" toggle shared by the report's period bar and the workload
// chart: a button whose pressed state (kept per browser) makes the last day
// follow today. `onChange(on, byUser)` lets each panel disable its date
// fields and, for a click, reload.
import { pref, setPref } from "./ui-prefs.mjs";

export function setupTodayLock({ button, prefName, onChange }) {
  button.classList.add("today-lock");
  button.setAttribute("aria-pressed", String(pref(prefName, false)));
  const lock = {
    get on() {
      return button.getAttribute("aria-pressed") === "true";
    },
    set(on, byUser = false) {
      button.setAttribute("aria-pressed", String(on));
      setPref(prefName, on);
      onChange?.(on, byUser);
    },
  };
  button.addEventListener("click", () => lock.set(!lock.on, true));
  return lock;
}

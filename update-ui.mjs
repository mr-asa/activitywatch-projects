import { pref, setPref } from "./ui-prefs.mjs";
import {
  REPO,
  MANUAL_COMMAND,
  checkDue,
  isNewer,
  parseRelease,
} from "./update-core.mjs";
const $ = (id) => document.getElementById(id);
const node = (tag, className, text) => {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
};
async function installedVersion() {
  try {
    const response = await fetch(new URL("./version.json", location.href), {
      cache: "no-store",
    });
    return response.ok ? String((await response.json()).version) : "";
  } catch {
    return "";
  }
}
async function latestRelease() {
  const response = await fetch(
    `https://api.github.com/repos/${REPO}/releases/latest`,
    { headers: { Accept: "application/vnd.github+json" } },
  );
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return parseRelease(await response.json());
}
// Shows the installed version and, at most once a day, asks GitHub whether a
// newer release exists. The "Update" button starts the local updater through
// the awprojects:// protocol that install.ps1 registers; if the installed
// version does not change, the manual command is shown instead.
export async function setupUpdates() {
  const current = await installedVersion();
  if (current) {
    $("app-version").textContent = `v${current}`;
    $("app-version").hidden = false;
  }
  // Browser automation (tests) never contacts GitHub unless asked to.
  const automated =
    navigator.webdriver &&
    !new URLSearchParams(location.search).has("updatecheck");
  if (!current || automated || pref("updateCheck", true) === false) return;
  let release = pref("updateRelease", null);
  if (checkDue(pref("updateChecked", NaN))) {
    try {
      release = await latestRelease();
      setPref("updateRelease", release);
      setPref("updateChecked", Date.now());
    } catch {
      return; // offline or rate-limited: try again on the next page load
    }
  }
  if (release && isNewer(release.version, current)) banner(release, current);
}
function banner(release, current) {
  const box = $("update-banner");
  const text = node(
    "span",
    "",
    `Version ${release.version} is available (you have ${current}). `,
  );
  const update = node("button", "", "Update");
  const dismiss = node("button", "", "Later");
  const status = node("span", "muted");
  box.replaceChildren(text, update, " ", dismiss, status);
  if (release.url) {
    const link = node("a", "", "What's new");
    link.href = release.url;
    link.target = "_blank";
    link.rel = "noopener";
    text.append(link, " ");
  }
  box.hidden = false;
  dismiss.onclick = () => {
    box.hidden = true;
  };
  update.onclick = async () => {
    update.disabled = true;
    status.textContent = " Updating…";
    const link = node("a");
    link.href = "awprojects://update";
    link.click();
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if ((await installedVersion()) !== current) {
        status.textContent = " Updated, reloading…";
        location.reload();
        return;
      }
    }
    manual(box);
  };
}
function manual(box) {
  const help = node("div", "update-manual");
  help.append(
    node(
      "p",
      "muted",
      "The one-click updater did not respond (it exists only when installed with install.ps1). Run this in PowerShell, then press Ctrl+F5:",
    ),
  );
  const command = node("code", "", MANUAL_COMMAND);
  const copy = node("button", "", "Copy");
  copy.onclick = () => navigator.clipboard?.writeText(MANUAL_COMMAND);
  help.append(command, " ", copy);
  box.append(help);
}

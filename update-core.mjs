// Update check: pure helpers. The network call lives in update-ui.mjs.
export const REPO = "mr-asa/activitywatch-projects";
export const CHECK_INTERVAL_MS = 24 * 3600 * 1000;
// "v1.2.3" or "1.2.3" (a pre-release suffix is ignored) → [1, 2, 3]; else null.
export function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? "").trim());
  return match ? match.slice(1).map(Number) : null;
}
export function isNewer(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
// GitHub "latest release" JSON → { version, url, notes } or null.
export function parseRelease(release) {
  if (!release || release.draft || release.prerelease) return null;
  if (!parseVersion(release.tag_name)) return null;
  const url = String(release.html_url ?? "");
  return {
    version: release.tag_name.replace(/^v/, ""),
    url: url.startsWith(`https://github.com/${REPO}/`) ? url : "",
    notes: String(release.body ?? "").slice(0, 2000),
  };
}
export function checkDue(lastChecked, now = Date.now()) {
  return !(
    Number.isFinite(lastChecked) && now - lastChecked < CHECK_INTERVAL_MS
  );
}
export const MANUAL_COMMAND = `irm https://github.com/${REPO}/releases/latest/download/install.ps1 | iex`;

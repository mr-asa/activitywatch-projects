import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { addView, hasView, pageName } from "./menu-core.mjs";
import {
  isNewer,
  parseRelease,
  parseVersion,
  checkDue,
  manualCommand,
} from "./update-core.mjs";
const json = (name) => JSON.parse(readFileSync(name, "utf8"));
const files = json("runtime-files.json");
test("every runtime file exists and the version is in sync", () => {
  for (const file of files) assert.ok(existsSync(file), file);
  assert.ok(parseVersion(json("version.json").version));
  assert.equal(json("package.json").version, json("version.json").version);
});
test("runtime modules only import files that are shipped", () => {
  for (const file of files.filter((f) => f.endsWith(".mjs"))) {
    for (const [, target] of readFileSync(file, "utf8").matchAll(
      /from\s+"\.\/([^"]+)"/g,
    ))
      assert.ok(files.includes(target), `${file} imports ${target}`);
  }
  const page = readFileSync("index.html", "utf8");
  for (const [, target] of page.matchAll(/(?:src|href)="\.\/([^"]+)"/g))
    assert.ok(files.includes(target), `index.html uses ${target}`);
});
test("version comparison", () => {
  assert.ok(isNewer("0.10.0", "0.9.9"));
  assert.ok(isNewer("v1.0.0", "0.99.0"));
  assert.ok(!isNewer("0.2.0", "0.2.0"));
  assert.ok(!isNewer("0.1.9", "0.2.0"));
  assert.ok(!isNewer("garbage", "0.2.0"));
});
test("release parsing ignores drafts, pre-releases and foreign links", () => {
  const base = {
    tag_name: "v0.3.0",
    html_url:
      "https://github.com/mr-asa/activitywatch-projects/releases/tag/v0.3.0",
    body: "x",
  };
  assert.equal(parseRelease(base).version, "0.3.0");
  assert.equal(parseRelease({ ...base, prerelease: true }), null);
  assert.equal(parseRelease({ ...base, draft: true }), null);
  assert.equal(
    parseRelease({ ...base, html_url: "https://evil.example/" }).url,
    "",
  );
});
test("the check runs at most once a day", () => {
  assert.ok(checkDue(NaN));
  assert.ok(!checkDue(1000, 1000 + 3600e3));
  assert.ok(checkDue(1000, 1000 + 25 * 3600e3));
});
test("menu entry: page name, detection and a non-destructive addition", () => {
  assert.equal(pageName("/pages/projects/"), "projects");
  assert.equal(pageName("/"), "");
  const views = [
    { id: "summary", name: "Summary", elements: [{ type: "top_apps" }] },
  ];
  assert.ok(!hasView(views, "projects"));
  const next = addView(views, "projects");
  assert.equal(next.length, 2);
  assert.equal(next[0], views[0]);
  assert.ok(hasView(next, "projects"));
  assert.equal(addView([{ id: "projects" }], "projects")[1].id, "projects-2");
});
test("the manual command matches the platform", () => {
  assert.match(manualCommand("Win32"), /install.ps1 | iex$/);
  assert.match(manualCommand("Linux x86_64"), /install.sh | sh$/);
});

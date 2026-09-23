import assert from "node:assert/strict";
import {
  analyze,
  matchUrl,
  normalizeProject,
  discoverBrowsers,
} from "./projects-core.mjs";
const event = (s, d, data) => ({
  timestamp: new Date(s * 1000).toISOString(),
  duration: d,
  data,
});
const p = {
  id: "demo",
  name: "DEMO",
  color: "#65d6b4",
  keywords: ["demo", "demo"],
  urls: ["https://example.com/project/demo"],
};
const data = {
  windows: [
    event(0, 60, { app: "chrome.exe", title: "Example - Cent Browser" }),
    event(60, 30, { app: "Obsidian.exe", title: "demo project-notes" }),
  ],
  afk: [
    event(0, 40, { status: "not-afk" }),
    event(40, 10, { status: "afk" }),
    event(50, 40, { status: "not-afk" }),
  ],
  browsers: [
    {
      family: "chrome",
      events: [
        event(0, 90, { url: "https://example.com/project/demo/render" }),
      ],
    },
  ],
};
let r = analyze(data, [p], 0, 90000);
assert.equal(r.assigned, 80);
assert.equal(r.projects[0].browser, 50);
assert.equal(r.projects[0].desktop, 30);
data.windows[0].data.title = "DEMO - Cent Browser";
assert.equal(analyze(data, [p], 0, 90000).assigned, 80);
const q = { ...p, id: "other", name: "Other", keywords: [], urls: [...p.urls] };
r = analyze(data, [p, q], 0, 90000);
assert.equal(r.conflict, 50);
assert.equal(r.assigned, 30);
assert.equal(r.tracked, r.assigned + r.conflict + r.unassigned);
assert.equal(analyze(data, [p], 20000, 70000).assigned, 40);
assert.equal(
  analyze({ ...data, browsers: [] }, [{ ...p, keywords: [] }], 0, 90000)
    .assigned,
  0,
);
assert(matchUrl("https://example.com/project/demo/render?a=b", p.urls[0]));
assert(!matchUrl("https://example.com/project/demox", p.urls[0]));
assert(!matchUrl("https://evil.test/?url=" + p.urls[0], p.urls[0]));
assert(
  !matchUrl("https://youtube.com/watch?v=B", "https://youtube.com/watch?v=A"),
);
assert(
  matchUrl(
    "https://youtube.com/watch?v=A&t=1",
    "https://youtube.com/watch?v=A",
  ),
);
assert(
  matchUrl(
    "https://example.com/%D1%82%D0%B5%D1%81%D1%82/file",
    "https://example.com/тест",
  ),
);
assert.throws(() => normalizeProject({ ...p, name: "" }), /name/);
assert.throws(
  () => normalizeProject({ ...p, urls: ["not a url"] }),
  /full link/,
);
assert.equal(
  normalizeProject({ ...p, keywords: [], urls: [] }).rules.length,
  0,
);
assert.equal(
  normalizeProject({ ...p, keywords: "DEMO\nDEMO" }).keywords.length,
  1,
);
assert.equal(
  discoverBrowsers(
    {
      "aw-watcher-web-chrome_HOST": {
        type: "web.tab.current",
        hostname: "HOST",
      },
      "aw-watcher-web-chrome": { type: "web.tab.current", hostname: "unknown" },
    },
    "HOST",
  ).sources.length,
  1,
);
console.log(
  "PASS: projects, colors, URL query/path boundaries, Unicode, foreground, AFK, date clipping, deduplication, and conflicts",
);

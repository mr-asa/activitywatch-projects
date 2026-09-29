import assert from "node:assert/strict";
import { analyze } from "./projects-core.mjs";
import {
  addActivityMatcher,
  activityRules,
  normalizeActivityType,
  parseCombinations,
  formatCombinations,
} from "./activity-core.mjs";
import {
  subtract,
  unassignedActivities,
  suggestedRule,
  activityTypeBreakdown,
} from "./unassigned-core.mjs";
const e = (s, d, data) => ({
  timestamp: new Date(s * 1000).toISOString(),
  duration: d,
  data,
});

// Independent per-second oracle: original window and browser order wins an
// overlap. Inputs include duplicates, nested intervals, AFK gaps and scopes.
let seed = 381;
const random = (n) => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % n;
};
for (let trial = 0; trial < 60; trial++) {
  const windows = Array.from({ length: 45 }, (_, i) =>
    e(random(120), random(30) + 1, {
      app: i % 2 ? "chrome.exe" : "Code.exe",
      title: `Activity ${i % 7}`,
    }),
  );
  windows.push(windows[0]);
  const web = Array.from({ length: 20 }, (_, i) =>
    e(random(120), random(35) + 1, { url: `https://example.com/${i % 4}` }),
  );
  const fixture = {
    windows,
    browsers: [{ family: "chrome", events: web }],
    afk: [e(0, 50, { status: "not-afk" }), e(60, 60, { status: "not-afk" })],
  };
  const result = analyze(
    fixture,
    [{ id: "assigned", keywords: ["Activity 0"] }],
    0,
    120000,
  );
  const scope = trial % 2 ? [20000, 100000] : null;
  const expected = new Map();
  const contains = (event, second) =>
    Date.parse(event.timestamp) / 1000 <= second &&
    Date.parse(event.timestamp) / 1000 + event.duration > second;
  for (let second = scope ? 20 : 0; second < (scope ? 100 : 120); second++) {
    if (
      !result.segments.some(
        (s) =>
          s.project === "unassigned" &&
          s.start <= second * 1000 &&
          s.end > second * 1000,
      )
    )
      continue;
    const w = windows.find((event) => contains(event, second));
    const url =
      w.data.app === "chrome.exe"
        ? web.find((event) => contains(event, second))?.data.url || ""
        : "";
    const key = JSON.stringify([w.data.app, w.data.title, url]);
    expected.set(key, (expected.get(key) || 0) + 1);
  }
  const actual = new Map(
    unassignedActivities(fixture, result, scope).map((row) => [
      JSON.stringify([row.app, row.title, row.url]),
      row.seconds,
    ]),
  );
  assert.deepEqual(actual, expected, `overlap ownership trial ${trial}`);
}
const data = {
  windows: [
    e(0, 100, { app: "chrome.exe", title: "Shared title" }),
    e(100, 50, { app: "maya.exe", title: "Scene B" }),
  ],
  afk: [
    e(0, 60, { status: "not-afk" }),
    e(60, 20, { status: "afk" }),
    e(80, 70, { status: "not-afk" }),
  ],
  browsers: [
    {
      family: "chrome",
      events: [
        e(0, 50, { url: "https://example.com/a" }),
        e(50, 50, { url: "https://example.com/b" }),
      ],
    },
  ],
};
const projects = [
  {
    id: "a",
    name: "A",
    keywords: [],
    urls: ["https://example.com/a"],
    color: "#65d6b4",
  },
];
const result = analyze(data, projects, 0, 150000);
const rows = unassignedActivities(data, result);
assert.equal(result.unassigned, 80);
assert.equal(
  rows.reduce((n, r) => n + r.seconds, 0),
  80,
);
assert.equal(rows[0].title, "Scene B");
assert.equal(rows[0].seconds, 50);
assert.equal(rows[1].url, "https://example.com/b");
assert.equal(rows[1].seconds, 30);
assert.equal(
  unassignedActivities(data, result, [85000, 110000]).reduce(
    (n, r) => n + r.seconds,
    0,
  ),
  25,
);
assert.equal(
  unassignedActivities({ ...data, browsers: [] }, result).reduce(
    (n, r) => n + r.seconds,
    0,
  ),
  80,
);
assert.equal(
  unassignedActivities(
    { ...data, windows: [...data.windows, ...data.windows] },
    result,
  ).reduce((n, r) => n + r.seconds, 0),
  80,
);
assert.deepEqual(
  subtract(
    [[0, 10]],
    [
      [2, 4],
      [6, 12],
    ],
  ),
  [
    [0, 2],
    [4, 6],
  ],
);
assert.equal(
  suggestedRule({ title: "*test_001 - ComfyUI", url: "http://127.0.0.1:8188/" })
    .kind,
  "keyword",
);
assert.equal(
  suggestedRule({ title: "*test_001 - ComfyUI", url: "" }).keyword,
  "test_001 - ComfyUI",
);
assert.equal(
  suggestedRule({ title: "Disk", url: "https://example.com/a" }).kind,
  "url",
);
console.log(
  "PASS: unassigned duration reconciliation, URL split, AFK, interval filter, missing browser data, duplicate intervals, and safe suggestions",
);

// Cached lists are scoped to immutable data/result snapshots and preserve first-source precedence.
const overlapData = {
  windows: [e(0, 20, { app: "chrome.exe", title: "Overlap" })],
  afk: [e(0, 20, { status: "not-afk" })],
  browsers: [
    {
      family: "chrome",
      events: [
        e(10, 10, { url: "https://example.com/first" }),
        e(0, 20, { url: "https://example.com/second" }),
      ],
    },
  ],
};
const overlapResult = analyze(overlapData, [], 0, 20000);
const grouped = unassignedActivities(overlapData, overlapResult);
assert.equal(grouped.find((r) => r.url.endsWith("/first")).seconds, 10);
assert.equal(grouped.find((r) => r.url.endsWith("/second")).seconds, 10);
assert.strictEqual(unassignedActivities(overlapData, overlapResult), grouped);
assert.equal(
  unassignedActivities(overlapData, overlapResult, [15000, 20000])[0].seconds,
  5,
);
assert.equal(
  unassignedActivities(overlapData, { ...overlapResult, segments: [] }).length,
  0,
);
const typeResult = {
  projects: [{ id: "chat", name: "Chat", color: "#112233" }],
  segments: [
    { start: 0, end: 30000, project: "chat" },
    { start: 30000, end: 40000, project: "conflict" },
    { start: 40000, end: 60000, project: "unassigned" },
  ],
};
assert.deepEqual(
  activityTypeBreakdown([[10000, 50000]], typeResult).map((t) => [
    t.id,
    t.seconds,
  ]),
  [
    ["chat", 20],
    ["conflict", 10],
  ],
);
assert.deepEqual(activityTypeBreakdown([[0, 1000]], null), []);
const appType = {
  id: "chat",
  name: "Chat",
  color: "#112233",
  applications: ["Telegram"],
  titles: [],
  urls: [],
  mode: "text",
};
assert.deepEqual(
  addActivityMatcher(appType, "application", "Discord.exe").applications,
  ["Telegram", "Discord.exe"],
);
assert.deepEqual(addActivityMatcher(appType, "url", "https://t.me/").urls, [
  "https://t.me/",
]);
// Additions that would change the app × title meaning become combinations.
const withTitle = addActivityMatcher(appType, "title", "Chat");
assert.deepEqual(withTitle.applications, ["Telegram"]);
assert.deepEqual(withTitle.titles, []);
assert.deepEqual(withTitle.combinations, [{ app: "", title: "Chat" }]);
assert.deepEqual(
  addActivityMatcher(
    { ...appType, applications: [], titles: ["x"] },
    "application",
    "Code",
  ).combinations,
  [{ app: "Code", title: "" }],
);
const inApp = normalizeActivityType(
  addActivityMatcher(appType, "app-title", "OpenCode", "Obsidian.exe"),
);
assert.deepEqual(inApp.combinations, [
  { app: "Obsidian.exe", title: "OpenCode" },
]);
assert.deepEqual(
  activityRules(inApp).map((r) => [r.appFilter, r.mode, r.pattern]),
  [
    ["Telegram", "regex", ".*"],
    ["Obsidian.exe", "text", "OpenCode"],
  ],
);
assert.throws(
  () => addActivityMatcher(appType, "app-title", "OpenCode", ""),
  /no application/,
);
assert.deepEqual(
  parseCombinations("Obsidian | OpenCode\r\n | Jupyter\nFigma |"),
  [
    { app: "Obsidian", title: "OpenCode" },
    { app: "", title: "Jupyter" },
    { app: "Figma", title: "" },
  ],
);
assert.equal(
  formatCombinations(parseCombinations("Obsidian | OpenCode")),
  "Obsidian | OpenCode",
);
assert.throws(() => parseCombinations("Obsidian OpenCode"), /App \| title/);
assert.deepEqual(
  addActivityMatcher(
    { ...appType, applications: [], titles: ["a"], mode: "regex" },
    "title",
    "Doc (1).txt",
  ).titles,
  ["a", String.raw`Doc \(1\)\.txt`],
);
assert.throws(() => addActivityMatcher(appType, "url", "  "), /Enter a value/);

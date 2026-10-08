import assert from "node:assert/strict";
import { analyze } from "./projects-core.mjs";
import { normalizeRule } from "./rule-engine.mjs";
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
  untypedSeconds,
  rulePreview,
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
  [["chat", 20]],
);
assert.equal(untypedSeconds([[10000, 50000]], typeResult), 10);
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
// URL levels: site, each folder, and the exact link with its query.
{
  const { urlLevels, urlCoverage } = await import("./unassigned-core.mjs");
  const { readableUrl } = await import("./rule-engine.mjs");
  const link =
    "https://disk.example.com/a/%D0%BF%D1%80%D0%BE%D0%B5%D0%BA%D1%82%20X/MOV?id=1";
  assert.equal(
    readableUrl(link),
    "https://disk.example.com/a/проект X/MOV?id=1",
  );
  assert.equal(
    readableUrl("https://example.com/%E0%A4%A"),
    "https://example.com/%E0%A4%A",
  );
  assert.deepEqual(
    urlLevels(link).map((l) => l.label),
    ["disk.example.com", "a", "проект X", "MOV", "?id=1"],
  );
  assert.deepEqual(urlLevels("file:///C:/x"), []);
  const rows = [
    { url: link, seconds: 30 },
    {
      url: "https://disk.example.com/a/%D0%BF%D1%80%D0%BE%D0%B5%D0%BA%D1%82%20X",
      seconds: 20,
    },
    {
      url: "https://disk.example.com/a/%D0%BF%D1%80%D0%BE%D0%B5%D0%BA%D1%82%20XY",
      seconds: 5,
    },
    { title: "no url", seconds: 99 },
  ];
  assert.deepEqual(urlCoverage(rows, urlLevels(link)[2].value), {
    count: 2,
    seconds: 50,
  });
  assert.equal(urlCoverage(rows, urlLevels(link)[0].value).count, 3);
}
// Matcher preview: own time, time added to the type, matching titles.
{
  const { matcherPreview } = await import("./activity-core.mjs");
  const t0 = Date.parse("2026-09-22T10:00:00Z");
  const w = (offset, seconds, app, title) => ({
    timestamp: new Date(t0 + offset * 1000).toISOString(),
    duration: seconds,
    data: { app, title },
  });
  const data = {
    windows: [
      w(0, 60, "chrome.exe", "Qwen Studio - Browser"),
      w(60, 120, "chrome.exe", "Qwen Chat - Browser"),
      w(180, 60, "Telegram.exe", "Qwen group"),
    ],
    afk: [w(0, 240, "", "")].map((e) => ({
      ...e,
      data: { status: "not-afk" },
    })),
    browsers: [],
  };
  const type = {
    id: "llm",
    name: "LLM",
    color: "#8ca8ff",
    applications: [],
    titles: ["Qwen Chat"],
    urls: [],
    combinations: [],
    mode: "text",
  };
  const end = t0 + 240000;
  const inChrome = matcherPreview(
    data,
    type,
    "app-title",
    "Qwen",
    "chrome.exe",
    t0,
    end,
  );
  assert.equal(inChrome.total, 180);
  assert.equal(inChrome.added, 60);
  assert.deepEqual(
    inChrome.matches.map((m) => [m.label, m.app, m.seconds]),
    [
      ["Qwen Chat - Browser", "chrome.exe", 120],
      ["Qwen Studio - Browser", "chrome.exe", 60],
    ],
  );
  const anywhere = matcherPreview(data, null, "title", "qwen", "", t0, end);
  assert.equal(anywhere.total, 240);
  assert.equal(anywhere.added, null);
  assert.throws(() => matcherPreview(data, type, "title", "  ", "", t0, end));
}

// Rule preview: entries caught by a new rule, and how categories change.
{
  const data = {
    windows: [
      e(0, 20, { app: "Code.exe", title: "alpha - Visual Studio Code" }),
      e(20, 10, { app: "Code.exe", title: "beta - Visual Studio Code" }),
    ],
    afk: [e(0, 25, { status: "not-afk" })],
    browsers: [],
  };
  const project = (id, rules) => ({ id, name: id, color: "#112233", rules });
  const rule = normalizeRule({ type: "title", pattern: "Visual Studio" });
  const taken = [
    project("a", [normalizeRule({ type: "title", pattern: "alpha" })]),
  ];
  const previous = analyze(data, taken, 0, 30000);
  const next = [taken[0], project("b", [rule])];
  const preview = rulePreview(data, rule, 0, 30000, {
    previous,
    next,
    projectId: "b",
  });
  // 25 s of active time: only the active part of both windows is caught.
  assert.equal(preview.total, 25);
  assert.deepEqual(
    preview.matches.map((m) => [m.label, m.seconds]),
    [
      ["alpha - Visual Studio Code", 20],
      ["beta - Visual Studio Code", 5],
    ],
  );
  const by = Object.fromEntries(preview.changes.map((c) => [c.id, c]));
  assert.equal(preview.changes[0].id, "b");
  assert.equal(by.b.after, 5); // alpha is claimed by both, beta by b only
  assert.equal(by.conflict.after, 20);
  assert.equal(by.unassigned.before - by.unassigned.after, 5);
  assert.equal(rulePreview(data, rule, 0, 30000).changes, null);
}
console.log("PASS: rule preview");

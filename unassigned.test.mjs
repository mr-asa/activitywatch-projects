import assert from "node:assert/strict";
import { analyze } from "./projects-core.mjs";
import {
  subtract,
  unassignedActivities,
  suggestedRule,
} from "./unassigned-core.mjs";
const e = (s, d, data) => ({
  timestamp: new Date(s * 1000).toISOString(),
  duration: d,
  data,
});
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

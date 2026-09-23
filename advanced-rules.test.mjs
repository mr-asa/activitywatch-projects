import assert from "node:assert/strict";
import {
  normalizeRule,
  ruleBounds,
  normalizeAssignment,
  projectRules,
  stable,
} from "./rule-engine.mjs";
import { analyze, normalizeProject } from "./projects-core.mjs";
const day = +new Date("2026-10-01T00:00:00"),
  event = (s, d, data) => ({
    timestamp: new Date(day + s * 1000).toISOString(),
    duration: d,
    data,
  });
const rule = (pattern, extra = {}) =>
  normalizeRule({ type: "title", mode: "text", pattern, ...extra });
const p = (id, rules) => ({
  id,
  name: id,
  color: "#65d6b4",
  rules,
  keywords: [],
  urls: [],
});
const data = {
  windows: [event(-30, 60, { app: "Telegram.exe", title: "TEAM CHAT" })],
  afk: [event(-30, 60, { status: "not-afk" })],
  browsers: [],
};
const old = p("old", [
    rule("^TEAM CHAT$", { mode: "regex", through: "2026-09-30" }),
  ]),
  next = p("new", [rule("TEAM CHAT", { from: "2026-10-01" })]);
let out = analyze(data, [old, next], day - 30000, day + 30000);
assert.equal(out.projects[0].total, 30);
assert.equal(out.projects[1].total, 30);
assert.equal(out.conflict, 0);
assert.equal(ruleBounds(old.rules[0])[1], day);
assert.throws(() => rule("[", { mode: "regex" }), /Invalid regex/);
assert.throws(
  () => rule("A", { from: "2026-10-02", through: "2026-10-01" }),
  /end date/,
);
assert.throws(() => rule("A", { from: "2026-02-30" }), /valid rule dates/);
const nuke = {
  windows: [
    event(0, 60, { app: "Nuke.exe", title: "comps.nk [modified] - Nuke" }),
  ],
  afk: [event(0, 60, { status: "not-afk" })],
  browsers: [],
};
assert.equal(
  analyze(
    nuke,
    [
      p("n", [
        rule("^comps\\.nk(?: \\[modified\\])? - Nuke$", { mode: "regex" }),
      ]),
    ],
    day,
    day + 60000,
  ).assigned,
  60,
);
assert.equal(
  analyze(
    nuke,
    [p("n", [rule("^comps\\.nk - Nuke$", { mode: "regex" })])],
    day,
    day + 60000,
  ).assigned,
  0,
);
const projects = [p("A", [rule("TEAM CHAT")]), p("B", [])];
const item = normalizeAssignment(
  { host: "HOST", projectId: "B", start: day - 10000, end: day + 10000 },
  projects,
);
out = analyze(data, projects, day - 30000, day + 30000, {
  host: "HOST",
  manualAssignments: [item],
});
assert.equal(out.projects[0].total, 40);
assert.equal(out.projects[1].total, 20);
assert.equal(out.tracked, 60);
assert.equal(
  analyze(data, projects, day - 30000, day + 30000, {
    host: "OTHER",
    manualAssignments: [item],
  }).projects[1].total,
  0,
);
const idle = {
  ...data,
  afk: [
    event(-30, 25, { status: "not-afk" }),
    event(-5, 10, { status: "afk" }),
    event(5, 25, { status: "not-afk" }),
  ],
};
assert.equal(
  analyze(idle, projects, day - 30000, day + 30000, {
    host: "HOST",
    manualAssignments: [item],
  }).projects[1].total,
  10,
);
assert.throws(
  () => normalizeAssignment({ ...item, id: "another" }, projects, [item]),
  /overlaps/,
);
assert.equal(
  analyze(data, projects, day - 30000, day + 30000, {
    host: "HOST",
    manualAssignments: [],
  }).projects[0].total,
  60,
);
assert.equal(
  normalizeProject({ id: "b", name: "B", color: "#65d6b4", rules: [] }).rules
    .length,
  0,
);
const legacy = normalizeProject({
  id: "a",
  name: "A",
  color: "#65d6b4",
  keywords: ["TEAM CHAT"],
  urls: ["https://example.com/project"],
});
assert.equal(projectRules(legacy).length, 2);
assert.equal(stable({ b: 2, a: 1 }), stable({ a: 1, b: 2 }));
console.log(
  "PASS: legacy conversion, explicit regex, invalid regex/dates, midnight boundary, historical preservation, manual precedence, idle/device filtering, overlap rejection/removal",
);

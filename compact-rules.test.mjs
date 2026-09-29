import assert from "node:assert/strict";
import { groupRules, expandGroup, addRule } from "./rule-groups.mjs";
import { normalizeRule, applicationMatches } from "./rule-engine.mjs";
import { analyze } from "./projects-core.mjs";
const r = (pattern, extra = {}) => normalizeRule({ pattern, ...extra });
const rules = [
  r("SHARED TITLE"),
  r("TEAM CHAT"),
  r("SHARED TITLE", { appFilter: "maya" }),
  r("SHARED TITLE", { from: "2026-09-23" }),
  r("SHARED TITLE", { mode: "regex" }),
  r("SHARED TITLE", { ignoreCase: false }),
];
const groups = groupRules(rules);
assert.equal(groups.length, 5);
assert.equal(groups[0].entries.length, 2);
const expanded = groups.flatMap((g) =>
  expandGroup(
    { ...g, patterns: g.entries.map((r) => r.pattern).join("\n") },
    g.entries,
  ),
);
assert.deepEqual(expanded, rules);
assert.throws(
  () => expandGroup({ mode: "regex", patterns: "valid\n[" }),
  /Invalid regex/,
);
assert.equal(expandGroup({ patterns: "one\ntwo\n\none" }).length, 2);
assert(applicationMatches("MAYA", "C:\\Program Files\\maya.exe"));
assert(applicationMatches("", "Telegram.exe"));
assert(!applicationMatches("maya", "mayabatch.exe"));
const start = Date.parse("2026-09-23T10:00:00Z"),
  event = (offset, app) => ({
    timestamp: new Date(start + offset * 1000).toISOString(),
    duration: 60,
    data: { app, title: "SHARED TITLE" },
  });
const data = {
  windows: [event(0, "Telegram.exe"), event(60, "maya.exe")],
  afk: [
    {
      timestamp: new Date(start).toISOString(),
      duration: 120,
      data: { status: "not-afk" },
    },
  ],
  browsers: [],
};
const p = (id, appFilter, mode = "text") => ({
  id,
  name: id,
  color: "#65d6b4",
  rules: [r("SHARED TITLE", { appFilter, mode })],
});
const result = analyze(
  data,
  [p("chat", "Telegram"), p("scene", "maya", "regex")],
  start,
  start + 120000,
);
assert.equal(result.projects[0].total, 60);
assert.equal(result.projects[1].total, 60);
assert.equal(result.conflict, 0);
assert.equal(
  analyze(data, [p("all", "")], start, start + 120000).assigned,
  120,
);
// The same application written differently is one group.
assert.equal(
  groupRules([
    r("A", { appFilter: "Telegram" }),
    r("B", { appFilter: "telegram.exe" }),
    r("C", { appFilter: "C:/Apps/Telegram.exe" }),
  ]).length,
  1,
);
// Adding joins the matching group right after its last rule, in its spelling.
const base = [
  r("Alpha", { appFilter: "Telegram" }),
  r("Other", { type: "url", pattern: "https://example.com/a" }),
];
const joined = addRule(base, r("Beta", { appFilter: "telegram.exe" }));
assert.equal(joined.merged, true);
assert.deepEqual(
  joined.rules.map((x) => [x.pattern, x.appFilter]),
  [
    ["Alpha", "Telegram"],
    ["Beta", "Telegram"],
    ["https://example.com/a", ""],
  ],
);
assert.equal(groupRules(joined.rules).length, 2);
// Known patterns are not added twice; case matters only when it matters.
assert.equal(
  addRule(base, r("alpha", { appFilter: "Telegram" })).duplicate,
  true,
);
assert.equal(
  addRule(
    [r("Alpha", { ignoreCase: false })],
    r("alpha", { ignoreCase: false }),
  ).duplicate,
  false,
);
// Different settings start a new group at the end.
const separate = addRule(
  base,
  r("Gamma", { appFilter: "Telegram", from: "2026-09-01" }),
);
assert.equal(separate.merged, false);
assert.equal(separate.rules.at(-1).pattern, "Gamma");
console.log(
  "PASS: lossless grouping, multiline validation, optional exact application matching, separate project totals",
);

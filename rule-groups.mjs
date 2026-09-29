import { applicationKey, normalizeRule } from "./rule-engine.mjs";
// Rules that match the same way apart from their pattern form one group.
function groupKey(rule) {
  return JSON.stringify([
    rule.type || "title",
    rule.mode || "text",
    rule.ignoreCase !== false,
    rule.from || "",
    rule.through || "",
    applicationKey(rule.appFilter),
  ]);
}
export function groupRules(rules) {
  const groups = new Map();
  for (const rule of rules) {
    const key = groupKey(rule);
    if (!groups.has(key))
      groups.set(key, {
        type: rule.type || "title",
        mode: rule.mode || "text",
        ignoreCase: rule.ignoreCase !== false,
        from: rule.from || "",
        through: rule.through || "",
        appFilter: rule.appFilter || "",
        entries: [],
      });
    groups.get(key).entries.push({
      ...rule,
      pattern:
        rule.mode === "regex"
          ? rule.pattern.replace(/\r?\n/g, "\\n")
          : rule.pattern,
    });
  }
  return [...groups.values()];
}
// Adds a rule to the group with the same settings (taking over that group's
// spelling of the application) right after its last rule, or appends it as a
// new group. A pattern the group already has is not added twice.
export function addRule(rules, rule) {
  const key = groupKey(rule);
  const last = rules.findLastIndex((r) => groupKey(r) === key);
  if (last < 0)
    return { rules: [...rules, rule], merged: false, duplicate: false };
  const same = (a, b) =>
    rule.mode === "text" && rule.ignoreCase !== false
      ? a.toLocaleLowerCase() === b.toLocaleLowerCase()
      : a === b;
  if (rules.some((r) => groupKey(r) === key && same(r.pattern, rule.pattern)))
    return { rules, merged: true, duplicate: true };
  const next = [...rules];
  next.splice(last + 1, 0, { ...rule, appFilter: rules[last].appFilter || "" });
  return { rules: next, merged: true, duplicate: false };
}
export function expandGroup(input, entries = []) {
  const patterns = [
    ...new Set(
      String(input.patterns || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (!patterns.length)
    throw Error("Enter at least one pattern, or remove this rule group.");
  // Links may be shown in readable form; compare them once normalized.
  const seen = new Set();
  return patterns
    .map((pattern) => {
      const rule = normalizeRule({ ...input, pattern });
      const id = entries.find(
        (r) => r.pattern === pattern || r.pattern === rule.pattern,
      )?.id;
      return id ? { ...rule, id } : rule;
    })
    .filter((rule) => !seen.has(rule.pattern) && seen.add(rule.pattern));
}

import { normalizeRule } from "./rule-engine.mjs";
export function groupRules(rules) {
  const groups = new Map();
  for (const rule of rules) {
    const meta = {
      type: rule.type || "title",
      mode: rule.mode || "text",
      ignoreCase: rule.ignoreCase !== false,
      from: rule.from || "",
      through: rule.through || "",
      appFilter: rule.appFilter || "",
    };
    const key = JSON.stringify(meta);
    if (!groups.has(key)) groups.set(key, { ...meta, entries: [] });
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
  return patterns.map((pattern) =>
    normalizeRule({
      ...input,
      id: entries.find((r) => r.pattern === pattern)?.id,
      pattern,
    }),
  );
}

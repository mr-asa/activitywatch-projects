export function projectRules(project) {
  return (
    project.rules ?? [
      ...(project.keywords || []).map((pattern, i) => ({
        id: "title-" + i,
        type: "title",
        mode: "text",
        pattern,
        ignoreCase: true,
        from: "",
        through: "",
      })),
      ...(project.urls || []).map((pattern, i) => ({
        id: "url-" + i,
        type: "url",
        mode: "text",
        pattern,
        ignoreCase: true,
        from: "",
        through: "",
      })),
    ]
  );
}
export function normalizeRule(input) {
  const r = {
    id: input.id || crypto.randomUUID(),
    type: input.type || "title",
    mode: input.mode || "text",
    pattern: String(input.pattern || "").trim(),
    ignoreCase: input.ignoreCase !== false,
    from: input.from || "",
    through: input.through || "",
    appFilter: input.type === "url" ? "" : String(input.appFilter || "").trim(),
  };
  if (!["title", "url"].includes(r.type) || !["text", "regex"].includes(r.mode))
    throw Error("Choose a supported rule type and matching mode.");
  if (!r.pattern) throw Error("Enter a title or URL pattern.");
  for (const d of [r.from, r.through])
    if (
      d &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(d) ||
        new Date(d + "T12:00:00").toString() === "Invalid Date" ||
        localDate(new Date(d + "T12:00:00")) !== d)
    )
      throw Error("Enter valid rule dates.");
  if (r.from && r.through && r.from > r.through)
    throw Error("The rule end date must be on or after its start date.");
  if (r.mode === "regex") {
    try {
      new RegExp(r.pattern, r.ignoreCase ? "i" : "");
    } catch (e) {
      throw Error("Invalid regex: " + e.message);
    }
  } else if (r.type === "url") {
    let u;
    try {
      u = new URL(r.pattern);
    } catch {
      throw Error("Enter a full URL beginning with http:// or https://.");
    }
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      throw Error("Use an http or https URL without credentials.");
    u.hash = "";
    r.pattern = u.href;
  }
  return r;
}
export function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function ruleBounds(rule) {
  const start = rule.from ? +new Date(rule.from + "T00:00:00") : -Infinity;
  let end = Infinity;
  if (rule.through) {
    const d = new Date(rule.through + "T00:00:00");
    d.setDate(d.getDate() + 1);
    end = +d;
  }
  return [start, end];
}
export function clipRule(ranges, rule) {
  const [start, end] = ruleBounds(rule);
  return ranges
    .map(([s, e]) => [Math.max(s, start), Math.min(e, end)])
    .filter(([s, e]) => e > s);
}
export function applicationMatches(filter, app) {
  if (!String(filter || "").trim()) return true;
  const clean = (value) =>
    String(value || "")
      .trim()
      .split(/[\\/]/)
      .pop()
      .replace(/[.]exe$/i, "")
      .toLocaleLowerCase();
  return clean(filter) === clean(app);
}
export function ruleMatches(rule, value, matchTitle, matchUrl, app = "") {
  if (rule.type === "title" && !applicationMatches(rule.appFilter, app))
    return false;
  if (rule.mode === "regex") {
    try {
      return new RegExp(
        rule.pattern,
        rule.ignoreCase === false ? "" : "i",
      ).test(String(value || ""));
    } catch {
      return false;
    }
  }
  if (rule.type === "url") return matchUrl(value, rule.pattern);
  return rule.ignoreCase === false
    ? String(value || "").includes(rule.pattern)
    : matchTitle(value, rule.pattern);
}
export function normalizeAssignment(input, projects, existing = []) {
  const item = {
    id: input.id || crypto.randomUUID(),
    projectId: input.projectId,
    host: input.host,
    start: new Date(input.start).toISOString(),
    end: new Date(input.end).toISOString(),
    note: String(input.note || "").trim(),
  };
  if (!projects.some((p) => p.id === item.projectId))
    throw Error("Choose an existing project.");
  if (!item.host) throw Error("Choose a device for the assignment.");
  if (Date.parse(item.end) <= Date.parse(item.start))
    throw Error("The interval must end after it starts.");
  if (
    existing.some(
      (a) =>
        a.id !== item.id &&
        a.host === item.host &&
        Date.parse(a.start) < Date.parse(item.end) &&
        Date.parse(a.end) > Date.parse(item.start),
    )
  )
    throw Error(
      "This interval overlaps another manual assignment. Remove the earlier assignment or choose a different interval.",
    );
  return item;
}
export function stable(value) {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stable(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}

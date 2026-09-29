import { analyze } from "../projects-core.mjs";
import { analyzeActivityTypes } from "../activity-core.mjs";
import { unassignedActivities } from "../unassigned-core.mjs";

const start = Date.parse("2026-01-01T00:00:00Z");
const projects = Array.from({ length: 8 }, (_, i) => ({
  id: `p${i}`,
  name: `Project ${i}`,
  keywords: [`Project ${i}`],
  urls: [],
}));
const types = [
  {
    id: "editor",
    name: "Editing",
    applications: ["Code.exe"],
    titles: [],
    urls: [],
    combinations: [],
  },
];
const event = (timestamp, duration, data) => ({
  timestamp: new Date(timestamp).toISOString(),
  duration,
  data,
});
const measure = (fn) => {
  const before = performance.now();
  const value = fn();
  return [value, Math.round(performance.now() - before)];
};
for (const days of [7, 30, 90]) {
  const data = { windows: [], afk: [], browsers: [], editors: [] };
  for (let day = 0; day < days; day++) {
    const from = start + day * 86400000;
    data.afk.push(event(from, 8 * 3600, { status: "not-afk" }));
    for (let i = 0; i < 960; i++)
      data.windows.push(
        event(from + i * 30000, 30, {
          app: "Code.exe",
          title: i % 2 ? `Unknown ${i % 31}` : `Project ${i % 8}`,
        }),
      );
  }
  const end = start + days * 86400000;
  const [result, analysisMs] = measure(() =>
    analyze(data, projects, start, end),
  );
  const [, activityMs] = measure(() =>
    analyzeActivityTypes(data, types, start, end),
  );
  const [rows, unassignedMs] = measure(() =>
    unassignedActivities(data, result),
  );
  console.log(
    JSON.stringify({
      days,
      events: data.windows.length,
      analysisMs,
      activityMs,
      unassignedMs,
      rows: rows.length,
    }),
  );
}

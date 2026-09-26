import { localDate } from "./rule-engine.mjs";
export function projectWorkload(result, projectId, startOfDay = "04:00") {
  const totals = new Map(),
    [h, m] = startOfDay.split(":").map(Number);
  for (const s of result.segments) {
    const included =
      projectId === null
        ? result.projects.some(
            (p) => p.id === s.project && p.kind !== "non-project",
          )
        : s.project === projectId;
    if (!included) continue;
    let cursor = s.start;
    while (cursor < s.end) {
      const day = new Date(cursor);
      day.setHours(h, m, 0, 0);
      if (+day > cursor) day.setDate(day.getDate() - 1);
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      const end = Math.min(s.end, +next);
      const key = localDate(day);
      totals.set(key, (totals.get(key) || 0) + (end - cursor) / 1000);
      cursor = end;
    }
  }
  const dates = [...totals.keys()].sort();
  if (!dates.length)
    return { days: [], total: 0, activeDays: 0, average: 0, busiest: null };
  const days = [];
  const date = new Date(dates[0] + "T12:00:00");
  while (localDate(date) <= dates.at(-1)) {
    const key = localDate(date);
    days.push({ date: key, seconds: totals.get(key) || 0 });
    date.setDate(date.getDate() + 1);
  }
  const total = days.reduce((sum, d) => sum + d.seconds, 0),
    activeDays = days.filter((d) => d.seconds > 0).length;
  return {
    days,
    total,
    activeDays,
    average: total / activeDays,
    busiest: days.reduce((a, b) => (b.seconds > a.seconds ? b : a)),
  };
}
export function workloadLayers(
  result,
  summary,
  startOfDay = "04:00",
  targetHours = null,
) {
  const kinds = new Map(
      result.projects.map((p) => [p.id, p.kind || "project"]),
    ),
    byDay = new Map(),
    [h, m] = startOfDay.split(":").map(Number);
  for (const s of result.segments) {
    let cursor = s.start;
    while (cursor < s.end) {
      const day = new Date(cursor);
      day.setHours(h, m, 0, 0);
      if (+day > cursor) day.setDate(day.getDate() - 1);
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      const end = Math.min(+next, s.end),
        date = localDate(day),
        seconds = (end - cursor) / 1000;
      if (!byDay.has(date))
        byDay.set(date, {
          tracked: 0,
          work: 0,
          nonProject: 0,
          unclassified: 0,
        });
      const row = byDay.get(date);
      row.tracked += seconds;
      if (kinds.get(s.project) === "project") row.work += seconds;
      else if (kinds.get(s.project) === "non-project")
        row.nonProject += seconds;
      else row.unclassified += seconds;
      cursor = end;
    }
  }
  const days = summary.days.map((d) => ({
    ...d,
    ...(byDay.get(d.date) || {
      tracked: 0,
      work: 0,
      nonProject: 0,
      unclassified: 0,
    }),
  }));
  for (let i = 0; i < days.length; i++) {
    const d = days[i],
      window = days
        .slice(Math.max(0, i - 6), i + 1)
        .filter((d) => d.tracked > 0);
    d.trend = window.length
      ? window.reduce((s, r) => s + r.seconds, 0) / window.length
      : null;
    d.nonProjectPercent = d.tracked ? (d.nonProject / d.tracked) * 100 : null;
    d.overtime =
      targetHours > 0 ? Math.max(0, d.work - targetHours * 3600) : null;
  }
  const sum = (field) => days.reduce((s, d) => s + (d[field] || 0), 0),
    tracked = sum("tracked");
  return {
    days,
    work: sum("work"),
    tracked,
    nonProjectPercent: tracked ? (sum("nonProject") / tracked) * 100 : null,
    coverage: tracked
      ? ((tracked - sum("unclassified")) / tracked) * 100
      : null,
    overtime: targetHours > 0 ? sum("overtime") : null,
  };
}

export function stackedWorkload(result, summary, startOfDay = "04:00") {
  const accumulated = summary.days.map(() => 0);
  return result.projects
    .filter((p) => p.kind !== "non-project")
    .map((p) => {
      const totals = new Map(
        projectWorkload(result, p.id, startOfDay).days.map((d) => [
          d.date,
          d.seconds,
        ]),
      );
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        days: summary.days.map((d, i) => {
          const seconds = totals.get(d.date) || 0,
            bottom = accumulated[i];
          accumulated[i] += seconds;
          return { date: d.date, seconds, bottom, top: accumulated[i] };
        }),
      };
    })
    .filter((p) => p.days.some((d) => d.seconds > 0));
}

import { localDate } from "./rule-engine.mjs";
export function projectWorkload(result, projectId, startOfDay = "04:00") {
  const totals = new Map(),
    [h, m] = startOfDay.split(":").map(Number);
  for (const s of result.segments) {
    if (s.project !== projectId) continue;
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

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

// Layers stacked bottom-up: project work, then non-project categories, then
// unclassified time (not assigned + needs review). The top of the last layer is
// all active time of the day. Non-work layers carry `extra: true`.
export function stackedWorkload(result, summary, startOfDay = "04:00") {
  const accumulated = summary.days.map(() => 0);
  const daily = (ids) => {
    const totals = new Map();
    for (const id of ids)
      for (const d of projectWorkload(result, id, startOfDay).days)
        totals.set(d.date, (totals.get(d.date) || 0) + d.seconds);
    return totals;
  };
  const layer = (id, name, color, totals, extra = false) => ({
    id,
    name,
    color,
    extra,
    days: summary.days.map((d, i) => {
      const seconds = totals.get(d.date) || 0,
        bottom = accumulated[i];
      accumulated[i] += seconds;
      return { date: d.date, seconds, bottom, top: accumulated[i] };
    }),
  });
  const work = result.projects.filter((p) => p.kind !== "non-project"),
    other = result.projects.filter((p) => p.kind === "non-project");
  return [
    ...work.map((p) => layer(p.id, p.name, p.color, daily([p.id]))),
    ...other.map((p) => layer(p.id, p.name, p.color, daily([p.id]), true)),
    layer(
      "unclassified",
      "Unclassified",
      "#7d8896",
      daily(["unassigned", "conflict"]),
      true,
    ),
  ].filter((p) => p.days.some((d) => d.seconds > 0));
}

// Points for a chart of the given plot width: daily while a day gets at least
// 6 px, otherwise weekly (Monday-based) or monthly buckets. A bucket holds the
// average per recorded day of every numeric field, so the axis stays in hours
// per day; days without recordings are left out of averages (and a bucket
// with none stays a gap). Stack layers are averaged the same way.
export function chartBuckets(days, stack = [], plotWidth = 900) {
  const weekKey = (date) => {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return localDate(d);
  };
  const weeks = new Set(days.map((d) => weekKey(d.date))).size;
  const unit =
    days.length * 6 <= plotWidth
      ? "day"
      : weeks * 6 <= plotWidth
        ? "week"
        : "month";
  if (unit === "day")
    return {
      unit,
      days: days.map((d) => ({
        ...d,
        from: d.date,
        to: d.date,
        recorded: d.tracked ? 1 : 0,
        count: 1,
      })),
      stack,
    };
  const key = unit === "week" ? weekKey : (date) => date.slice(0, 7) + "-01";
  const groups = [];
  days.forEach((d, i) => {
    const k = key(d.date);
    if (groups.at(-1)?.key !== k) groups.push({ key: k, indexes: [] });
    groups.at(-1).indexes.push(i);
  });
  // Trend and overtime may be null on every day; they stay null then.
  const numeric = [
    ...new Set(
      ["trend", "overtime"].concat(
        ...days.map((d) =>
          Object.keys(d).filter(
            (k) => typeof d[k] === "number" && k !== "nonProjectPercent",
          ),
        ),
      ),
    ),
  ];
  const buckets = groups.map(({ key, indexes }) => {
    const recorded = indexes.filter((i) => days[i].tracked > 0);
    const out = {
      date: key,
      from: days[indexes[0]].date,
      to: days[indexes.at(-1)].date,
      count: indexes.length,
      recorded: recorded.length,
    };
    for (const field of numeric) {
      const values = recorded
        .map((i) => days[i][field])
        .filter((v) => typeof v === "number");
      out[field] = values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : field === "trend" || field === "overtime"
          ? null
          : 0;
    }
    out.nonProjectPercent = out.tracked
      ? (out.nonProject / out.tracked) * 100
      : null;
    return { ...out, indexes, recordedIndexes: recorded };
  });
  const layers = stack.map((layer) => ({ ...layer, days: [] }));
  buckets.forEach((b, i) => {
    let bottom = 0;
    layers.forEach((layer, l) => {
      const seconds = b.recordedIndexes.length
        ? b.recordedIndexes.reduce((n, k) => n + stack[l].days[k].seconds, 0) /
          b.recordedIndexes.length
        : 0;
      layer.days[i] = { date: b.date, seconds, bottom, top: bottom + seconds };
      bottom += seconds;
    });
  });
  for (const b of buckets) {
    delete b.indexes;
    delete b.recordedIndexes;
  }
  return { unit, days: buckets, stack: layers };
}

// The part of loaded data that overlaps [start, end): analysing a short span
// of a long loaded history then costs only that span.
export function sliceData(data, start, end) {
  const overlaps = (e) => {
    const t = Date.parse(e.timestamp);
    return t < end && t + e.duration * 1000 > start;
  };
  return {
    ...data,
    windows: data.windows.filter(overlaps),
    afk: data.afk.filter(overlaps),
    browsers: (data.browsers || []).map((b) => ({
      ...b,
      events: b.events.filter(overlaps),
    })),
    editors: (data.editors || []).map((source) =>
      source.events
        ? { ...source, events: source.events.filter(overlaps) }
        : source,
    ),
  };
}

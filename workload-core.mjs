import { localDate } from "./rule-engine.mjs";

// Report dates from `from` through `through` (inclusive, "YYYY-MM-DD").
export function reportDates(from, through) {
  const out = [];
  const date = new Date(from + "T12:00:00");
  while (localDate(date) <= through && out.length < 20000) {
    out.push(localDate(date));
    date.setDate(date.getDate() + 1);
  }
  return out;
}

// Calls add(date, seconds) for each report day that [start, end) touches.
function splitByDay(start, end, startOfDay, add) {
  const [h, m] = startOfDay.split(":").map(Number);
  let cursor = start;
  while (cursor < end) {
    const day = new Date(cursor);
    day.setHours(h, m, 0, 0);
    if (+day > cursor) day.setDate(day.getDate() - 1);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    const stop = Math.min(end, +next);
    add(localDate(day), (stop - cursor) / 1000);
    cursor = stop;
  }
}

// Compact per-day values the workload chart is drawn from (and cached as):
//   projects: seconds per category id, including "conflict" and "unassigned";
//   types:    seconds per activity type, overall ("*") and within each
//             category id.
// Every requested date gets a summary, so empty days are cached too.
export function daySummaries(result, typeResult, dates, startOfDay = "04:00") {
  const byDate = new Map(
    dates.map((date) => [date, { date, projects: {}, types: {} }]),
  );
  const add = (bucket, id, date, seconds) => {
    const day = byDate.get(date);
    if (day) day[bucket][id] = (day[bucket][id] || 0) + seconds;
  };
  for (const s of result.segments)
    splitByDay(s.start, s.end, startOfDay, (date, seconds) =>
      add("projects", s.project, date, seconds),
    );
  // Both segment lists are sorted and internally disjoint: one merge pass.
  const categories = result.segments;
  const typed = (typeResult?.segments || []).filter(
    (s) => s.project !== "unassigned" && s.project !== "conflict",
  );
  let i = 0;
  for (const t of typed) {
    while (i < categories.length && categories[i].end <= t.start) i++;
    for (let k = i; k < categories.length && categories[k].start < t.end; k++) {
      const c = categories[k],
        start = Math.max(c.start, t.start),
        end = Math.min(c.end, t.end);
      if (end <= start) continue;
      splitByDay(start, end, startOfDay, (date, seconds) => {
        const day = byDate.get(date);
        if (!day) return;
        const type = (day.types[t.project] ||= {});
        type["*"] = (type["*"] || 0) + seconds;
        type[c.project] = (type[c.project] || 0) + seconds;
      });
    }
  }
  return dates.map((date) => byDate.get(date));
}

// Everything the chart shows for one selection (a project id, or null for all
// projects), from day summaries: the selected series, the context layers
// (all active time, work, non-project, unclassified, trend, target excess),
// the stacked layers and the activity-type lines.
export function workloadFromSummaries(
  days,
  projects,
  { projectId = null, target = null, types = [] } = {},
) {
  const kinds = new Map(projects.map((p) => [p.id, p.kind || "project"]));
  const work = projects.filter((p) => kinds.get(p.id) !== "non-project");
  const sum = (values, ids) => ids.reduce((n, id) => n + (values[id] || 0), 0);
  const activities = types.map((type, index) => ({
    ...type,
    field: `activity-${index}`,
  }));
  const rows = days.map((d) => {
    let tracked = 0,
      workTime = 0,
      nonProject = 0,
      unclassified = 0;
    for (const [id, seconds] of Object.entries(d.projects)) {
      tracked += seconds;
      const kind = kinds.get(id);
      if (kind === "project") workTime += seconds;
      else if (kind === "non-project") nonProject += seconds;
      else unclassified += seconds;
    }
    const row = {
      date: d.date,
      seconds:
        projectId === null
          ? sum(
              d.projects,
              work.map((p) => p.id),
            )
          : d.projects[projectId] || 0,
      tracked,
      work: workTime,
      nonProject,
      unclassified,
    };
    for (const a of activities)
      row[a.field] = d.types[a.id]?.[projectId ?? "*"] || 0;
    return row;
  });
  rows.forEach((d, i) => {
    const recent = rows
      .slice(Math.max(0, i - 6), i + 1)
      .filter((r) => r.tracked > 0);
    d.trend = recent.length
      ? recent.reduce((n, r) => n + r.seconds, 0) / recent.length
      : null;
    d.nonProjectPercent = d.tracked ? (d.nonProject / d.tracked) * 100 : null;
    d.overtime = target > 0 ? Math.max(0, d.work - target * 3600) : null;
  });
  const total = (field) => rows.reduce((n, d) => n + (d[field] || 0), 0);
  const tracked = total("tracked");
  // Stack: work projects, then non-project categories, then unclassified
  // (not assigned + needs review); its top is all active time of the day.
  const accumulated = rows.map(() => 0);
  const layer = (id, name, color, values, extra) => ({
    id,
    name,
    color,
    extra,
    days: values.map((seconds, i) => {
      const bottom = accumulated[i];
      accumulated[i] += seconds;
      return { date: rows[i].date, seconds, bottom, top: accumulated[i] };
    }),
  });
  const stack =
    projectId === null
      ? [
          ...work.map((p) =>
            layer(
              p.id,
              p.name,
              p.color,
              days.map((d) => d.projects[p.id] || 0),
              false,
            ),
          ),
          ...projects
            .filter((p) => kinds.get(p.id) === "non-project")
            .map((p) =>
              layer(
                p.id,
                p.name,
                p.color,
                days.map((d) => d.projects[p.id] || 0),
                true,
              ),
            ),
          layer(
            "unclassified",
            "Unclassified",
            "#7d8896",
            rows.map((r) => r.unclassified),
            true,
          ),
        ].filter((l) => l.days.some((d) => d.seconds > 0))
      : [];
  return {
    summary: {
      days: rows.map((r) => ({ date: r.date, seconds: r.seconds })),
      total: total("seconds"),
    },
    layers: {
      days: rows,
      work: total("work"),
      tracked,
      nonProjectPercent: tracked ? (total("nonProject") / tracked) * 100 : null,
      coverage: tracked
        ? ((tracked - total("unclassified")) / tracked) * 100
        : null,
      overtime: target > 0 ? total("overtime") : null,
    },
    stack,
    activities,
  };
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

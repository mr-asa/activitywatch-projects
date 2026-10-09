// ManicTime → ActivityWatch import, shared by the dashboard (sql.js) and
// scripts/import-manictime.mjs (node:sqlite). Both pass `query(sql, params)`,
// which returns an array of row objects from a ManicTime database.
// Only history before ActivityWatch's first recorded event is imported, so
// nothing overlaps real data. `api(path, body?, method?)` talks to /api/0/.
const WINDOW_SCHEMA = "ManicTime/Applications";
const AFK_SCHEMA = "ManicTime/ComputerUsage";
const utc = (s) => Date.parse(String(s).replace(" ", "T") + "Z");
function rows(query, schema) {
  const id = query("select ReportId from Ar_Timeline where SchemaName = ?", [
    schema,
  ])[0]?.ReportId;
  if (id === undefined) throw Error("ManicTime timeline missing: " + schema);
  return query(
    `select a.Name name, g.Name groupName, g.Key groupKey,
            a.StartUtcTime start, a.EndUtcTime end
       from Ar_Activity a
       left join Ar_Group g on g.ReportId = a.ReportId and g.GroupId = a.GroupId
      where a.ReportId = ?
      order by a.StartUtcTime`,
    [id],
  );
}
// Keep the part before the cut-off; drop empty intervals.
export function clip(list, until, toEvent) {
  const out = [];
  for (const r of list) {
    const start = utc(r.start),
      end = Math.min(utc(r.end), until);
    if (!(end > start)) continue;
    out.push({
      timestamp: new Date(start).toISOString(),
      duration: (end - start) / 1000,
      data: toEvent(r),
    });
  }
  return out;
}
// ManicTime stores applications as "<exe>;<name>", lower-cased. Reuse the
// spelling ActivityWatch records for the same executable where known.
export function appName(row, spelling) {
  const exe =
    String(row.groupKey || "").split(";")[0] || row.groupName || "unknown";
  return spelling.get(exe.toLowerCase()) || exe;
}
export function buildEvents(query, until, spelling) {
  return {
    windows: clip(rows(query, WINDOW_SCHEMA), until, (r) => ({
      app: appName(r, spelling),
      title: r.name || "",
    })),
    // Active → not-afk; Away, Session lock and Power off → afk.
    afk: clip(rows(query, AFK_SCHEMA), until, (r) => ({
      status: r.name === "Active" ? "not-afk" : "afk",
    })),
  };
}
async function firstEvent(api, buckets, id) {
  if (!buckets[id]) return null;
  const created = Date.parse(buckets[id].created);
  const events = await api(
    `buckets/${id}/events?start=${new Date(created - 30 * 86400000).toISOString()}&end=${new Date(created + 86400000).toISOString()}&limit=-1`,
  );
  const times = events
    .map((e) => Date.parse(e.timestamp))
    .filter(Number.isFinite);
  return times.length ? Math.min(...times) : created;
}
// Reads the database and works out what would be imported. Changes nothing.
export async function prepareImport({ api, query, until: forced }) {
  const host = (await api("info")).hostname;
  const buckets = await api("buckets/");
  const realWindow = `aw-watcher-window_${host}`;
  const firstReal = Math.min(
    ...(
      await Promise.all([
        firstEvent(api, buckets, realWindow),
        firstEvent(api, buckets, `aw-watcher-afk_${host}`),
      ])
    ).filter((t) => t !== null),
    Infinity,
  );
  const until = forced ?? firstReal;
  if (!Number.isFinite(until))
    throw Error("No ActivityWatch history found; pass --until explicitly.");
  const spelling = new Map();
  if (buckets[realWindow]) {
    const recent = await api(
      `buckets/${realWindow}/events?start=${new Date(Date.now() - 14 * 86400000).toISOString()}&limit=-1`,
    );
    for (const e of recent)
      if (e.data?.app) spelling.set(e.data.app.toLowerCase(), e.data.app);
  }
  const { windows, afk } = buildEvents(query, until, spelling);
  return {
    host,
    buckets,
    firstReal,
    until,
    windows,
    afk,
    first: windows[0]?.timestamp || afk[0]?.timestamp,
  };
}
export const hours = (list, test = () => true) =>
  (list.filter(test).reduce((n, e) => n + e.duration, 0) / 3600).toFixed(1);
// target "main": real buckets of this device, refuses to import twice.
// target "test": separate "<host>-manictime" buckets (needs DELETE via
// `replace`, so only the script offers it).
export async function runImport({
  api,
  prepared,
  target = "main",
  replace = false,
  progress = () => {},
}) {
  const { host, buckets, until, windows, afk, first } = prepared;
  const device = target === "main" ? host : `${host}-manictime`;
  const plan = [
    [`aw-watcher-window_${device}`, "currentwindow", windows],
    [`aw-watcher-afk_${device}`, "afkstatus", afk],
  ];
  if (target === "main") {
    for (const [id] of plan) {
      if (!buckets[id]) throw Error(`Bucket ${id} not found.`);
      // The server's end filter is inclusive and imprecise; check timestamps.
      const earlier = (
        await api(
          `buckets/${id}/events?end=${new Date(until).toISOString()}&limit=10`,
        )
      ).filter(
        (e) =>
          Date.parse(e.timestamp) < until &&
          // The AFK watcher may backdate one long "afk" interval on its first
          // start; only active time before the cut-off would double count.
          (!id.startsWith("aw-watcher-afk_") ||
            (e.data?.status === "not-afk" && e.duration > 0)),
      );
      if (earlier.length)
        throw Error(
          `${id} already has events before the cut-off; not importing twice.`,
        );
    }
  } else {
    for (const [id, type] of plan) {
      if (buckets[id]) {
        if (!replace)
          throw Error(
            `${id} exists. Use --replace to recreate the test import.`,
          );
        await api(`buckets/${id}?force=1`, undefined, "DELETE");
      }
      await api(`buckets/${id}`, {
        client: "aw-import-manictime",
        type,
        hostname: device,
      });
    }
  }
  for (const [id, , events] of plan) {
    for (let i = 0; i < events.length; i += 5000) {
      await api(`buckets/${id}/events`, events.slice(i, i + 5000));
      progress(id, Math.min(i + 5000, events.length), events.length);
    }
  }
  // The dashboard takes the start of history from bucket creation times,
  // which are newer than imported data; record the real start per device.
  if (first) {
    const starts = (await api("settings/project_tracker_history_start")) || {};
    await api("settings/project_tracker_history_start", {
      ...starts,
      [device]: first,
    });
  }
  return device;
}

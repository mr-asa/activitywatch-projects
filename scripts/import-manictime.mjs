// Imports ManicTime history into ActivityWatch as window and AFK events.
//
//   node scripts/import-manictime.mjs [--dry-run] [--target test|main]
//        [--db <ManicTimeReports.db>] [--server http://localhost:5600]
//        [--until <ISO time>] [--replace]
//
// The ManicTime database is copied first and only the copy is read.
// Only history before ActivityWatch's first recorded window event is imported
// (or before --until), so nothing overlaps with real ActivityWatch data.
//
// --target test (default) writes to separate buckets of the device
//   "<hostname>-manictime", which the dashboard opens with
//   ?hostname=<hostname>-manictime. --replace recreates them.
// --target main writes into the real window/AFK buckets of this device. It
//   refuses to run twice.
// Both record where the imported history starts in the ActivityWatch setting
// "project_tracker_history_start" ({ device: ISO time }).
//
// Needs Node.js with node:sqlite (22.13+ or 23.4+).
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.includes("--" + name);
const option = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const server = option("server", "http://localhost:5600").replace(/\/$/, "");
const target = option("target", "test");
const dryRun = flag("dry-run");
const source = option(
  "db",
  join(process.env.LOCALAPPDATA || "", "Finkit/ManicTime/ManicTimeReports.db"),
);
if (!["test", "main"].includes(target)) throw Error("--target is test or main");
if (!existsSync(source)) throw Error("ManicTime database not found: " + source);

async function api(path, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(`${server}/api/0/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok)
    throw Error(
      `${method} ${path}: ${response.status} ${await response.text()}`,
    );
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

const info = await api("info");
const host = info.hostname;
const buckets = await api("buckets/");
const realWindow = `aw-watcher-window_${host}`;
const realAfk = `aw-watcher-afk_${host}`;

// Import only before ActivityWatch's own history begins.
async function firstEvent(id) {
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
const firstReal = Math.min(
  ...(await Promise.all([firstEvent(realWindow), firstEvent(realAfk)])).filter(
    (t) => t !== null,
  ),
  Infinity,
);
const until = option("until") ? Date.parse(option("until")) : firstReal;
if (!Number.isFinite(until))
  throw Error("No ActivityWatch history found; pass --until explicitly.");

// Read a copy: ManicTime keeps writing to its database while running.
const dir = mkdtempSync(join(tmpdir(), "manictime-"));
const copy = join(dir, "reports.db");
copyFileSync(source, copy);
for (const suffix of ["-wal", "-shm"])
  if (existsSync(source + suffix)) copyFileSync(source + suffix, copy + suffix);
const db = new DatabaseSync(copy, { readOnly: true });
const timeline = (schema) =>
  db
    .prepare("select ReportId from Ar_Timeline where SchemaName = ?")
    .get(schema)?.ReportId;
const utc = (s) => Date.parse(s.replace(" ", "T") + "Z");
function rows(schema) {
  const id = timeline(schema);
  if (id === undefined) throw Error("ManicTime timeline missing: " + schema);
  return db
    .prepare(
      `select a.Name name, g.Name groupName, g.Key groupKey,
              a.StartUtcTime start, a.EndUtcTime end
         from Ar_Activity a
         left join Ar_Group g on g.ReportId = a.ReportId and g.GroupId = a.GroupId
        where a.ReportId = ?
        order by a.StartUtcTime`,
    )
    .all(id);
}
// Keep the part before the cut-off; drop empty intervals.
function clip(list, toEvent) {
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
const spelling = new Map();
if (buckets[realWindow]) {
  const recent = await api(
    `buckets/${realWindow}/events?start=${new Date(Date.now() - 14 * 86400000).toISOString()}&limit=-1`,
  );
  for (const e of recent)
    if (e.data?.app) spelling.set(e.data.app.toLowerCase(), e.data.app);
}
const appName = (r) => {
  const exe =
    String(r.groupKey || "").split(";")[0] || r.groupName || "unknown";
  return spelling.get(exe.toLowerCase()) || exe;
};
const windows = clip(rows("ManicTime/Applications"), (r) => ({
  app: appName(r),
  title: r.name || "",
}));
// Active → not-afk; Away, Session lock and Power off → afk.
const afk = clip(rows("ManicTime/ComputerUsage"), (r) => ({
  status: r.name === "Active" ? "not-afk" : "afk",
}));
db.close();
rmSync(dir, { recursive: true, force: true });

const hours = (list, test = () => true) =>
  (list.filter(test).reduce((n, e) => n + e.duration, 0) / 3600).toFixed(1);
const first = windows[0]?.timestamp || afk[0]?.timestamp;
console.log(
  `ActivityWatch device: ${host} (first own event ${new Date(firstReal).toISOString()})`,
);
console.log(`Importing before:     ${new Date(until).toISOString()}`);
console.log(`ManicTime history:    ${first} …`);
console.log(`Window events:        ${windows.length} · ${hours(windows)} h`);
console.log(
  `AFK events:           ${afk.length} · active ${hours(afk, (e) => e.data.status === "not-afk")} h`,
);
if (dryRun) process.exit(0);

const device = target === "main" ? host : `${host}-manictime`;
const plan = [
  [`aw-watcher-window_${device}`, "currentwindow", windows],
  [`aw-watcher-afk_${device}`, "afkstatus", afk],
];
if (target === "main") {
  for (const [id] of plan) {
    if (!buckets[id]) throw Error(`Bucket ${id} not found.`);
    const earlier = await api(
      `buckets/${id}/events?end=${new Date(until - 1).toISOString()}&limit=1`,
    );
    if (earlier.length)
      throw Error(
        `${id} already has events before the cut-off; not importing twice.`,
      );
  }
} else {
  for (const [id, type] of plan) {
    if (buckets[id]) {
      if (!flag("replace"))
        throw Error(`${id} exists. Use --replace to recreate the test import.`);
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
    process.stdout.write(
      `\r${id}: ${Math.min(i + 5000, events.length)} / ${events.length}`,
    );
  }
  process.stdout.write("\n");
}
// The dashboard takes the start of history from bucket creation times,
// which are newer than imported data; record the real start per device.
if (first) {
  const settings = await api("settings");
  const starts = settings.project_tracker_history_start || {};
  await api("settings/project_tracker_history_start", {
    ...starts,
    [device]: first,
  });
}
console.log(
  target === "main"
    ? "Imported into this device's history."
    : `Test import done. Open the dashboard with ?hostname=${device}`,
);

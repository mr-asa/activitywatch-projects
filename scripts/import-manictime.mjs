// Imports ManicTime history into ActivityWatch as window and AFK events.
// The dashboard has the same import behind "Import ManicTime" (fine for
// small databases); this script handles very large ones.
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
import { hours, prepareImport, runImport } from "../manictime-core.mjs";

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

// Read a copy: ManicTime keeps writing to its database while running.
const dir = mkdtempSync(join(tmpdir(), "manictime-"));
const copy = join(dir, "reports.db");
copyFileSync(source, copy);
for (const suffix of ["-wal", "-shm"])
  if (existsSync(source + suffix)) copyFileSync(source + suffix, copy + suffix);
const db = new DatabaseSync(copy, { readOnly: true });
let prepared;
try {
  prepared = await prepareImport({
    api,
    query: (sql, params = []) => db.prepare(sql).all(...params),
    until: option("until") ? Date.parse(option("until")) : undefined,
  });
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
const { host, firstReal, until, windows, afk, first } = prepared;
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

const device = await runImport({
  api,
  prepared,
  target,
  replace: flag("replace"),
  progress: (id, done, total) =>
    process.stdout.write(
      `\r${id}: ${done} / ${total}${done === total ? "\n" : ""}`,
    ),
});
console.log(
  target === "main"
    ? "Imported into this device's history."
    : `Test import done. Open the dashboard with ?hostname=${device}`,
);

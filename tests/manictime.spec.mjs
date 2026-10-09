import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, extname } from "node:path";
import { test, expect } from "@playwright/test";
const require = createRequire(import.meta.url);
// A tiny database with the ManicTime tables the importer reads.
async function manictimeDb() {
  const SQL = await require("../vendor/sql-wasm.js")({
    locateFile: (file) => resolve("vendor", file),
  });
  const db = new SQL.Database();
  db.run(`create table Ar_Timeline (ReportId integer, SchemaName text);
    create table Ar_Group (ReportId integer, GroupId integer, Name text, Key text);
    create table Ar_Activity (ReportId integer, GroupId integer, Name text, StartUtcTime text, EndUtcTime text);
    insert into Ar_Timeline values (1, 'ManicTime/Applications'), (2, 'ManicTime/ComputerUsage');
    insert into Ar_Group values (1, 1, 'Maya', 'maya.exe;Maya');
    insert into Ar_Activity values
      (1, 1, 'Demo scene', '2026-07-01 08:00:00', '2026-07-01 09:00:00'),
      (1, 1, 'After cut-off', '2026-09-02 08:00:00', '2026-09-02 09:00:00'),
      (2, null, 'Active', '2026-07-01 08:00:00', '2026-07-01 09:00:00');`);
  const bytes = db.export();
  db.close();
  return Buffer.from(bytes);
}
test("ManicTime history is read in the browser and imported once confirmed", async ({
  page,
}) => {
  const posted = [];
  const types = {
    ".mjs": "text/javascript",
    ".js": "text/javascript",
    ".html": "text/html",
    ".css": "text/css",
    ".wasm": "application/wasm",
    ".json": "application/json",
  };
  await page.route("http://127.0.0.1:5719/**", async (route) => {
    const name =
      new URL(route.request().url()).pathname.slice(1) || "index.html";
    await route.fulfill({
      body: await readFile(resolve(name)),
      contentType: types[extname(name)],
    });
  });
  await page.route("**/api/0/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let data = null;
    if (path.endsWith("/info")) data = { hostname: "TEST" };
    else if (path.endsWith("/buckets/"))
      data = {
        "aw-watcher-window_TEST": { created: "2026-09-01T00:00:00Z" },
        "aw-watcher-afk_TEST": { created: "2026-09-01T00:00:00Z" },
      };
    else if (path.endsWith("/buckets")) data = {};
    else if (path.includes("/events")) {
      if (route.request().method() === "POST")
        posted.push([path, route.request().postDataJSON()]);
      else if (
        url.searchParams.get("limit") === "-1" &&
        url.searchParams.get("end")
      )
        data = [{ timestamp: "2026-09-01T00:00:00Z", duration: 1, data: {} }];
      else data = [];
    } else if (path.endsWith("/query/"))
      data = [{ windows: [], afk: [], web0: [] }];
    await route.fulfill({ json: data });
  });
  await page.goto("/?updatecheck=1");
  await page.getByRole("button", { name: "Import ManicTime" }).click();
  await page.getByLabel("ManicTime database").setInputFiles({
    name: "ManicTimeReports.db",
    mimeType: "application/octet-stream",
    buffer: await manictimeDb(),
  });
  await expect(page.locator("#manictime-dialog [role=status]")).toContainText(
    "Found 1 window events (1.0 h)",
  );
  const run = page.getByRole("button", { name: "Import into ActivityWatch" });
  await expect(run).toBeDisabled();
  await page.getByLabel(/I understand/).check();
  await run.click();
  await expect(page.locator("#notice")).toContainText("imported");
  const windows = posted.find(([path]) => path.includes("window_TEST"));
  expect(windows[1]).toEqual([
    {
      timestamp: "2026-07-01T08:00:00.000Z",
      duration: 3600,
      data: { app: "maya.exe", title: "Demo scene" },
    },
  ]);
  const afk = posted.find(([path]) => path.includes("afk_TEST"));
  expect(afk[1][0].data).toEqual({ status: "not-afk" });
});

import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { test, expect } from "@playwright/test";
const sample = () => ({
  version: 1,
  revision: "initial",
  projects: [
    {
      id: "demo",
      name: "Demo",
      color: "#65d6b4",
      keywords: ["Demo"],
      urls: [],
    },
  ],
  manualAssignments: [],
});
async function setup(page, config = sample(), transform = () => {}) {
  await page.clock.setFixedTime(new Date("2026-09-27T12:00:00Z"));
  const settings = { startOfDay: "04:00", project_tracker: config };
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const t = "2026-09-22T10:00:00Z",
    event = (title, app = "maya.exe", offset = 0) => ({
      timestamp: new Date(Date.parse(t) + offset * 1000).toISOString(),
      duration: 60,
      data: { app, title },
    });
  const fixture = {
    windows: [
      event("Demo scene"),
      event("Personal browsing", "chrome.exe", 60),
      event("Shared task", "Telegram.exe", 120),
    ],
    afk: [{ timestamp: t, duration: 180, data: { status: "not-afk" } }],
    web0: [],
  };
  transform(fixture);
  await page.route("http://127.0.0.1:5719/**", async (route) => {
    const name =
      new URL(route.request().url()).pathname.slice(1) || "index.html";
    if (name.includes("/") || name.includes(".."))
      return route.fulfill({ status: 404, body: "Not found" });
    const body = await readFile(resolve(name));
    await route.fulfill({
      body,
      contentType: {
        ".mjs": "text/javascript",
        ".html": "text/html",
        ".css": "text/css",
      }[extname(name)],
    });
  });
  await page.route("**/api/0/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data;
    if (path.includes("/settings")) {
      const key = path.split("/settings/")[1];
      if (route.request().method() === "POST")
        settings[key] = route.request().postDataJSON();
      data = key ? (settings[key] ?? null) : settings;
    } else if (path.endsWith("/info")) data = { hostname: "TEST" };
    else if (path.endsWith("/buckets"))
      data = {
        "aw-watcher-window_TEST": {
          type: "currentwindow",
          created: "2026-09-01T00:00:00Z",
        },
        "aw-watcher-afk_TEST": { type: "afkstatus" },
        ...(fixture.web0.length && {
          "aw-watcher-web-chrome_TEST": {
            type: "web.tab.current",
            hostname: "TEST",
          },
        }),
      };
    else if (path.endsWith("/query/")) data = [fixture];
    else throw Error(path);
    await route.fulfill({ json: data });
  });
  await page.goto("/?start=2026-09-22T00:00:00Z&end=2026-09-23T00:00:00Z");
  await expect(
    page.getByRole("button", { name: "Edit Demo", exact: true }),
  ).toBeEnabled();
  return { settings, errors };
}
async function confirm(page) {
  await page.getByRole("button", { name: "Confirm save", exact: true }).click();
  await expect(page.locator("#change-preview")).not.toBeVisible();
}

test("workload reuses a covered report but explicit refresh fetches fresh data", async ({
  page,
}) => {
  let queries = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/query/")) queries++;
  });
  const { errors } = await setup(page);
  await expect(page.locator("#workload-status")).toContainText(
    "selected range loaded",
  );
  await page.goto("/?start=2026-09-01T00:00:00Z&end=2026-10-01T00:00:00Z");
  await expect(page.locator("#workload-status")).toContainText(
    "selected range loaded",
  );
  const before = queries;
  expect(before).toBe(3); // Initial day + chart, then the covering report only.
  await page
    .getByLabel("Workload range", { exact: true })
    .selectOption("custom");
  await page.getByLabel("Chart from").fill("2026-09-22");
  await page.getByLabel("Chart through").fill("2026-09-22");
  await page.getByRole("button", { name: "Apply range", exact: true }).click();
  await expect(page.locator("#workload-status")).toContainText(
    "2026-09-22 – 2026-09-22",
  );
  await expect(page.locator("#workload-stats")).toContainText("0.02 h");
  expect(queries).toBe(before);
  await page
    .getByRole("button", { name: "Refresh chart", exact: true })
    .click();
  await expect(page.locator("#workload-status")).toContainText(
    "selected range loaded",
  );
  expect(queries).toBe(before + 1);
  await page.getByLabel("Chart from").fill("2026-08-22");
  await page.getByLabel("Chart through").fill("2026-08-22");
  await page.getByRole("button", { name: "Apply range", exact: true }).click();
  await expect(page.locator("#workload-status")).toContainText(
    "2026-08-22 – 2026-08-22",
  );
  expect(queries).toBe(before + 2);
  expect(errors).toEqual([]);
});
test("explanations, previews and categories survive reload", async ({
  page,
}) => {
  const { settings, errors } = await setup(page);
  await page.getByRole("button", { name: "Explain time", exact: true }).click();
  await expect(page.locator("#activity-explanations")).not.toContainText(
    "title / text: Demo",
  );
  await page.locator("#activity-explanations summary").first().click();
  await expect(page.locator("#activity-explanations")).toContainText(
    "title / text: Demo",
  );
  await expect(page.locator("#activity-explanations")).toContainText(
    "maya.exe",
  );
  await page
    .locator("#activity-explanations")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit Demo", exact: true }).click();
  await page.locator("#project-kind").selectOption("non-project");
  await page
    .getByRole("button", { name: "Preview changes", exact: true })
    .click();
  await expect(page.locator("#change-preview")).toContainText(
    "Non-project time: 0h 0m 0s → 0h 1m 0s",
  );
  await page
    .locator("#change-preview")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  expect(settings.project_tracker.projects[0].kind).toBeUndefined();
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await confirm(page);
  await expect(page.locator("#editor")).not.toBeVisible();
  await expect(page.locator("#assigned")).toHaveText("0h 0m");
  await expect(page.locator("#non-project-total")).toHaveText("0h 1m");
  expect(settings.project_tracker_history).toHaveLength(1);
  await page.reload();
  await expect(page.locator("#non-project-total")).toHaveText("0h 1m");
  await page.screenshot({
    path: "test-results/desktop-workflow.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("archive hides cards without losing history; cutoff stops rules", async ({
  page,
}) => {
  const { settings } = await setup(page);
  await page.getByRole("button", { name: "Edit Demo", exact: true }).click();
  await page.locator("#project-archived").check();
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await confirm(page);
  await expect(page.locator("#editor")).not.toBeVisible();
  await expect(page.locator("#projects .project-card")).toHaveCount(0);
  await expect(page.locator("#assigned")).toHaveText("0h 1m");
  await page.locator("#show-archived").check();
  await page.getByRole("button", { name: "Edit Demo", exact: true }).click();
  await page.locator("#project-rules-through").fill("2026-09-21");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await confirm(page);
  await expect(page.locator("#assigned")).toHaveText("0h 0m");
  expect(settings.project_tracker.projects[0].rulesThrough).toBe("2026-09-21");
});
test("export builds custom columns and manages saved presets", async ({
  page,
}) => {
  const { settings } = await setup(page);
  await page.locator("#report-period").selectOption("week");
  await expect(page.locator("#range-label")).toContainText("Sep 21");
  await page
    .getByRole("button", { name: "Reports & export", exact: true })
    .click();
  const dialog = page.locator("#report-dialog");
  const preview = dialog.getByLabel("Export preview");
  await dialog.getByLabel("Preset").selectOption("builtin:timesheet");
  await dialog.getByLabel("Column 1 of").selectOption("p:demo");
  await expect(dialog.locator(".export-badge")).toHaveText("modified");
  await dialog.getByLabel("Decimals").selectOption("3");
  await expect(preview).toHaveText("Date,Hours\n2026-09-22,0.017\n");
  // A second column: share of all active time.
  await dialog.getByRole("button", { name: "+ Add column" }).click();
  await dialog.getByLabel("Column 2 value").selectOption("share");
  await dialog.getByLabel("Column 2 of").selectOption("p:demo");
  await dialog.getByLabel("Column 2 name").fill("Demo share");
  await expect(preview).toHaveText(
    "Date,Hours,Demo share\n2026-09-22,0.017,33.333\n",
  );
  await dialog.getByLabel("Date format").fill("D.M.YY [г.]");
  await expect(preview).toContainText("22.9.26 г.,0.017,33.333");
  await dialog.getByLabel("Date format").fill("YYYY-MM-DD");
  // Save as a named preset in ActivityWatch settings, then delete it.
  await dialog.getByRole("button", { name: "Save as…" }).click();
  await dialog.getByLabel("Preset name").fill("Demo timesheet");
  await dialog.getByRole("button", { name: "Save preset" }).click();
  await expect(dialog.locator(".export-badge")).toHaveCount(0);
  expect(settings.project_tracker_export_presets.presets[0].name).toBe(
    "Demo timesheet",
  );
  expect(
    settings.project_tracker_export_presets.presets[0].spec.columns,
  ).toHaveLength(2);
  await dialog.getByLabel("Split rows by").selectOption("projects");
  await expect(preview).toContainText("Date,Category,Hours,Demo share");
  await dialog.getByLabel("Preset").selectOption({ label: "Demo timesheet" });
  await expect(preview).toHaveText(
    "Date,Hours,Demo share\n2026-09-22,0.017,33.333\n",
  );
  await dialog.getByRole("button", { name: "Delete" }).click();
  await dialog.getByRole("button", { name: "Confirm delete" }).click();
  await expect
    .poll(() => settings.project_tracker_export_presets.presets.length)
    .toBe(0);
  await dialog.getByLabel("Format", { exact: true }).selectOption("md");
  await expect(preview).toContainText("| Date | Hours | Demo share |");
  const pending = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download", exact: true }).click();
  expect((await pending).suggestedFilename()).toBe(
    "activity-export_2026-09-21_2026-09-27.md",
  );
  // The working spec is remembered for the next export.
  await page.reload();
  await page
    .getByRole("button", { name: "Reports & export", exact: true })
    .click();
  await expect(page.getByLabel("Format", { exact: true })).toHaveValue("md");
  await expect(page.getByLabel("Column 2 name")).toHaveValue("Demo share");
});
test("recovery validates imports and restores revisions with undo history", async ({
  page,
}) => {
  const { settings } = await setup(page);
  await page.getByRole("button", { name: "Edit Demo", exact: true }).click();
  await page.locator("#project-name").fill("Renamed");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await confirm(page);
  await expect(page.locator("#editor")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Settings & recovery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore this version", exact: true })
    .click();
  await confirm(page);
  await expect(
    page.getByRole("button", { name: "Edit Demo", exact: true }),
  ).toBeVisible();
  expect(settings.project_tracker_history).toHaveLength(2);
  await page
    .getByRole("button", { name: "Settings & recovery", exact: true })
    .click();
  await page.getByLabel("Import settings JSON").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":99}'),
  });
  await expect(page.locator("#notice")).toContainText("version 1");
  expect(settings.project_tracker.projects[0].name).toBe("Demo");
  const data = sample();
  data.projects[0].name = "Imported";
  await page.getByLabel("Import settings JSON").setInputFiles({
    name: "valid.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await confirm(page);
  await expect(
    page.getByRole("button", { name: "Edit Imported", exact: true }),
  ).toBeVisible();
});
test("mobile dialogs fit and cancelling save changes nothing", async ({
  page,
}) => {
  const { settings, errors } = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Edit Demo", exact: true }).click();
  await page.locator("#project-name").fill("Unsaved");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await page
    .locator("#change-preview")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(page.locator("#form-error")).toContainText("not saved");
  expect(settings.project_tracker.projects[0].name).toBe("Demo");
  await page.screenshot({
    path: "test-results/mobile-editor.png",
    fullPage: true,
  });
  expect(
    await page
      .locator("#editor")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});

test("conflict explanations and stale-save protection", async ({ page }) => {
  const cfg = sample();
  cfg.projects.push({
    ...cfg.projects[0],
    id: "other",
    name: "Other",
    kind: "non-project",
  });
  const { settings } = await setup(page, cfg);
  await expect(page.locator("#conflicts")).toHaveText("0h 1m");
  await page
    .getByRole("button", { name: "Explain activities", exact: true })
    .click();
  const detail = page
    .locator("#activity-explanations details")
    .filter({ hasText: "Demo scene" });
  await detail.locator("summary").click();
  await expect(detail).toContainText("Needs review");
  await expect(detail).toContainText("Other — title");
  await page
    .locator("#activity-explanations")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit Demo", exact: true }).click();
  await page.locator("#project-name").fill("Draft");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  settings.project_tracker.revision = "external-change";
  await confirm(page);
  await expect(page.locator("#form-error")).toContainText("another tab");
  expect(settings.project_tracker.projects[0].name).toBe("Demo");
  expect(settings.project_tracker_history).toBeUndefined();
});
test("unassigned rule creation and manual overrides use previews", async ({
  page,
}) => {
  const { settings } = await setup(page);
  await page
    .getByRole("button", { name: "Show unassigned activities", exact: true })
    .click();
  const row = page
    .locator(".unassigned-row")
    .filter({ hasText: "Personal browsing" });
  await row
    .getByRole("button", { name: "Add to project", exact: true })
    .click();
  await page.locator("#assign-app").fill("chrome");
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  await expect(page.locator("#change-preview")).toContainText(
    "Project time: 0h 1m 0s → 0h 2m 0s",
  );
  await confirm(page);
  await expect(page.locator("#assign-dialog")).not.toBeVisible();
  expect(settings.project_tracker.projects[0].rules).toHaveLength(2);
  await page
    .getByRole("button", { name: "Assign interval", exact: true })
    .click();
  const ranges = await page.evaluate(() => {
    const date = new Date("2026-09-22T10:02:00Z");
    const local = (d) =>
      new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
    return [local(date), local(new Date(+date + 60000))];
  });
  await page.locator("#manual-start").fill(ranges[0].slice(0, 16));
  await page.locator("#manual-end").fill(ranges[1].slice(0, 16));
  await page.getByRole("button", { name: "Assign time", exact: true }).click();
  await confirm(page);
  await expect(page.locator("#manual-dialog")).not.toBeVisible();
  expect(settings.project_tracker.manualAssignments).toHaveLength(1);
  await expect(page.locator("#assigned")).toHaveText("0h 3m");
  await page.getByRole("button", { name: "Explain time", exact: true }).click();
  const detail = page
    .locator("#activity-explanations details")
    .filter({ hasText: "Shared task" });
  await detail.locator("summary").click();
  await expect(detail).toContainText("manual assignment");
});

test("grouped activity assigns every occurrence without assigning gaps", async ({
  page,
}) => {
  const { settings } = await setup(page, sample(), (fixture) => {
    const start = Date.parse("2026-09-22T10:00:00Z");
    const event = (offset, duration, title) => ({
      timestamp: new Date(start + offset * 1000).toISOString(),
      duration,
      data: { app: "chrome.exe", title },
    });
    fixture.windows.push(
      event(180, 30, "Example tutorial"),
      event(210, 30, "Unrelated gap"),
      event(240, 1770, "Example tutorial"),
    );
    fixture.afk[0].duration = 2010;
  });
  await page
    .getByRole("button", { name: "Show unassigned activities", exact: true })
    .click();
  const row = page
    .locator(".unassigned-row")
    .filter({ hasText: "Example tutorial" });
  await expect(row).toContainText("0h 30m 0s");
  await row
    .getByRole("button", { name: "Assign time only", exact: true })
    .click();
  await expect(page.locator("#manual-occurrence")).toHaveValue("all");
  await expect(page.locator("#manual-scope")).toContainText("0h 30m 0s");
  await expect(page.locator("#manual-start")).toBeEnabled();
  await page.locator("#manual-occurrence").selectOption("0");
  await expect(page.locator("#manual-start")).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Assign time", exact: true }),
  ).toBeVisible();
  await page.locator("#manual-occurrence").selectOption("all");
  await page
    .getByRole("button", { name: "Assign selected occurrences", exact: true })
    .click();
  await expect(page.locator("#change-preview")).toContainText(
    "Project time: 0h 1m 0s → 0h 31m 0s",
  );
  await confirm(page);
  await expect(page.locator("#manual-dialog")).not.toBeVisible();
  expect(settings.project_tracker.manualAssignments).toHaveLength(2);
  expect(
    settings.project_tracker.manualAssignments.reduce(
      (sum, a) => sum + (Date.parse(a.end) - Date.parse(a.start)) / 1000,
      0,
    ),
  ).toBe(1800);
  expect(settings.project_tracker.projects[0].keywords).toEqual(["Demo"]);
  await expect(
    page.locator(".unassigned-row").filter({ hasText: "Example tutorial" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".unassigned-row").filter({ hasText: "Unrelated gap" }),
  ).toContainText("0h 0m 30s");
  await page.reload();
  await expect(page.locator("#assigned")).toHaveText("0h 31m");
});

test("all-occurrence limits clip boundary visits, preserve gaps and subsecond precision", async ({
  page,
}) => {
  const start = Date.parse("2026-09-22T10:00:00Z");
  const { settings } = await setup(page, sample(), (fixture) => {
    const e = (s, d, title) => ({
      timestamp: new Date(start + s * 1000).toISOString(),
      duration: d,
      data: { app: "chrome.exe", title },
    });
    fixture.windows.push(
      e(180.1, 0.2, "Clip example"),
      e(240, 60, "Clip example"),
      e(300, 60, "Gap example"),
      e(360, 60, "Clip example"),
    );
    fixture.afk[0].duration = 420;
  });
  await page
    .getByRole("button", { name: "Show unassigned activities", exact: true })
    .click();
  await page
    .locator(".unassigned-row")
    .filter({ hasText: "Clip example" })
    .getByRole("button", { name: "Assign time only", exact: true })
    .click();
  const values = await page.evaluate(() => [
    +new Date(document.getElementById("manual-start").value),
    +new Date(document.getElementById("manual-end").value),
  ]);
  expect(values).toEqual([start + 180100, start + 420000]);
  await page.locator("#manual-occurrence").selectOption("0");
  const single = await page.evaluate(() => [
    +new Date(document.getElementById("manual-start").value),
    +new Date(document.getElementById("manual-end").value),
  ]);
  expect(single[1] - single[0]).toBe(200);
  await page.locator("#manual-occurrence").selectOption("all");
  async function bounds(a, b) {
    await page.evaluate(
      ([a, b]) => {
        const local = (ms) => {
          const d = new Date(ms);
          return new Date(ms - d.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, -1);
        };
        for (const [id, value] of [
          ["manual-start", a],
          ["manual-end", b],
        ]) {
          const el = document.getElementById(id);
          el.value = local(value);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      },
      [start + a * 1000, start + b * 1000],
    );
  }
  await bounds(310, 350);
  await expect(page.locator("#manual-scope")).toContainText("No occurrences");
  await expect(page.locator("#save-manual")).toBeDisabled();
  await bounds(390, 270);
  await expect(page.locator("#manual-scope")).toContainText("later than");
  await bounds(270, 390);
  await expect(page.locator("#manual-scope")).toContainText(
    "2 of 3 occurrences selected · 0h 1m 0s",
  );
  await page
    .getByRole("button", { name: "Assign selected occurrences", exact: true })
    .click();
  await expect(page.locator("#change-preview")).toContainText(
    "Project time: 0h 1m 0s → 0h 2m 0s",
  );
  await confirm(page);
  await expect(page.locator("#manual-dialog")).not.toBeVisible();
  expect(
    settings.project_tracker.manualAssignments.map((a) => [
      Date.parse(a.start) - start,
      Date.parse(a.end) - start,
    ]),
  ).toEqual([
    [270000, 300000],
    [360000, 390000],
  ]);
  await expect(
    page.locator(".unassigned-row").filter({ hasText: "Gap example" }),
  ).toContainText("0h 1m 0s");
});

test("unassigned pagination keeps all rows searchable", async ({ page }) => {
  await setup(page, sample(), (fixture) => {
    const base = Date.parse("2026-09-22T11:00:00Z");
    for (let i = 0; i < 75; i++)
      fixture.windows.push({
        timestamp: new Date(base + i * 2000).toISOString(),
        duration: 1,
        data: {
          app: "maya.exe",
          title: "Activity " + String(i).padStart(2, "0"),
        },
      });
    fixture.afk[0].duration = 4000;
  });
  await page
    .getByRole("button", { name: "Show unassigned activities", exact: true })
    .click();
  await expect(page.locator(".unassigned-row")).toHaveCount(50);
  await page.getByLabel("Search unassigned activities").fill("Activity 74");
  await expect(page.locator(".unassigned-row")).toHaveCount(1);
  await page.getByLabel("Search unassigned activities").fill("");
  await page
    .locator("#unassigned-rows")
    .getByRole("button", { name: /Show more/ })
    .click();
  await expect(page.locator(".unassigned-row")).toHaveCount(77);
});

test("workload loads current week automatically and reuses range across projects", async ({
  page,
}) => {
  const cfg = sample();
  cfg.projects.push({
    id: "other",
    name: "Other",
    color: "#8ca8ff",
    keywords: ["Other"],
    urls: [],
  });
  let historyQueries = 0;
  page.on("request", (r) => {
    if (
      r.url().endsWith("/query/") &&
      r.postDataJSON()?.timeperiods?.[0]?.startsWith("2026-09-21")
    )
      historyQueries++;
  });
  await setup(page, cfg, (fixture) => {
    const event = (date, title, duration) => ({
      timestamp: date,
      duration,
      data: { app: "maya.exe", title },
    });
    fixture.windows = [
      event("2026-09-20T10:00:00Z", "Demo", 3600),
      event("2026-09-22T10:00:00Z", "Demo", 7200),
      event("2026-09-22T13:00:00Z", "Other", 1800),
    ];
    fixture.afk = fixture.windows.map((e) => ({
      ...e,
      data: { status: "not-afk" },
    }));
  });
  await page.getByLabel("Workload project").selectOption("demo");
  await expect(page.locator("#workload-status")).toContainText(
    "selected range loaded",
  );
  await expect(page.getByLabel("Chart from")).toHaveValue("2026-09-21");
  await expect(page.getByLabel("Chart through")).toHaveValue("2026-09-27");
  await page
    .getByRole("button", { name: "Refresh chart", exact: true })
    .click();
  await expect(page.locator("#workload-status")).toContainText(
    "selected range loaded",
  );
  expect(historyQueries).toBe(2);
  await expect(page.locator("#workload-stats")).toContainText("2 h");
  await expect(page.locator('#workload-chart [role="button"]')).toHaveCount(7);
  await page.locator('#workload-chart [role="button"]').nth(0).focus();
  await expect(page.locator("#workload-detail")).toContainText(
    "No recorded active time",
  );
  await page.screenshot({
    path: "test-results/workload-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("Workload project").selectOption("other");
  await expect(page.locator("#workload-stats")).toContainText("0.5 h");
  expect(historyQueries).toBe(2);
  await page
    .getByLabel("Workload range", { exact: true })
    .selectOption("month");
  await expect(page.getByLabel("Chart from")).toHaveValue("2026-09-01");
  await expect(page.getByLabel("Chart through")).toHaveValue("2026-09-30");
  await expect(page.locator('#workload-chart [role="button"]')).toHaveCount(30);
  await page.getByLabel("Next chart period").click();
  await expect(page.getByLabel("Chart through")).toHaveValue("2026-10-31");
  await expect(page.locator('#workload-chart [role="button"]')).toHaveCount(31);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("workload line overlays use distinct units and an editable whole-day target", async ({
  page,
}) => {
  const cfg = sample();
  cfg.projects.push(
    { id: "q", name: "Other work", color: "#8ca8ff", keywords: ["Other work"] },
    {
      id: "rest",
      name: "Non-project",
      kind: "non-project",
      color: "#edb96d",
      keywords: ["Personal"],
    },
  );
  await setup(page, cfg, (fixture) => {
    fixture.windows = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date("2026-09-18T07:00:00Z");
      day.setUTCDate(day.getUTCDate() + i);
      let cursor = +day;
      for (const [title, hours] of [
        ["Demo", 2 + (i % 3)],
        ["Other work", 3 + (i % 2) + (i === 3 ? 3 : 0)],
        ["Personal", 1],
        ["Unknown", 0.5],
      ]) {
        fixture.windows.push({
          timestamp: new Date(cursor).toISOString(),
          duration: hours * 3600,
          data: { app: "maya.exe", title },
        });
        cursor += hours * 3600000;
      }
    }
    fixture.afk = fixture.windows.map((e) => ({
      ...e,
      data: { status: "not-afk" },
    }));
  });
  await page.getByLabel("Chart from").fill("2026-09-18");
  await page.getByLabel("Chart through").fill("2026-09-24");
  await page.getByLabel("Workload project").selectOption("demo");
  await page
    .getByRole("button", { name: "Refresh chart", exact: true })
    .click();
  await expect(page.locator("#workload-status")).toContainText(
    "selected range loaded",
  );
  await expect(
    page.locator('#workload-chart path[data-series="seconds"]'),
  ).toHaveCount(1);
  await expect(page.locator("#workload-chart")).toContainText("100%");
  await expect(page.locator("#workload-stats>div").nth(2)).toContainText("1 h");
  await page
    .locator("#workload-panel")
    .screenshot({ path: "test-results/workload-lines.png" });
  await page.getByLabel("Daily work target").fill("6");
  await expect(page.locator("#workload-stats>div").nth(2)).toContainText("7 h");
  await page.locator("#workload-nonproject").uncheck();
  await expect(page.locator('[data-series="nonProjectPercent"]')).toHaveCount(
    0,
  );
  await page.getByLabel("Daily work target").fill("");
  await expect(page.locator("#workload-stats>div").nth(2)).toContainText(
    "Set a target",
  );
  await page.locator("#workload-all").uncheck();
  await expect(page.locator('[data-series="work"]')).toHaveCount(0);
  // All projects: work, non-project and unclassified layers add up to the day.
  await page.getByLabel("Workload project").selectOption("");
  for (const id of ["demo", "q", "rest", "unclassified"])
    await expect(
      page.locator(`#workload-chart path[data-stack="${id}"]`),
    ).toHaveCount(1);
  await expect(
    page.locator('#workload-chart path[data-series="tracked"]'),
  ).toHaveCount(1);
  await page.locator("#workload-chart rect[role=button]").first().focus();
  await expect(page.locator("#workload-detail")).toContainText(
    "All active time: 6.5 h",
  );
  await expect(page.locator("#workload-detail")).toContainText(
    "Unclassified: 0.5 h",
  );
  await page
    .locator("#workload-panel")
    .screenshot({ path: "test-results/workload-stack.png" });
  await page.locator("#workload-total").uncheck();
  await expect(
    page.locator('#workload-chart path[data-series="tracked"]'),
  ).toHaveCount(0);
});

test("activity types remain independent and all projects stack without double counting", async ({
  page,
}) => {
  const cfg = sample();
  cfg.projects[0].keywords.push("Shared task");
  cfg.projects.push({
    id: "other",
    name: "Other",
    color: "#edb96d",
    keywords: ["Personal"],
  });
  const { settings, errors } = await setup(page, cfg);
  await page
    .getByRole("button", { name: "+ Add activity type", exact: true })
    .click();
  await page.locator("#activity-name").fill("Messaging");
  await page.locator("#activity-apps").fill("Telegram");
  await page
    .getByRole("button", { name: "Save activity type", exact: true })
    .click();
  await expect(page.locator("#change-preview")).toContainText("Activity types");
  await confirm(page);
  await expect(page.locator("#activity-type-editor")).not.toBeVisible();
  expect(settings.project_tracker.activityTypes).toHaveLength(1);
  expect(settings.project_tracker.projects).toEqual(cfg.projects);
  await expect(page.locator("#activity-type-totals")).toContainText(
    "Messaging",
  );
  await page.getByLabel("Activity project scope").selectOption("demo");
  await expect(page.locator("#activity-type-totals")).toContainText("50.0%");
  await page
    .getByRole("button", { name: "Refresh chart", exact: true })
    .click();
  await expect(page.getByLabel("Workload project")).toHaveValue("");
  await expect(page.locator("#workload-stats")).toContainText("0.05 h");
  await expect(page.locator("#workload-chart [data-stack]")).toHaveCount(2);
  await expect(page.getByLabel("Show activity Messaging")).toBeChecked();
  await expect(
    page.locator('#workload-chart [data-series="activity-0"]'),
  ).toHaveCount(1);
  await page.getByLabel("Show activity Messaging").uncheck();
  await expect(
    page.locator('#workload-chart [data-series="activity-0"]'),
  ).toHaveCount(0);
  await page.getByLabel("Show activity Messaging").check();
  await expect(page.locator("#workload-stats")).toContainText("0.05 h");
  await page.screenshot({
    path: "test-results/activity-types-stack.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator("#activity-type-totals")).toContainText(
    "Messaging",
  );
  expect(errors).toEqual([]);
});

test("unassigned activity can be added to an existing or new activity type", async ({
  page,
}) => {
  const cfg = sample();
  cfg.activityTypes = [
    {
      id: "chat",
      name: "Messaging",
      color: "#8ca8ff",
      applications: ["Telegram"],
      titles: [],
      urls: [],
      mode: "text",
    },
  ];
  const { settings, errors } = await setup(page, cfg);
  await page
    .getByRole("button", { name: "Show unassigned activities", exact: true })
    .click();
  const row = page
    .locator(".unassigned-row")
    .filter({ hasText: "Personal browsing" });
  await expect(row.locator(".activity-type-tag")).toHaveText(
    "No activity type",
  );
  await row
    .getByRole("button", { name: "Add to activity type…", exact: true })
    .click();
  // A title added to an application-wide type becomes a separate combination.
  await expect(page.locator("#type-assign-kind")).toHaveValue("app-title");
  await expect(page.locator("#type-assign-value")).toHaveValue(
    "Personal browsing",
  );
  await expect(page.locator("#type-assign-hint")).toContainText(
    "separate combination",
  );
  await page.locator("#type-assign-value").fill("Personal");
  await page.getByRole("button", { name: "Add to type", exact: true }).click();
  await confirm(page);
  await expect(page.locator("#type-assign-dialog")).not.toBeVisible();
  const saved = settings.project_tracker.activityTypes[0];
  expect(saved.applications).toEqual(["Telegram"]);
  expect(saved.titles).toEqual([]);
  expect(saved.combinations).toEqual([
    { app: "chrome.exe", title: "Personal" },
  ]);
  expect(settings.project_tracker.projects).toEqual(cfg.projects);
  await expect(row.locator(".activity-type-tag")).toHaveText("Messaging");
  await page.locator("#unassigned-panel").screenshot({
    path: "test-results/unassigned-activity-types.png",
  });
  // Both remaining rows now carry Messaging, so hiding typed rows empties the list.
  await page.getByLabel("Hide activities").check();
  await expect(page.locator(".unassigned-row")).toHaveCount(0);
  await expect(page.locator("#unassigned-count")).toContainText(
    "2 with activity types hidden",
  );
  await expect(page.locator("#unassigned-rows")).toContainText(
    "already has an activity type",
  );
  await page.getByLabel("Hide activities").uncheck();
  await expect(page.locator(".unassigned-row")).toHaveCount(2);

  const telegram = page
    .locator(".unassigned-row")
    .filter({ hasText: "Shared task" });
  await telegram
    .getByRole("button", { name: "Add to activity type…", exact: true })
    .click();
  await page.locator("#type-assign-type").selectOption("__new__");
  await page
    .getByRole("button", { name: "Continue to new type", exact: true })
    .click();
  await expect(page.locator("#activity-type-editor")).toBeVisible();
  await expect(page.locator("#activity-combinations")).toHaveValue(
    "Telegram.exe | Shared task",
  );
  await expect(page.locator("#activity-apps")).toHaveValue("");
  await page.locator("#activity-name").fill("Tasks");
  await page
    .getByRole("button", { name: "Save activity type", exact: true })
    .click();
  await confirm(page);
  await expect
    .poll(() => settings.project_tracker.activityTypes[1]?.combinations)
    .toEqual([{ app: "Telegram.exe", title: "Shared task" }]);
  // Editing a type keeps its combinations.
  await page
    .getByRole("button", { name: "Edit activity type Tasks", exact: true })
    .click();
  await expect(page.locator("#activity-combinations")).toHaveValue(
    "Telegram.exe | Shared task",
  );
  expect(errors).toEqual([]);
});

test("workload presets cover rolling days and a whole project span", async ({
  page,
}) => {
  const queries = [];
  await setup(page);
  await page.route("**/api/0/query/", async (route) => {
    queries.push(route.request().postDataJSON().timeperiods[0]);
    await route.fallback();
  });
  const range = page.getByLabel("Workload range");
  await range.selectOption("last7");
  await expect(page.getByLabel("Chart from")).toHaveValue("2026-09-21");
  await expect(page.getByLabel("Chart through")).toHaveValue("2026-09-27");
  await range.selectOption("last30");
  await expect(page.getByLabel("Chart from")).toHaveValue("2026-08-29");
  await page.getByLabel("Previous chart period").click();
  await expect(page.getByLabel("Chart from")).toHaveValue("2026-07-30");
  await expect(page.getByLabel("Chart through")).toHaveValue("2026-08-28");

  await range.selectOption("project");
  await expect(page.getByLabel("Previous chart period")).toBeDisabled();
  await expect(page.locator("#workload-status")).toContainText("whole project");
  // History is scanned from the window bucket creation date.
  const scanStart = Date.parse(queries.at(-1).split("/")[0]);
  expect(scanStart).toBeLessThanOrEqual(Date.parse("2026-09-01T00:00:00Z"));
  expect(scanStart).toBeGreaterThan(Date.parse("2026-08-30T00:00:00Z"));
  await expect(page.getByLabel("Chart from")).toHaveValue("2026-09-22");
  await expect(page.getByLabel("Chart through")).toHaveValue("2026-09-22");
  await expect(page.locator("#workload-chart svg")).toHaveCount(1);
});

test("clicking a chart day opens it in the report at full width", async ({
  page,
}) => {
  await setup(page);
  await page.locator("#report-period").selectOption("week");
  const chart = page.locator("#workload-chart");
  await chart.locator("svg").waitFor();
  // The drawing uses the panel width instead of a scaled fixed canvas.
  const [panel, svg] = await chart.evaluate((c) => [
    c.clientWidth,
    c.querySelector("svg").viewBox.baseVal.width,
  ]);
  expect(Math.abs(panel - svg)).toBeLessThan(5);
  await chart.getByRole("button", { name: /^2026-09-24:/ }).click();
  await expect(page.locator("#date")).toHaveValue("2026-09-24");
  await expect(page.locator("#report-period")).toHaveValue("day");
  await expect(page.locator("#range-label")).toContainText("24");
});

test("view preferences survive a reload", async ({ page }) => {
  const cfg = sample();
  cfg.activityTypes = [
    {
      id: "chat",
      name: "Messaging",
      color: "#8ca8ff",
      applications: ["Telegram"],
      titles: [],
      urls: [],
      mode: "text",
    },
  ];
  await setup(page, cfg);
  await page.locator("#report-period").selectOption("week");
  await page.locator("#show-archived").check();
  await page.getByLabel("Workload range").selectOption("last7");
  await page.getByLabel("Workload project").selectOption("demo");
  await page.locator("#workload-trend").uncheck();
  await page.getByLabel("Daily work target").fill("6");
  await page.getByLabel("Show activity Messaging").uncheck();
  await page.getByLabel("Activity project scope").selectOption("demo");
  await page
    .getByRole("button", { name: "Show unassigned activities", exact: true })
    .click();
  await page.getByLabel("Hide activities").check();

  await page.reload();
  await expect(
    page.getByRole("button", { name: "Edit Demo", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("#report-period")).toHaveValue("week");
  await expect(page.locator("#show-archived")).toBeChecked();
  await expect(page.getByLabel("Workload range")).toHaveValue("last7");
  await expect(page.getByLabel("Chart from")).toHaveValue("2026-09-21");
  await expect(page.getByLabel("Workload project")).toHaveValue("demo");
  await expect(page.locator("#workload-trend")).not.toBeChecked();
  await expect(page.getByLabel("Daily work target")).toHaveValue("6");
  await expect(page.getByLabel("Show activity Messaging")).not.toBeChecked();
  await expect(page.getByLabel("Activity project scope")).toHaveValue("demo");
  await expect(page.getByLabel("Hide activities")).toBeChecked();
});

test("legacy projects.html forwards to the dashboard with its parameters", async ({
  page,
}) => {
  await setup(page);
  await page.goto(
    "/projects.html?start=2026-09-22T00:00:00Z&end=2026-09-23T00:00:00Z",
  );
  await expect(page).toHaveURL(/\/index\.html\?start=2026-09-22/);
  await expect(page.locator("#assigned")).toHaveText("0h 1m");
});

test("date navigation during a load is applied after it finishes", async ({
  page,
}) => {
  let queries = 0,
    release;
  const gate = new Promise((r) => (release = r));
  await setup(page);
  await page.route("**/api/0/query/", async (route) => {
    queries++;
    if (queries === 1) await gate;
    await route.fallback();
  });
  await page.locator("#refresh").click();
  await expect.poll(() => queries).toBe(1);
  await page.locator("#next-day").click();
  release();
  await expect.poll(() => queries).toBe(2);
  await expect(page.locator("#date")).toHaveValue("2026-09-23");
  await expect(page.locator("#range-label")).toContainText("23");
});

test("assign application time collects all titles despite search and preserves assigned time", async ({
  page,
}) => {
  const { settings } = await setup(page, sample(), (fixture) => {
    fixture.windows[1].data = { app: "maya.exe", title: "Unassigned scene A" };
    fixture.windows[2].data = { app: "maya.exe", title: "Unassigned scene B" };
  });
  await page
    .getByRole("button", { name: "Show unassigned activities", exact: true })
    .click();
  await page.locator("#unassigned-search").fill("scene A");
  await page
    .getByRole("button", { name: "Assign app time…", exact: true })
    .click();
  await expect(page.locator("#manual-source")).toContainText("all titles");
  await expect(page.locator("#manual-source")).toContainText(
    "unassigned time only",
  );
  await page.locator("#save-manual").click();
  await confirm(page);
  await expect(page.locator("#manual-dialog")).not.toBeVisible();
  await expect
    .poll(() =>
      settings.project_tracker.manualAssignments?.reduce(
        (n, a) => n + (Date.parse(a.end) - Date.parse(a.start)) / 1000,
        0,
      ),
    )
    .toBe(120);
});
test("scrolling inside an open dialog never scrolls the page behind it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 520 });
  await setup(page);
  await page
    .getByRole("button", { name: "Reports & export", exact: true })
    .click();
  const dialog = page.locator("#report-dialog");
  await expect(dialog.getByLabel("Export preview")).toContainText("Date");
  await page.evaluate(() => window.scrollTo(0, 200));
  const pageScroll = () => page.evaluate(() => window.scrollY);
  const before = await pageScroll();
  expect(before).toBeGreaterThan(0);
  const box = await dialog.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 40);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 800);
  await expect
    .poll(() => dialog.evaluate((d) => d.scrollTop))
    .toBeGreaterThan(0);
  expect(await pageScroll()).toBe(before);
  // Over the backdrop, too.
  await page.mouse.move(5, 5);
  await page.mouse.wheel(0, -800);
  await page.mouse.wheel(0, 800);
  expect(await pageScroll()).toBe(before);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.mouse.wheel(0, 300);
  await expect.poll(pageScroll).toBeGreaterThan(before);
});
test("a rule added from unassigned activity joins the matching rule group", async ({
  page,
}) => {
  const { settings } = await setup(page);
  await page
    .getByRole("button", { name: "Show unassigned activities", exact: true })
    .click();
  await page
    .locator(".unassigned-row")
    .filter({ hasText: "Personal browsing" })
    .getByRole("button", { name: "Add to project", exact: true })
    .click();
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  await confirm(page);
  await expect(page.locator("#notice")).toContainText(
    "Pattern added to an existing rule group in Demo",
  );
  expect(
    settings.project_tracker.projects[0].rules.map((r) => r.pattern),
  ).toEqual(["Demo", "Personal browsing"]);
  await page.getByRole("button", { name: "Edit Demo", exact: true }).click();
  await expect(page.locator("#rule-rows textarea")).toHaveCount(1);
  await expect(page.locator("#rule-rows textarea")).toHaveValue(
    "Demo\nPersonal browsing",
  );
});
test("dialogs open where the ActivityWatch page is scrolled to", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 600 });
  await setup(page);
  // ActivityWatch embeds the dashboard in a frame below its own header.
  await page.route("**/aw-host.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<body style="margin:0"><div style="height:400px">ActivityWatch</div><div class="col-md-6"><iframe src="/?start=2026-09-22T00:00:00Z&end=2026-09-23T00:00:00Z" style="border:0;width:100%"></iframe></div></body>',
    }),
  );
  await page.goto("/aw-host.html");
  const frame = page.frameLocator("iframe");
  await expect(
    frame.getByRole("button", { name: "Edit Demo", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => window.scrollTo(0, 700));
  const scrollY = () => page.evaluate(() => window.scrollY);
  // Click without Playwright scrolling the page to the button.
  await frame
    .getByRole("button", { name: "Edit Demo", exact: true })
    .evaluate((b) => b.click());
  await expect(frame.locator("#editor")).toBeVisible();
  expect(await scrollY()).toBe(700);
  const box = await frame.locator("#editor").boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(600);
  await frame
    .locator("#editor")
    .getByRole("button", { name: "Cancel", exact: true })
    .evaluate((b) => b.click());
  await expect(frame.locator("#editor")).not.toBeVisible();
  expect(await scrollY()).toBe(700);
});
test("URL rules can be cut to a folder with readable links and live coverage", async ({
  page,
}) => {
  const folder =
    "https://disk.example.com/client/disk/Twin%20%D0%BF%D1%80%D0%BE%D0%B5%D0%BA%D1%82/2609_DEMO";
  const { settings } = await setup(page, sample(), (fixture) => {
    const t = Date.parse(fixture.afk[0].timestamp);
    const at = (s) => new Date(t + s * 1000).toISOString();
    fixture.windows = [
      {
        timestamp: at(0),
        duration: 60,
        data: { app: "maya.exe", title: "Demo scene" },
      },
      {
        timestamp: at(60),
        duration: 120,
        data: { app: "chrome.exe", title: "Disk" },
      },
    ];
    fixture.web0 = [
      {
        timestamp: at(60),
        duration: 60,
        data: { url: folder + "/MOV", title: "Disk" },
      },
      {
        timestamp: at(120),
        duration: 60,
        data: { url: folder, title: "Disk" },
      },
    ];
  });
  await page
    .getByRole("button", { name: "Show unassigned activities", exact: true })
    .click();
  const rows = page.locator(".unassigned-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Twin проект/2609_DEMO");
  await page.getByLabel("Search unassigned activities").fill("проект");
  await expect(rows).toHaveCount(2);
  await rows
    .filter({ hasText: "/MOV" })
    .getByRole("button", { name: "Add to project", exact: true })
    .click();
  await expect(page.locator("#assign-kind")).toHaveValue("url");
  await expect(page.locator("#assign-rule")).toHaveValue(
    "https://disk.example.com/client/disk/Twin проект/2609_DEMO/MOV",
  );
  await expect(page.locator("#assign-coverage")).toContainText(
    "Matches 1 unassigned entry",
  );
  await page.getByRole("button", { name: "Match 2609_DEMO and below" }).click();
  await expect(page.locator("#assign-rule")).toHaveValue(
    "https://disk.example.com/client/disk/Twin проект/2609_DEMO",
  );
  await expect(page.locator("#assign-coverage")).toContainText(
    "Matches 2 unassigned entries",
  );
  await expect(
    page.getByRole("button", { name: "Match 2609_DEMO and below" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Match the whole site" }).click();
  await expect(page.locator("#assign-coverage")).toContainText(
    "the whole site",
  );
  await page
    .locator("#assign-rule")
    .fill("https://disk.example.com/client/disk/Twin проект/2609_DEMO");
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  await confirm(page);
  await expect
    .poll(() => settings.project_tracker.projects[0].rules?.at(-1))
    .toMatchObject({ type: "url", pattern: folder });
  await expect(rows).toHaveCount(0);
  // The rule editor shows the link readably and keeps the rule's identity.
  await page.getByRole("button", { name: "Edit Demo", exact: true }).click();
  await expect(page.locator("#rule-rows textarea").last()).toHaveValue(
    "https://disk.example.com/client/disk/Twin проект/2609_DEMO",
  );
});
test("dialogs fit inside ActivityWatch's scrolling content area", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await setup(page);
  // Header and footer outside a scrolling container that holds the frame.
  await page.route("**/aw-layout.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<body style="margin:0;overflow:hidden"><header style="height:64px">ActivityWatch</header><main id="content" style="position:absolute;top:64px;bottom:100px;left:0;right:0;overflow:auto"><div style="height:300px"></div><div class="col-md-6"><iframe src="/?start=2026-09-22T00:00:00Z&end=2026-09-23T00:00:00Z" style="border:0;width:100%"></iframe></div></main><footer style="position:absolute;bottom:0;height:100px">Edit view</footer></body>',
    }),
  );
  await page.goto("/aw-layout.html");
  const frame = page.frameLocator("iframe");
  await expect(
    frame.getByRole("button", { name: "Edit Demo", exact: true }),
  ).toBeEnabled();
  await page.evaluate(
    () => (document.getElementById("content").scrollTop = 500),
  );
  await frame
    .getByRole("button", { name: "Edit Demo", exact: true })
    .evaluate((b) => b.click());
  const box = await frame.locator("#editor").boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(64);
  expect(box.y + box.height).toBeLessThanOrEqual(600);
  expect(
    await page.evaluate(() => document.getElementById("content").scrollTop),
  ).toBe(500);
});
test("a project's common start date limits its rules and the whole-project scan", async ({
  page,
}) => {
  const queries = [];
  const { settings } = await setup(page);
  await page.route("**/api/0/query/", async (route) => {
    queries.push(route.request().postDataJSON().timeperiods[0]);
    await route.fallback();
  });
  await page.getByRole("button", { name: "Edit Demo", exact: true }).click();
  await page.locator("#project-rules-from").fill("2026-09-20");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await confirm(page);
  await expect
    .poll(() => settings.project_tracker.projects[0].rulesFrom)
    .toBe("2026-09-20");
  await expect(page.locator("#assigned")).toHaveText("0h 1m");
  // Whole project scans from the common start, not from 2026-09-01.
  await page.getByLabel("Workload project").selectOption("demo");
  await page.getByLabel("Workload range").selectOption("project");
  await expect(page.locator("#workload-status")).toContainText("whole project");
  const scanStart = Date.parse(queries.at(-1).split("/")[0]);
  expect(scanStart).toBeGreaterThan(Date.parse("2026-09-18T00:00:00Z"));
  expect(scanStart).toBeLessThan(Date.parse("2026-09-20T12:00:00Z"));
  await expect(page.getByLabel("Chart from")).toHaveValue("2026-09-22");
  // A start after the recorded time: the rules no longer match that day.
  await page.getByRole("button", { name: "Edit Demo", exact: true }).click();
  await page.locator("#project-rules-from").fill("2026-09-23");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await confirm(page);
  await expect(page.locator("#assigned")).toHaveText("0h 0m");
});
test("long chart ranges fit the width as weekly averages", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await setup(page);
  await page.getByLabel("Chart from").fill("2026-01-01");
  await page.getByLabel("Chart through").fill("2026-09-24");
  await page.getByRole("button", { name: "Apply range", exact: true }).click();
  await expect(page.locator("#workload-status")).toContainText(
    "selected range loaded",
  );
  const chart = page.locator("#workload-chart");
  await expect(chart).toContainText("Weekly averages per recorded day");
  // No horizontal scrolling.
  expect(await chart.evaluate((c) => c.scrollWidth <= c.clientWidth + 1)).toBe(
    true,
  );
  const last = chart.locator("rect[role=button]").last();
  await last.focus();
  await expect(page.locator("#workload-detail")).toContainText(
    "2026-09-21 – 2026-09-24 · average per recorded day (1 of 4 days)",
  );
  await last.press("Enter");
  await expect(page.locator("#report-period")).toHaveValue("week");
  await expect(page.locator("#date")).toHaveValue("2026-09-21");
});

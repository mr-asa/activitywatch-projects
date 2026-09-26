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
      data = key ? settings[key] : settings;
    } else if (path.endsWith("/info")) data = { hostname: "TEST" };
    else if (path.endsWith("/buckets"))
      data = {
        "aw-watcher-window_TEST": { type: "currentwindow" },
        "aw-watcher-afk_TEST": { type: "afkstatus" },
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
test("week report exports Markdown and CSV", async ({ page }) => {
  await setup(page);
  await page.locator("#report-period").selectOption("week");
  await expect(page.locator("#range-label")).toContainText("Sep 21");
  await page
    .getByRole("button", { name: "Reports & export", exact: true })
    .click();
  await expect(page.locator("#report-dialog")).toContainText("Demo");
  await expect(page.locator("#report-dialog")).toContainText("Not assigned");
  for (const [label, name] of [
    ["Download CSV", "activity-report.csv"],
    ["Download Markdown", "activity-report.md"],
  ]) {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: label, exact: true }).click();
    expect((await pending).suggestedFilename()).toBe(name);
  }
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

test("project workload loads full history on demand and reuses it across projects", async ({
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
      r.postDataJSON()?.timeperiods?.[0]?.startsWith("1970")
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
  expect(historyQueries).toBe(0);
  await page
    .getByRole("button", { name: "Load full history", exact: true })
    .click();
  await expect(page.locator("#workload-status")).toContainText(
    "Full recorded history",
  );
  expect(historyQueries).toBe(1);
  await expect(page.locator("#workload-stats")).toContainText("3 h");
  await expect(page.locator('#workload-chart [role="button"]')).toHaveCount(3);
  await page.locator('#workload-chart [role="button"]').nth(1).focus();
  await expect(page.locator("#workload-detail")).toContainText("0 h");
  await page.screenshot({
    path: "test-results/workload-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("Workload project").selectOption("other");
  await expect(page.locator("#workload-stats")).toContainText("0.5 h");
  expect(historyQueries).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

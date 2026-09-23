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
async function setup(page, config = sample()) {
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

import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { test, expect } from "@playwright/test";
async function open(page, release) {
  await page.clock.setFixedTime(new Date("2026-09-27T12:00:00Z"));
  await page.route("http://127.0.0.1:5719/**", async (route) => {
    const name =
      new URL(route.request().url()).pathname.slice(1) || "index.html";
    const body = await readFile(resolve(name));
    await route.fulfill({
      body,
      contentType: {
        ".mjs": "text/javascript",
        ".html": "text/html",
        ".css": "text/css",
        ".json": "application/json",
      }[extname(name)],
    });
  });
  await page.route("https://api.github.com/**", (route) =>
    route.fulfill({ json: release }),
  );
  await page.route("**/api/0/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data = null;
    if (path.endsWith("/info")) data = { hostname: "TEST" };
    else if (path.endsWith("/buckets")) data = {};
    else if (path.endsWith("/query/"))
      data = [{ windows: [], afk: [], web0: [] }];
    await route.fulfill({ json: data });
  });
  await page.goto("/?updatecheck=1");
}
const release = (tag) => ({
  tag_name: tag,
  html_url: `https://github.com/mr-asa/activitywatch-projects/releases/tag/${tag}`,
  body: "Notes",
});
test("a newer release shows a banner and the installed version", async ({
  page,
}) => {
  await open(page, release("v9.0.0"));
  await expect(page.locator("#app-version")).toHaveText(/^v\d+\.\d+\.\d+$/);
  await expect(page.locator("#update-banner")).toContainText(
    "Version 9.0.0 is available",
  );
  await page.getByRole("button", { name: "Later" }).click();
  await expect(page.locator("#update-banner")).toBeHidden();
});
test("no banner when already up to date", async ({ page }) => {
  await open(page, release("v0.0.1"));
  await expect(page.locator("#app-version")).toBeVisible();
  await expect(page.locator("#update-banner")).toBeHidden();
});

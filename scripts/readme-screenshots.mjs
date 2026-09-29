// Generates the README screenshots from the real dashboard with invented demo
// data: no personal projects, titles or links ever reach the images.
// Usage: npm run screenshots   (needs `npx playwright install chromium` once)
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "@playwright/test";
import { analyze } from "../projects-core.mjs";
import { analyzeActivityTypes } from "../activity-core.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "docs/images");
const HOST = "DEMO-PC";
const TODAY = "2026-09-23"; // a Wednesday; the page opens on this day
const NOW = Date.parse(TODAY + "T20:30:00Z");
const DAYS = 31;
const day0 = Date.parse(TODAY + "T00:00:00Z");

// Deterministic pseudo-random numbers so every run draws the same pictures.
let seed;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (list) => list[Math.floor(rand() * list.length)];

const rule = (id, pattern, extra = {}) => ({
  id,
  type: "title",
  mode: "text",
  pattern,
  ignoreCase: true,
  from: "",
  through: "",
  appFilter: "",
  ...extra,
});
const config = {
  version: 1,
  revision: "demo",
  projects: [
    {
      id: "website",
      name: "Website redesign",
      color: "#65d6b4",
      kind: "project",
      rules: [
        rule("w1", "Website redesign"),
        rule("w2", "website", { appFilter: "Code" }),
        rule("w3", "Landing page"),
        {
          ...rule("w4", "https://github.com/example/website"),
          type: "url",
        },
      ],
    },
    {
      id: "mobile",
      name: "Mobile app",
      color: "#8ca8ff",
      kind: "project",
      rules: [
        rule("m1", "mobile-app"),
        rule("m2", "Onboarding flow"),
        rule("m3", "Mobile standup", { appFilter: "Zoom" }),
      ],
    },
    {
      id: "report",
      name: "Quarterly report",
      color: "#edb96d",
      kind: "project",
      rules: [rule("r1", "Q3 report")],
    },
    {
      id: "admin",
      name: "Admin & email",
      color: "#d79aeb",
      kind: "non-project",
      rules: [rule("a1", ".*", { mode: "regex", appFilter: "Outlook" })],
    },
  ],
  manualAssignments: [],
  activityTypes: [
    {
      id: "messaging",
      name: "Messaging",
      color: "#6dcce2",
      applications: ["Telegram", "Slack"],
      titles: [],
      urls: [],
      combinations: [],
      mode: "text",
    },
    {
      id: "calls",
      name: "Calls",
      color: "#f18d9c",
      applications: ["Zoom"],
      titles: [],
      urls: [],
      combinations: [],
      mode: "text",
    },
    {
      id: "design",
      name: "Design",
      color: "#b5cc78",
      applications: ["Figma"],
      titles: [],
      urls: [],
      combinations: [{ app: "chrome.exe", title: "Dribbble" }],
      mode: "text",
    },
  ],
};

// What a working day is made of: [weight, app, titles, url?].
const WORK = [
  [
    5,
    "Figma.exe",
    [
      "Website redesign – Homepage v3 – Figma",
      "Website redesign – Pricing page – Figma",
    ],
  ],
  [
    5,
    "Code.exe",
    [
      "header.tsx - website - Visual Studio Code",
      "styles.css - website - Visual Studio Code",
    ],
  ],
  [
    2,
    "chrome.exe",
    ["Pull request #214 · example/website - Google Chrome"],
    "https://github.com/example/website/pull/214",
  ],
  [
    4,
    "Code.exe",
    [
      "LoginScreen.kt - mobile-app - Visual Studio Code",
      "build.gradle - mobile-app - Visual Studio Code",
    ],
  ],
  [3, "Figma.exe", ["Onboarding flow – Mobile – Figma"]],
  [1, "Zoom.exe", ["Mobile standup - Zoom Meeting"]],
  [3, "EXCEL.EXE", ["Q3 report.xlsx - Excel"]],
  [1, "WINWORD.EXE", ["Q3 report - summary.docx - Word"]],
  [
    2,
    "OUTLOOK.EXE",
    ["Inbox - Outlook", "Re: Invoice for September - Outlook"],
  ],
  [2, "Telegram.exe", ["Design team", "Anna"]],
  [2, "Slack.exe", ["#general - Acme - Slack", "#mobile - Acme - Slack"]],
  [1, "Zoom.exe", ["Weekly sync - Zoom Meeting"]],
  [
    1,
    "chrome.exe",
    ["How to center a div - YouTube - Google Chrome"],
    "https://www.youtube.com/watch?v=demo",
  ],
  [
    1,
    "chrome.exe",
    ["Dribbble - Discover the world's top designers - Google Chrome"],
    "https://dribbble.com/shots/popular",
  ],
  [1, "Spotify.exe", ["Spotify Premium"]],
  [1, "explorer.exe", ["Downloads - File Explorer"]],
  [1, "notepad.exe", ["notes.txt - Notepad"]],
];
const bag = WORK.flatMap((w) => Array(w[0]).fill(w));
const SHORT = new Set([
  "Telegram.exe",
  "Slack.exe",
  "Spotify.exe",
  "explorer.exe",
  "notepad.exe",
]);

function generate(start) {
  seed = start;
  const windows = [],
    afk = [],
    web = [];
  const event = (list, start, seconds, data) =>
    list.push({
      timestamp: new Date(start).toISOString(),
      duration: seconds,
      data,
    });
  for (let d = DAYS - 1; d >= 0; d--) {
    const day = day0 - d * 86400000;
    const weekend = [0, 6].includes(new Date(day).getUTCDay());
    if (weekend && rand() < 0.6) continue;
    // Work blocks around a lunch break; weekends are short.
    const blocks = weekend
      ? [[11, 11 + 1 + rand() * 1.5]]
      : [
          [9 + rand() * 0.7, 12.8 + rand() * 0.4],
          [13.9 + rand() * 0.3, 17 + rand() * 2],
        ];
    for (const [from, to] of blocks) {
      let t = day + from * 3600000;
      const end = day + to * 3600000;
      event(afk, t, (end - t) / 1000, { status: "not-afk" });
      while (t < end) {
        const [, app, titles, url] = pick(bag);
        const title = pick(titles);
        // Chats and distractions come in short bursts, focused work in long ones.
        const burst =
          (SHORT.has(app) || url?.includes("youtube")
            ? 2 + rand() * 6
            : 10 + rand() * 40) * 60000;
        const stop = Math.min(t + burst, end);
        for (let s = t; s < stop; ) {
          // Events never cross the burst end, so nothing overlaps.
          const seconds = Math.min(60 + rand() * 240, (stop - s) / 1000);
          event(windows, s, seconds, { app, title });
          if (url) event(web, s, seconds, { url, title, audible: false });
          s += seconds * 1000;
        }
        t += burst;
      }
      event(afk, end, 3600, { status: "afk" });
    }
  }
  return { windows, afk, web };
}
// Keep the first seed whose "today" shows every feature well: all projects
// and activity types have time, nothing conflicts, and a little is unassigned.
function representative({ windows, afk, web }) {
  const start = day0 + 4 * 3600000,
    end = NOW;
  const data = { windows, afk, browsers: [{ family: "chrome", events: web }] };
  const r = analyze(data, config.projects, start, end);
  const types = analyzeActivityTypes(data, config.activityTypes, start, end);
  const share = r.unassigned / r.tracked;
  return (
    r.conflict === 0 &&
    share > 0.03 &&
    share < 0.12 &&
    r.projects.every((p) => p.total > 900) &&
    r.projects.some((p) => p.browser > 600) &&
    types.projects.every((t) => t.total > 900)
  );
}
let chosen = 0;
while (!representative(generate(++chosen)) && chosen < 5000);
const { windows, afk, web } = generate(chosen);
console.log("Demo data seed:", chosen);
const overlapping = (list, start, end) =>
  list.filter((e) => {
    const s = Date.parse(e.timestamp);
    return s < end && s + e.duration * 1000 > start;
  });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  timezoneId: "UTC",
  deviceScaleFactor: 2,
  colorScheme: "dark",
});
// Open the workload chart on the last 30 days.
await context.addInitScript(() =>
  localStorage.setItem(
    "activitywatch-projects.view",
    JSON.stringify({ workloadRange: "last30" }),
  ),
);
const page = await context.newPage();
await page.clock.setFixedTime(NOW);
await page.route("http://demo.local/**", async (route) => {
  const name = new URL(route.request().url()).pathname.slice(1) || "index.html";
  if (name.includes("/") || name.includes(".."))
    return route.fulfill({ status: 404 });
  await route.fulfill({
    body: await readFile(resolve(ROOT, name)),
    contentType: {
      ".mjs": "text/javascript",
      ".html": "text/html",
      ".css": "text/css",
    }[extname(name)],
  });
});
await page.route("**/api/0/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  let json;
  if (path.includes("/settings")) {
    if (route.request().method() !== "GET")
      return route.fulfill({ status: 403 });
    // The dashboard reads settings key by key.
    const settings = { startOfDay: "04:00", project_tracker: config };
    const key = path.split("/settings/")[1];
    json = key ? (settings[key] ?? null) : settings;
  } else if (path.endsWith("/info")) json = { hostname: HOST };
  else if (path.endsWith("/buckets") || path.endsWith("/buckets/"))
    json = {
      [`aw-watcher-window_${HOST}`]: {
        type: "currentwindow",
        created: new Date(day0 - DAYS * 86400000).toISOString(),
      },
      [`aw-watcher-afk_${HOST}`]: { type: "afkstatus" },
      [`aw-watcher-web-chrome_${HOST}`]: {
        type: "web.tab.current",
        hostname: HOST,
      },
    };
  else if (path.endsWith("/query/")) {
    const [start, end] = route
      .request()
      .postDataJSON()
      .timeperiods[0].split("/")
      .map(Date.parse);
    json = [
      {
        windows: overlapping(windows, start, end),
        afk: overlapping(afk, start, end),
        web0: overlapping(web, start, end),
      },
    ];
  } else return route.fulfill({ status: 404 });
  await route.fulfill({ json });
});

await page.goto("http://demo.local/");
await page.getByRole("button", { name: "Edit Website redesign" }).waitFor();
await page.locator("#workload-chart svg").waitFor();
await page
  .locator("#workload-status")
  .filter({ hasText: "selected range loaded" })
  .waitFor();
await page.waitForTimeout(500);
await mkdir(OUT, { recursive: true });
const shot = (name, target = page, options = {}) =>
  target.screenshot({
    path: resolve(OUT, name),
    animations: "disabled",
    ...options,
  });

// 1. The whole dashboard.
await shot("dashboard.png", page, { fullPage: true });

// 2. Totals, timeline and cards, without the chart in between.
const hideChart = await page.addStyleTag({
  content: "#workload-panel{display:none}",
});
const top = await page.locator(".stats").boundingBox();
const bottom = await page.locator(".summary-grid").boundingBox();
await shot("overview.png", page, {
  fullPage: true,
  clip: {
    x: 0,
    y: top.y - 6,
    width: 1440,
    height: bottom.y + bottom.height - top.y + 22,
  },
});
await hideChart.evaluate((tag) => tag.remove());

// 3. Rule editor.
await page.getByRole("button", { name: "Edit Website redesign" }).click();
await shot("rules.png", page.locator("#editor"));
await page.locator("#editor").evaluate((d) => d.close());

// 4. Not assigned with activity type tags.
await page
  .getByRole("button", { name: "Show unassigned activities", exact: true })
  .click();
await page.waitForTimeout(300);
// Show the whole short list instead of its scroll box.
await page.addStyleTag({ content: "#unassigned-rows{max-height:none}" });
await shot("not-assigned.png", page.locator("#unassigned-panel"));

// 5. Workload chart, last 30 days, all projects.
await page.locator("#close-unassigned").click();
await page.locator("#workload-chart svg").waitFor();
await shot("workload.png", page.locator("#workload-panel"));

// 6. Export: the "Daily overview" preset over the last 7 days.
await page
  .getByRole("button", { name: "Reports & export", exact: true })
  .click();
const exporter = page.locator("#report-dialog");
await exporter.getByLabel("Preset").selectOption("builtin:day-overview");
await exporter.getByLabel("Range", { exact: true }).selectOption("last7");
await exporter
  .getByLabel("Export preview")
  .filter({ hasText: TODAY })
  .waitFor();
await page.waitForTimeout(300);
await shot("export.png", exporter);

await browser.close();
console.log("Screenshots written to docs/images/");

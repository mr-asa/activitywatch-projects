# AGENTS.md — ActivityWatch Projects

Technical reference for coding agents and contributors. The user-facing overview lives in `README.md` / `README.ru.md`; keep those free of implementation detail.

## What this is

A static dashboard (HTML + ES modules + CSS, **no build step, no runtime npm dependencies**) served by ActivityWatch's Python `aw-server` through `[server.custom_static]`. It reads events from the local ActivityWatch REST API (`/api/0/…`) and stores its own configuration in ActivityWatch settings. Raw events are never modified.

Tested with ActivityWatch 0.14.0b8 on Windows. Node.js 22+ is needed for tests and tooling only.

## Module map

| File | Role |
| --- | --- |
| `index.html` | The page. `projects.html` is only a legacy redirect to it (keeps query string). |
| `projects-app.mjs` | Entry point: state, data loading, rendering of cards/timeline/legend, persistence, wiring of all panels. |
| `projects-core.mjs` | Pure analysis: `analyze()` (time attribution), interval helpers (`merge`, `intersect`, `clipSorted`, `duration`), URL/title matching, browser & editor source discovery. |
| `rule-engine.mjs` | Rule normalization/matching (`normalizeRule`, `ruleMatches`, date bounds, app filter), manual assignment validation, `stable()` JSON, `localDate()`. |
| `rule-groups.mjs`, `compact-rule-editor.mjs` | Grouped multiline rule editor (one alternative per line; group settings shared). Its preview is live: the whole group, or only the line under the caret while the pattern box has focus (with the time the line adds beyond the other lines). Groups are derived from settings (type, mode, case, dates, application by `applicationKey`); `addRule` joins a new rule to its group and skips known patterns. |
| `unassigned-core.mjs` / `unassigned-ui.mjs` | "Not assigned · activities" list: grouping of unassigned time by app/title/URL, activity-type breakdown per row, add-to-project / add-to-activity-type dialogs. |
| `manual-ui.mjs` | Manual interval assignments (single, all occurrences, whole application). |
| `workflow-core.mjs` / `workflow-ui.mjs` | Config validation, report bounds, revision history, explanations, settings import/export. |
| `export-core.mjs` / `export-ui.mjs` | "Reports & export": a spec (range, row grouping/split, user-built columns, formatting) → table → CSV/TSV/Markdown/JSON. Columns = metric × target set (`all`, `work`, `nonproject`, `p:<id>`, `t:<id>`, `row`) × optional `within` × share base. Presets: built-in + saved. A project card's "Export hours" opens it as that project's hours per day of the report period, empty days included (`openFor`; a one-day report opens as This month). The export range "Whole project" uses the first column's project: `projectPeriod` over `historyStart`, shared with the chart. |
| `workload-core.mjs` / `workload-ui.mjs` | Daily workload chart (own data range, independent of the report period), drawn from per-day summaries. |
| `activity-core.mjs` / `activity-ui.mjs` | Activity types (independent second classification of the same time). A type is `{ id, name, color, rules[] }`, edited in the same rule editor as projects. |
| `add-rule-dialog.mjs` | The one dialog that turns an activity row into a rule of a project **or** an activity type ("+ Project" / "+ Type"): whole application, title keyword, title regex or page URL, application, dates, live preview. |
| `time-charts.mjs` | Proportion charts. |
| `day-cache.mjs` | IndexedDB cache of workload day summaries, keyed by device + date, valid for one configuration fingerprint. |
| `regex-help.mjs` | `regexHelp()`: collapsed regex cheat sheet, shown wherever a rule can be switched to regex (rule editor rows in projects and types, the add-rule dialog). |
| `dialogs.mjs` | Dialog placement inside the ActivityWatch frame and the wheel lock behind open dialogs. |
| `update-core.mjs` / `update-ui.mjs` | Update check: once a day (`updateChecked`/`updateRelease` prefs) asks the GitHub latest-release API, compares with the installed `version.json`, shows `#update-banner`. "Update" navigates to `awprojects://update` (registered by `install.ps1`), then polls `version.json` and reloads; after ~60 s without change it shows the manual command. Skipped under browser automation unless `?updatecheck=1`. |
| `manictime-core.mjs` / `manictime-ui.mjs` | ManicTime import shared by the "Import ManicTime" dialog (database picked in the browser, read with vendored sql.js from `vendor/`, loaded lazily; main target only, confirmation required) and `scripts/import-manictime.mjs` (node:sqlite, any size, also test target and `--replace`). Core takes `query(sql, params)` and `api`. The browser loads the file into memory, so the dialog points to the script for databases of about 400 MB and more (not tested at that size). |
| `ui-prefs.mjs` | Per-browser view preferences in `localStorage` (report period, chart range and lines, filters). Never stored in ActivityWatch settings; saved automatically on change; unknown values fall back to defaults. |

Page layout (`index.html` slots): header with `#tool-buttons` (Assign interval, Explain activities, Reports & export, Settings & recovery) and one Refresh (report + chart's newest days); the period bar (`#report-period`, dates, Today = back to one day); `#report` holds everything for the report period (totals, review, breakdown, timeline, Not assigned, projects with their own "+ Add project" and "Show archived", activity types, manual assignments); `#history` holds the workload chart with its own range, the report's days highlighted and "Open this range in the report". Modules insert into these slots, not relative to each other.

UI modules follow a `setupX({ state, persist, render, … })` pattern and return `{ update, … }`; `render()` in `projects-app.mjs` calls every panel's `update()`.

## Data model (ActivityWatch settings)

- `project_tracker` — the configuration, `version: 1`:
  - `revision`: UUID, checked before each save (optimistic concurrency; a mismatch aborts with "changed in another tab").
  - `projects[]`: `{ id, name, color, kind: "project" | "non-project", archived, rulesFrom, rulesThrough, rules[], keywords[], urls[] }`. `keywords`/`urls` are derived legacy mirrors of plain rules.
  - rule: `{ id, type: "title" | "application" | "url" | "editor-project" | "editor-file", mode: "text" | "regex", pattern, ignoreCase, from, through, appFilter }`. An `application` rule has the application name as `pattern` (matched by `applicationKey`, so `Telegram`, `telegram.exe` and a full path are the same), always text mode and no application filter; it matches every window of that application.
  - `manualAssignments[]`: `{ id, projectId, host, start, end, note }` (ISO timestamps, per device, non-overlapping).
  - `activityTypes[]`: `{ id, name, color, rules[] }` with the same rule shape as projects. Types saved with the older lists (`applications`, `titles`, `urls`, `combinations`, `mode`) are converted on load by `upgradeConfigTypes` (deterministic rule ids `m0`, `m1`, …; applications × titles become title rules with an application filter, application-only entries become `application` rules) and saved in the new shape on the next save.
- `project_tracker_backup` — previous configuration (written on every save).
- `project_tracker_history` — up to 20 previous configurations, cut to about 3 MB (always keeps the newest).
- The dashboard reads settings **per key** (`settings/<key>`, missing → `null`); never `GET settings` as a whole — it includes the megabyte history.
- `project_tracker_history_start` — `{ <hostname>: ISO time }`, written by `scripts/import-manictime.mjs`: where imported history starts (buckets' `created` is newer). The workload "Whole project" range uses the earlier of this and the window bucket's `created`.
- `project_tracker_export_presets` — `{ version: 1, presets: [{ id, name, spec }] }`, saved export presets. Written directly (read-merge-write, no preview): presets never affect attribution. Not included in settings export/backups. The working export spec is a view preference (`exportSpec`, `exportPreset` in `ui-prefs`).

If `project_tracker` is missing, the app starts with an empty config and creates it on first save. Reserved IDs: `conflict`, `unassigned`.

## Attribution rules (invariants)

- Only **active** time counts: window events clipped to `not-afk` AFK intervals.
- URL evidence is clipped to foreground time of the matching browser family. Editor (VS Code / Obsidian watcher) evidence is clipped to foreground time of that editor.
- A moment matched by exactly one category → that category. Two or more → `conflict` ("Needs review"), excluded from totals. None → `unassigned`. The review panel's "Show activities" lists the conflicting activities per category pair with the rule or manual assignment each category claimed them by (`conflictActivities`), with links to the editor and to manual assignment.
- Text title matching ignores invisible formatting characters (U+200E and similar, which Telegram puts in titles) on both sides (`titleForm`). Regex rules see titles as recorded.
- The add-rule dialog previews the rule live (`rulePreview`, debounced): entries it catches in the loaded period, the target project's before → after and every other category that changes (Not assigned, Needs review, other projects). It reruns `analyze` with the rule added through `addRule`, so groups, dates and manual assignments are honoured.
- When a project's own dates keep a matching rule from the activity being added, "+ Project" says so and offers to widen them (`projectDatesBlock`) instead of only reporting a duplicate.
- Manual assignments override automatic rules for the same moment (only on their `host`).
- Rule `from`/`through` are inclusive local calendar dates with **midnight** boundaries (not the start-of-day offset). `rulesFrom` / `rulesThrough` on a project narrow all its rules (`boundedRule`); a rule's own narrower dates still win. `projectSpan` (rules + manual assignments) bounds the workload "Whole project" scan.
- Report days start at ActivityWatch's `startOfDay` setting (default `04:00`). The report period is a day, week, month or custom range (`reportBounds(date, "range", startOfDay, through)`, `#date-through`); dragging or Shift+clicking points on the workload chart opens a custom range.
- Activity types run the same engine over the same data but never affect project attribution. Types are labels, not a partition: an activity may carry several, and time matched by more than one type counts fully in each (`analyzeActivityTypes` splits the engine's `conflict` segments per type; `conflict` is always 0 and there is no "Type needs review"). Per-row untyped time is `untypedSeconds`, not total minus the types' sum; type totals can add up to more than the scope. Type rules are ordinary rules: any field, text or regex, own dates. The "+ Type" and "+ Project" buttons open the same dialog (`add-rule-dialog.mjs`); its preview (`rulePreview`) shows the rule's own time and how every category of the chosen target changes (for types: other types and "No activity type"). `addTypeRule` joins a new rule to the group with the same settings (like `addRule` for projects) and skips known patterns.
- Non-project categories count toward tracked time, not project totals.
- Workload chart, All projects: `stackedWorkload` stacks work layers, then non-project categories and one "Unclassified" layer (not assigned + needs review), flagged `extra`; the stack top equals all active time (`tracked`), also drawn as the optional "All active time" line.

## Performance notes

- `analyze()` groups windows by unique `(app, title)` and browser events by URL, so each rule is matched once per unique value; regexes are cached (`rule-engine.mjs`). Keep this shape when adding rule types.
- Results are cached by object identity (`state.data`, `state.config`, `state.result`); replace objects instead of mutating them.
- Manual assignments find their windows through a start-time index (`byStart` + longest window span) in `prepare()`; never loop over all windows per assignment (thousands of assignments × a long history froze the page). Title and application normal forms are memoised per distinct string (`titleForm`, `applicationKey`).
- "Whole project" finds its span from day summaries (cached after the first scan) and keeps raw events only for the span (`sliceData`); recalculation after settings changes is deferred a frame (`scheduleCalculate`) so the rest of the page updates first.
- Active window intervals and source groups are shared between analyses through a `WeakMap` keyed by data identity and exact bounds (one prepared range per data object). Changing rules still recalculates attribution.
- Unassigned window ownership uses compressed event boundaries and successor links to consume each span once in original source order; preserve this priority for overlapping/duplicate windows.
- `loadRange()` (`projects-core.mjs`) is the shared fetch for an arbitrary range (workload chart, export).
- Export: duration cells are rounded first; a Total row sums rounded `time` cells (so timesheets add up) and recomputes other metrics over the whole range. Dates use Moment/Day.js-style patterns (`formatDate`: YYYY, MM, MMM, DD, ddd, WW/GGGG ISO week, Q, `[literal]`); `monthFormat` applies to month rows; names come from `Intl` in `dateLocale` (month is declined when a day token is present). Legacy `iso`/`dmy`/`mdy` values map to patterns. Sessions merge breaks shorter than `sessionGap`, count in the period where they start, and measure active time, not wall span. Activity types are analysed only when the spec references them (`specNeedsTypes`).
- The workload chart is drawn only from day summaries (`daySummaries`: seconds per category incl. `conflict`/`unassigned`, and per activity type overall `"*"` and within each category; `workloadFromSummaries` builds series, layers, stack, activity lines). Complete days (ended ≥ 5 min before the fetch) are cached in IndexedDB (`day-cache.mjs`) under `configFingerprint` (projects' kinds/dates/rules, types without name/color, manual assignments, start of day, host, `CACHE_VERSION`; bump it when summaries change). Loading reads the cache and fetches only the span of missing days (today is never cached); "Refresh chart" bypasses it. Raw events are kept in memory only for ranges ≤ `RAW_DAYS` (62) — fetched in the background after drawing from cache — so settings changes recalculate from memory; longer ranges reload (cache first) instead.
- Workload loading reuses a report snapshot only when the same host and its requested range cover the chart range. Explicit "Refresh chart" bypasses reuse. Independent workload window/editor requests run concurrently.
- `state.dataRange` records the fetched bounds and requested end; analysis must not extend a snapshot beyond its fetched end.
- Browser Performance measures prefixed `projects:` record the latest API (including JSON parsing), analysis, and synchronous render durations without event contents. Render includes analysis and panel updates, not subsequent browser paint.
- Auto-refresh (30 s) skips refetching periods that ended before the last fetch. A load requested while another is running is queued, not dropped.
- The workload chart always fits the panel width: `chartBuckets` keeps daily points while a day gets ≥ 6 px, else Monday-based weeks, else months; each bucket is the average per recorded day (axis stays hours/day, unrecorded days are gaps). Hover/click work per bucket; a click opens that week/month in the report.
- Timeline blocks merge adjacent same-category segments; handlers read `data-start` / `data-end` / `data-project` on each block — never map blocks to `result.segments` by index.
- Long lists render 50 rows with "Show more"; explanations are computed on expand.

## Commands

```sh
npm ci                                 # dev deps: Playwright, Prettier (pinned)
npm test                               # Node unit suites
npx playwright install chromium        # once
npm run test:ui                        # browser tests; all API calls are mocked
node scripts/performance.mjs           # synthetic 7/30/90-day processing timings
npm run format                         # Prettier
npm run screenshots                    # regenerate docs/images/ for the READMEs
node scripts/import-manictime.mjs --dry-run   # ManicTime → ActivityWatch import (see file header)
npm run deploy                         # tests + copy runtime files (Windows)
./deploy.ps1 -ValidateOnly             # tests + print resolved destination
./deploy.ps1 -Destination 'C:/path'    # explicit destination
```

GitHub Actions runs both suites on push and PR.

## Releases and installation

- `runtime-files.json` is the single list of files served by ActivityWatch (used by `deploy.ps1` and the release build; `release.test.mjs` checks that it covers every import). A new runtime file goes there, not into the scripts.
- Version: `version.json` (shipped, read by the page) must equal `package.json`.
- Release: bump both versions, commit, `git tag vX.Y.Z`, push the tag. `.github/workflows/release.yml` tests, runs `scripts/build-release.mjs` (zip with `app/` + `install.ps1`, `.sha256`) and publishes a GitHub release with fixed asset names (`releases/latest/download/…`). `npm run release` builds locally into `dist/`.
- `install.ps1` is installer and updater: verifies SHA-256, unpacks to `%LOCALAPPDATA%/ActivityWatchProjects/app` (previous version kept in `app-previous`, log in `install.log`), adds `projects = "…/app"` to `aw-server.toml` on first install (never changes an existing `projects` key), registers the per-user `awprojects://` protocol that runs `install.ps1 -Update` (takes no arguments from the URL). Parameters `-ZipSource`, `-BaseDir`, `-ConfigPath`, `-NoProtocol` allow testing against a local zip.

## Deployment

The Git checkout is the development copy; ActivityWatch serves a separate runtime folder. `deploy.ps1`:

- destination: `-Destination`, else `%LOCALAPPDATA%/ActivityWatchProjects/deployment.json` (`{"destination": "…"}`), else `%USERPROFILE%/Documents/ActivityWatch/projects-dashboard`;
- refuses the repo itself or any folder containing `.git`;
- runs `npm test`, backs up existing runtime files to a sibling `deployment-backups/<timestamp>`, copies the files listed in `$files`, verifies SHA-256 hashes;
- never touches ActivityWatch settings or recorded data.

After deploying, the dashboard needs **Ctrl+F5** (modules are cached).

## Conventions and gotchas

- **`.gitignore` lists what to skip** (dependencies, test output, local tooling, and patterns for real data such as `settings*.json`, `*.bak`, `*.csv`). New files are tracked automatically, so check `git status` before committing; a new runtime file must also be added to `$files` in `deploy.ps1`.
- Links are shown with `readableUrl()` (decoded) but URL rules are stored normalized (`normalizeRule` → encoded `URL.href`); `expandGroup` matches ids and duplicates after normalization. The "+ Project" dialog offers `urlLevels()` (site / folders / exact link) with `urlCoverage()` over the unassigned rows.
- UI text is English. Build DOM with `textContent` / `createElement`; `innerHTML` only for static templates (no user data).
- Open modal dialogs with `openModal()` / `placeDialog()` from `dialogs.mjs`: inside the ActivityWatch iframe a dialog is placed in the currently visible part of the frame (clipping ancestors, then `elementFromPoint` to skip a fixed header/footer drawn over it); never scroll the ActivityWatch page to show a dialog.
- While any dialog is open, a document-level `wheel` handler (`dialogs.mjs`) cancels scrolling unless an element inside the dialog can still scroll that way, so neither the page nor the ActivityWatch page around the frame moves. New scrollable areas inside dialogs need `overflow: auto|scroll` to be recognised.
- Every configuration save goes through `persist()`: revision check, history/backup write, then verified write. There is no confirmation step; the "+ Project" and "+ Type" dialogs preview their effect live instead, and revision history allows recovery.
- Tests use invented names and `example.com` URLs. Never commit real project names, links, exported settings, activity data, screenshots or local backups.
- Keep the README human-oriented (see top of this file). Document mechanics here instead.
- README images come only from `scripts/readme-screenshots.mjs`: the real UI over invented demo data, with the seed chosen by checking the demo day with `analyze()`. Rerun it after visible UI changes; never commit screenshots of real data.

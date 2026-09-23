# ActivityWatch Projects

A local project-time dashboard for ActivityWatch: organize recorded activity by project, inspect unassigned time, and refine matching rules without editing configuration files.

## Features

- Projects with custom colors and active-time totals.
- Window-title and browser-URL rules, plain text or JavaScript regex.
- Compact multiline rule groups: one alternative per line.
- Optional application filters, such as `Telegram` or `maya.exe`.
- Inclusive date limits for rules, useful when a chat or workspace changes projects.
- Match previews, a searchable unassigned-activity list, and manual interval assignments.
- Separate active-time proportions and chronological timeline.
- Conflicting matches go to **Needs review**, avoiding double counting.
- Foreground/idle filtering: background browser tabs do not count as work.

## Requirements

Tested with ActivityWatch **0.14.0b8** on Windows, using the Python aw-server and its custom-static pages. Other versions and platforms have not been verified. Keep window and AFK watchers running; URL rules also need the ActivityWatch browser extension.

The dashboard consists of static HTML, CSS and JavaScript. No build step or additional running service is needed. Node.js 22+ is only needed for tests.

## Installation

1. Clone this repository into a permanent local folder.
2. Add a mapping to the existing `[server.custom_static]` section in `aw-server.toml` (do not duplicate the section):

   ```toml
   [server.custom_static]
   projects = "C:/path/to/activitywatch-projects"
   ```

   On the tested Windows installation, the configuration file is `%LOCALAPPDATA%/activitywatch/activitywatch/aw-server/aw-server.toml`. Restart ActivityWatch after changing this mapping.
3. Initialize the dashboard setting once using PowerShell. This preserves any existing project configuration:

   ```powershell
   $awBase = 'http://127.0.0.1:5600/api/0'
   $awSettings = Invoke-RestMethod "$awBase/settings"
   if ($null -eq $awSettings.project_tracker) {
       $awProjects = @{
           version = 1
           revision = [guid]::NewGuid().ToString()
           projects = @()
           manualAssignments = @()
       } | ConvertTo-Json -Depth 20
       Invoke-RestMethod "$awBase/settings/project_tracker" -Method Post -ContentType 'application/json' -Body $awProjects
   }
   ```

4. Open `http://localhost:5600/pages/projects/` and add your first project.

An existing installation can retain its original custom-static name and URL. The page also accepts `hostname`, `start`, and `end` query parameters (ISO timestamps) when embedded in an ActivityWatch custom visualization. Without these, it uses the local host and selected date.

## Rules

Choose **Window title** or **Browser URL**, then **Plain text** or **Regex**. Each line in a group is an alternative match; application, case and date settings apply to every line in that group. Create separate groups for different settings.

The optional application field matches an exact executable name, case-insensitively, ignoring a trailing `.exe`. `maya` matches `maya.exe`, but not `mayabatch.exe`. Blank means any application. This filter applies to title rules.

Regex uses JavaScript syntax without `/` delimiters and matches the original recorded text. For example:

```text
comps\.nk(?: \[modified\])? - Nuke
```

Case-insensitive plain title matching ignores `[modified]`. Plain URL rules match the same host and path subtree and require the specified query parameters. Use project-specific links instead of a shared service homepage.

**Valid from** and **Valid through** use inclusive local calendar dates, with midnight boundaries even if the ActivityWatch report day starts at 04:00. Blank dates are unrestricted. If a chat name is reused, end its old rule before the new project's rule begins. Identical titles in the same app at the same time cannot be distinguished by these rules.

## Unassigned time and manual assignment

Click **Not assigned** to inspect activities sorted by duration. Add a matching rule, create a project, or use **Assign time only**. Clicking a gray timeline segment narrows the list to that interval.

Manual assignments override automatic rules for recorded active time on the selected device. They do not count idle time or gaps, and do not create future rules. Overlapping manual intervals are rejected. Removing an assignment restores automatic attribution; deleting a project removes its manual assignments.

## Storage and recovery

Code is stored in this repository. Project rules, colors and manual assignments are stored separately in ActivityWatch's `project_tracker` setting. Saves check a revision and retain the previous configuration in `project_tracker_backup`. Raw activity events are never changed. Standard ActivityWatch Summary categories remain separate.

A Git clone restores the dashboard code, **not your recorded activity or personal rules**. Back up the ActivityWatch data directory and export your current project configuration separately:

```powershell
$awSettings = Invoke-RestMethod 'http://127.0.0.1:5600/api/0/settings'
$awSettings.project_tracker | ConvertTo-Json -Depth 100 | Set-Content -Encoding utf8 "$env:USERPROFILE/project-tracker-backup.json"
```

To restore rules, first back up the current setting, then POST the saved JSON to `/api/0/settings/project_tracker` and reload the page. This replaces the current rules and manual assignments.

Local backups, activity exports, screenshots and machine-specific migration scripts are intentionally excluded from version control.

## Development

```sh
npm test
```

The runtime has no npm dependencies. Development uses pinned Playwright and Prettier versions (`npm ci`). Tests cover time attribution, idle filtering, URL matching, duplicate intervals, conflicts, regex, dates, manual assignments, grouped rules and application filters. GitHub Actions runs these tests on pushes and pull requests. Portable browser tests use synthetic data and intercept every API request; they never access real ActivityWatch settings. Run `npx playwright install chromium` once, then `npm run test:ui`. Both suites run in GitHub Actions.

After editing the static files, refresh the dashboard with **Ctrl+F5**. Existing project settings are reused.

## Separate development and deployment (Windows)

Keep the Git checkout in your development directory and serve a separate runtime folder through ActivityWatch. From the repository, run:

```sh
npm run deploy
```

With no local preferences, the default destination is `%USERPROFILE%/Documents/ActivityWatch/projects-dashboard`. For a different destination:

```powershell
./deploy.ps1 -Destination 'C:/path/to/runtime-folder'
```

Point ActivityWatch's custom-static mapping at that runtime folder. The script runs tests, backs up the existing runtime files in a sibling `deployment-backups` folder, copies only the fourteen runtime files, and verifies their hashes. It refuses a destination containing `.git`. It never copies development files or modifies ActivityWatch settings or recorded activity. Deployment is one-way: edit code in the repository, then deploy; edit project rules in the dashboard as usual. Refresh with Ctrl+F5 afterward.

Git commits and pushes save source changes to GitHub; deployment updates the local dashboard. These are separate actions. Personal settings and local archives belong outside the Git checkout.

Local deployment preferences can be kept outside the checkout in `%LOCALAPPDATA%/ActivityWatchProjects/deployment.json`:

```json
{"destination": "C:/path/to/existing-runtime"}
```

An explicit `-Destination` overrides this file. This lets an existing installation keep its original runtime path without putting that path in Git. To run tests and check the resolved destination without copying files:

```powershell
./deploy.ps1 -ValidateOnly
```

Examples and fixtures use invented project and chat names and reserved `example.com` URLs. Keep real client names, project links and exported settings outside the repository.

## Daily workflow tools

- **Explain activities** lists recorded titles, applications and URLs. Expand an activity to see final allocation and the exact matching rules or manual override. **Explain time** on a category narrows this list.
- **Preview changes** in the editor compares the draft against the current configuration. Saving any configuration change opens a before/after preview and requires **Confirm save**. The preview covers only the currently loaded period, not every historical date.
- **Category type → Non-project / intentionally ignored** classifies personal browsing, general administration or other time outside project totals. These categories use the same rules and colors. Conflicting project/non-project rules still require review. Start from **Add to project → Create new project** in the unassigned list, then choose the category type.
- **Archived** hides a category from cards without altering past totals or matching. **Show archived** reveals it again. Set **Automatic rules end on** separately when the category should stop matching after an inclusive local date. Manual overrides continue to apply after this cutoff.
- **Report period** selects day, Monday-based week or calendar month. Arrows move by the selected period. **Reports & export** shows daily totals and downloads CSV or Markdown for spreadsheets or Obsidian. Report days respect ActivityWatch's start-of-day setting. Exports include archived categories, non-project time, conflicts and unassigned time; they do not contain raw titles or URLs.
- **Settings & recovery** exports/imports project settings and restores previous versions. Each save retains up to 20 prior configurations in the local `project_tracker_history` setting. Restoring is itself a new save, so it can be undone by restoring the prior version. Imports are validated and previewed before replacing settings. Export a separate JSON file for protection against loss of the ActivityWatch database itself.

These changes do not add offline time: manual assignments still classify recorded active time only. Existing projects remain project-work categories with no archive state or cutoff until you edit them.

The code is formatted with `npm run format`. Browser screenshots and test results stay outside version control.

### Assigning a grouped activity once

An unassigned row can combine many separate visits. **Assign time only** defaults to **All occurrences in this row** when there is more than one visit, shows their combined duration, and saves each interval separately. It does not assign the gaps or create a rule for future visits. The selection covers the currently displayed report (or a selected timeline interval), not every historical occurrence. Choose an individual occurrence to edit only that interval. Already assigned portions are absent from the unassigned row, so assigning the remainder does not duplicate them.

**Needs review** is active time where two or more categories match simultaneously, including non-project categories. It is excluded from category totals until the ambiguity is resolved. Multiple matching rules inside the same category do not create a conflict. Manual interval assignments override automatic conflicts.

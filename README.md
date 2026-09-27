# ActivityWatch Projects

**English** · [Русский](README.ru.md)

**See where your working hours actually go.**
ActivityWatch Projects turns your ActivityWatch history into a clear picture of time per project, without timers to start or entries to type.

<!-- 📸 Hero screenshot: full dashboard with project cards, timeline and workload chart -->

---

## Why

ActivityWatch already records every window and website you use. What it can't tell you is which of those minutes belonged to *Client A*, which to *the side project*, and which were just YouTube.

This dashboard lets you describe your projects once, with a few simple rules, and then shows every recorded day sorted by project. That includes days recorded before the project existed.

- **No timers.** Work as usual; the time sorts itself out.
- **Works on your past.** A new rule applies to history immediately.
- **Honest numbers.** Only time you were actually at the computer counts, and nothing is counted twice.
- **Private.** Everything stays on your machine, inside ActivityWatch.

## What you get

### Projects at a glance
Each project gets a card with its own color, total time, and a split between apps and browser. A timeline shows your day in color: what you worked on and when.

<!-- 📸 Project cards + colored timeline -->

### Simple rules that do the sorting
Tell the dashboard how to recognize a project:

- a word from the **window title**: `Nuke`, `Quarterly report`;
- a **website address**: a specific board, repository or document;
- a **file or folder** in VS Code or Obsidian (if their watchers are installed).

You can limit a rule to one application ("only in Telegram") or to a date range ("this chat belonged to the project until March"). Regular expressions are supported for advanced cases.

<!-- 📸 Rule editor -->

### Nothing slips through
Click **Not assigned** to see everything that isn't classified yet, largest first. From any row you can:

- add a rule to an existing or new project;
- add it to an **activity type** (see below);
- assign just that time by hand, once, without creating a rule;
- assign all time from an application in one go.

Each row also shows which activity types it already belongs to, so you can see what's still unsorted.

<!-- 📸 "Not assigned" list with activity type tags -->

### Activity types: *what* you did, not just *for whom*
Projects answer "who was this for?". Activity types answer "what was I doing?": messaging, video, design, coding, whatever you define. They're counted independently, so the same hour can be *Client A* **and** *Messaging* without inflating your day.

### Daily workload
A chart of hours per day for a week, a month or any range: per project or all projects stacked, with an optional daily target, a 7-day trend, and the share of non-project time.

<!-- 📸 Workload chart -->

### Reports and exports
Pick a day, a week or a month and export totals to **CSV** (for spreadsheets) or **Markdown** (for notes, e.g. Obsidian). Exports contain category totals only, never window titles or URLs.

### Safe to experiment
Every change shows a **before → after preview** of the numbers before it's saved. The last 20 versions of your settings are kept, and any of them can be restored in one click.

## How time is counted

- Only **active** time counts. When ActivityWatch marks you as away, nothing is attributed.
- A browser tab counts only while the browser is in front.
- If two projects claim the same minute, it goes to **Needs review** instead of being counted twice. Adjust the rules or assign it by hand.
- **Manual assignments** always win over automatic rules.
- Time you mark as **non-project** (personal browsing, admin) is tracked but kept out of project totals.
- Days start when your ActivityWatch day starts (04:00 by default), so late-night work stays with the right day.

## Getting started

You need [ActivityWatch](https://activitywatch.net/) running with its window and AFK watchers. For website rules, also install the ActivityWatch browser extension.

1. **Download** this repository to a permanent folder, e.g. `C:/Tools/activitywatch-projects`.
2. **Tell ActivityWatch about it.** Open `aw-server.toml` (on Windows: `%LOCALAPPDATA%/activitywatch/activitywatch/aw-server/aw-server.toml`) and add a line to the existing `[server.custom_static]` section:

   ```toml
   [server.custom_static]
   projects = "C:/Tools/activitywatch-projects"
   ```

3. **Restart ActivityWatch** and open <http://localhost:5600/pages/projects/>.
4. Click **+ Add project**, give it a name and a rule, and watch your history fill in.

Tested on Windows with ActivityWatch 0.14. Other platforms may work but haven't been verified.

## Tips

- **Start broad, refine later.** Add one or two obvious rules per project, then work through **Not assigned**.
- **Reused chat or channel names?** Give the old rule an end date and the new one a start date.
- **Retired a project?** Archive it: it disappears from the cards, but past totals stay intact.
- **Explain time** on a project card shows exactly which activities and rules produced its total.

## Your data

- The dashboard never changes what ActivityWatch recorded.
- Your projects and rules live in ActivityWatch's own settings, not in this folder.
- To keep a copy of your rules, use **Settings & recovery → Export settings**. To be fully covered, also back up your ActivityWatch data folder.

## For developers

Architecture, data model, tests and deployment are described in [AGENTS.md](AGENTS.md).

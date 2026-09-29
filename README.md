# ActivityWatch Projects

**English** · [Русский](README.ru.md)

**Find out where your screen time actually goes.**
ActivityWatch Projects turns your ActivityWatch history into a clear picture of time per project: no timers to start, and no tagging or rules to enter for every activity, day after day!

![ActivityWatch Projects dashboard](docs/images/dashboard.png)

---

## Why

I always used another time tracker that made it reasonably easy to filter a day's entries and see how much time went into a project. While looking for alternatives I came across ActivityWatch too, but back then I didn't see anything in it that was convenient or useful for me.

On my latest project I decided to try yet another time-tracking tool and ran into ActivityWatch again. As it turned out, its out-of-the-box interface isn't much help for this kind of thing, but you can build your own dashboard with your own rules for categorizing and collecting data!

What I really liked:
- No timers to start by hand. The system watches everything that opens and sorts it by rules that I create myself
- Two kinds of data:
  - **Projects** (work tasks). What you can later put into a timesheet
  - **Activities**. It was really interesting to see how much time I spent on, say, messaging. Or how many hours a day go into super-useful Zoom calls and similar "productivity eaters"
- All information is stored locally on the computer

## What's inside

### Projects at a glance
Each project has its own card: color, total time, and a split between apps and browser. A colored timeline shows what I worked on and when during the day.

![Totals, timeline, project cards and activity types](docs/images/overview.png)

### Simple rules do all the sorting
Sorting rules can be set up in several ways:

- by a word in the **window title**: `Blender` or `Quarterly report`;
- by a **website address**: a specific board, repository or document;
- by a **file or folder** in VS Code or Obsidian (if their watchers are installed).

A rule can be limited to one application ("only in Telegram") or to a period ("this chat belonged to the project until March"). Regular expressions cover the tricky cases.

![Project rule editor](docs/images/rules.png)

### Nothing slips through
The **Not assigned** button shows everything that isn't sorted yet, largest first. Right from a row you can:

- add a rule to an existing or new project;
- add the entry to an **activity type** (see below);
- assign just that time by hand, once, without a rule;
- assign all time from one application in one go.

Each row shows which activity types it already belongs to, so it's clear at once what's still unsorted.

![Not assigned activities with activity type tags](docs/images/not-assigned.png)

### Activity types: *what* you did, not just *for whom*
Projects answer "who was this for?". Activity types answer "what was I doing?": messaging, video, design, coding, whatever you choose. They're counted independently, so the same hour can be both *Client A* and *Messaging* without making your day any longer.

### Daily workload
Hours per day for a week, a month or any period: for one project or all of them at once, with a daily target, a 7-day trend and the share of non-project time.

![Daily workload chart](docs/images/workload.png)

### Reports and export
Choose any date range and the categories you need, and get exactly the table you want: for example, just "date – hours" for one project, a table with one column per project, or totals per week or month. Time can be decimal hours, minutes or h:mm, optionally rounded (to 6 or 15 minutes, for instance). Download it as **CSV**, **TSV**, **Markdown** or **JSON**, or copy it straight into a spreadsheet. The dialog remembers your choices. Exports contain only time per category, no window titles or addresses.

### Safe to experiment
Before saving, every change shows the numbers **"before → after"**. The last 20 versions of your settings are kept, and any of them can be restored in one click.

## How time is counted

- Only **active** time counts. If ActivityWatch thinks you're away from the computer, no time is counted.
- A browser tab counts only while the browser is in front.
- If two projects claim the same minute, it goes to **Needs review** instead of being counted twice. Adjust the rules or assign it by hand.
- **Manual assignments** always win over automatic rules.
- Time marked as **non-project** (personal browsing, admin) is tracked but kept out of project totals.
- The day starts when your ActivityWatch day starts (04:00 by default), so late-night work stays with the right day.

## Getting started

You need [ActivityWatch](https://activitywatch.net/) running with its window and AFK watchers. For website rules, also install the ActivityWatch browser extension.

1. **Download** the repository to a permanent folder, e.g. `C:/Tools/activitywatch-projects`.
2. **Tell ActivityWatch about it.** Open `aw-server.toml` (on Windows: `%LOCALAPPDATA%/activitywatch/activitywatch/aw-server/aw-server.toml`) and add a line to the existing `[server.custom_static]` section:

   ```toml
   [server.custom_static]
   projects = "C:/Tools/activitywatch-projects"
   ```

3. **Restart ActivityWatch** and open <http://localhost:5600/pages/projects/>.
4. Click **+ Add project**, give it a name and a rule, and your history starts filling in.

Tested on Windows with ActivityWatch 0.14. Other platforms may work but haven't been verified.

## For developers

Architecture, data model, tests and deployment are described in [AGENTS.md](AGENTS.md).

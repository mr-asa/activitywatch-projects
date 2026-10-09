![cover](docs/images/activitywatch-logic-cover.webp)

<p align="center">
  <a href="https://ai.mr-asa.com/blog/activitywatch-interface.html"><img src="docs/images/btn-blog-en.svg" height="28" alt="Read on the blog" /></a>
  <img src="docs/images/btn-separator.svg" height="28" alt="" />
  <a href="README.md"><img src="docs/images/btn-english-active.svg" height="28" alt="English" /></a>
  <a href="README.ru.md"><img src="docs/images/btn-russian.svg" height="28" alt="Русский" /></a>
</p>

---

### Find out where your screen time actually goes.

ActivityWatch Projects turns your ActivityWatch history into a clear picture of time per project: no timers to start, and no tagging or rules to enter for every activity, day after day!

![ActivityWatch Projects dashboard](docs/images/dashboard.png)

## Getting started

You need [ActivityWatch](https://activitywatch.net/) running with its window and AFK watchers. For website rules, also install the ActivityWatch browser extension.

1. **Install.** Pick your system:

   <details open>
   <summary><b>Windows</b> (PowerShell)</summary>

   ```powershell
   irm https://github.com/mr-asa/activitywatch-projects/releases/latest/download/install.ps1 | iex
   ```

   Installs into `%LOCALAPPDATA%/ActivityWatchProjects`.
   </details>

   <details>
   <summary><b>Linux</b></summary>

   ```sh
   curl -fsSL https://github.com/mr-asa/activitywatch-projects/releases/latest/download/install.sh | sh
   ```

   Installs into `~/.local/share/activitywatch-projects` (needs `curl` or `wget`, and `unzip`).
   </details>

   <details>
   <summary><b>macOS</b></summary>

   The same command as on Linux. It installs into `~/Library/Application Support/ActivityWatchProjects`. The one-click Update button is not available there: run the command again to update.
   </details>

   <details>
   <summary><b>By hand</b> (any system)</summary>

   Download `activitywatch-projects.zip` from the [releases](https://github.com/mr-asa/activitywatch-projects/releases), unpack the `app` folder anywhere and add `projects = "<that folder>"` to the `[server.custom_static]` section of `aw-server.toml`.
   </details>

   The script downloads the latest release and adds one line to ActivityWatch's `aw-server.toml` (a backup is made first).
2. **Restart ActivityWatch** once and open <http://127.0.0.1:5600/pages/projects/>.
3. Click **+ Add project**, give it a name and a rule, and your history starts filling in.

**Updates.** The dashboard checks GitHub for a new release once a day and shows a banner with an **Update** button; one click installs it and reloads the page (Windows and Linux). If the button does nothing, run the install command again. The check can be switched off by setting `updateCheck` to `false` in the browser's local storage entry `activitywatch-projects.view`.

Tested with ActivityWatch 0.14 on Windows. The Linux and macOS installer has been checked only against a local package, not on a real machine.

## Speed

Open ActivityWatch at `http://127.0.0.1:5600` rather than `localhost:5600`. On Windows, `localhost` tries IPv6 first while ActivityWatch listens only on IPv4, so every request loses about 200 ms. For a dashboard that makes several requests in a row, that adds up to seconds: the first report load drops from about 3.3 s to 0.3 s. The rest of the ActivityWatch interface gets faster too.

The browser keeps view preferences (chart range, filters, export options) and the chart cache separately for each address, so they start empty on the new one. Projects, rules and presets are stored in ActivityWatch and don't depend on the address.

## For developers

Architecture, data model, tests and deployment are described in [AGENTS.md](AGENTS.md).

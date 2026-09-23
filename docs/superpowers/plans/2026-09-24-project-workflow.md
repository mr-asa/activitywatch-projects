# Project workflow improvements implementation plan

> Execute inline, task by task, with regression checks after each subsystem.

**Goal:** Explain attribution, preview saves, classify non-project time, archive projects, export period reports, and recover configuration revisions.
**Architecture:** Keep ActivityWatch events immutable. Extend project metadata compatibly; use the same analysis for reports and previews. Keep revision snapshots in a separate ActivityWatch setting. Static frontend with no build dependency.
**Tech stack:** JavaScript modules, Node tests, Playwright, PowerShell deployment.
**Spec:** User approved review priorities 1вЂ“6 and code formatting/browser tests; tracking-health indicators excluded. Offline time entry remains a separate future feature.

## Constraints
- Preserve existing rules, manual overrides, and project IDs.
- Never include personal settings or production event data in Git.
- Archived is a display state; optional rule end date changes matching separately.
- Non-project categories count in tracked time, but not project totals.
- Preview and export use the selected report period, not all historical data.

## Tasks
- [x] Extend projects-core.mjs metadata (kind, archived, rulesThrough); return rule-level evidence. Test categories, conflicts, archive cutoff, manual precedence.
- [x] Add workflow-core.mjs for configuration validation, period boundaries, report export, and before/after comparison. Test midnight/report boundaries and CSV escaping.
- [x] Add workflow-ui.mjs: explanations, period selector, exports, revision recovery, import/export. Integrate editor metadata and save preview with projects-app.mjs.
- [x] Keep up to 20 prior configurations in project_tracker_history; restore via normal revision-checked save. Validate imports before preview and reject unsupported schema versions.
- [x] Format source with Prettier; add portable Playwright fixtures and tests for save previews, categories, archive, export, backup restore, and narrow layouts.
- [x] Update deployment manifest and README; run core/UI tests, inspect screenshots, deploy with local configuration untouched, commit and push.

## Verification
`npm test`; `npm run test:ui`; `powershell -File deploy.ps1 -ValidateOnly`. Mock settings and events in browser tests. Compare live configuration before/after deployment. All source imports must be included in the runtime manifest.

Validation completed: six Node regression suites, seven Playwright workflows, desktop/mobile screenshots, and a read-only check against live ActivityWatch. Deployed configuration compared equal before/after.

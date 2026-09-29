# Dashboard Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Improve long-period processing and rendering without changing attribution or displayed detail.

**Architecture:** Measure synthetic 7/30/90-day workloads, eliminate repeated interval preparation and unassigned scans, and reuse report data for a covered workload range. Keep existing public analysis interfaces and refresh semantics.

**Tech Stack:** ES modules, Node.js 22+, Playwright; no runtime dependencies.

**Spec:** User-approved performance review in this conversation; attribution constraints in `AGENTS.md`.

## Global Constraints

- Preserve AFK, foreground, manual, conflict, and local date semantics.
- Use invented data in committed fixtures; do not modify ActivityWatch settings or events.
- Keep full refresh available; do not assume historical recordings are immutable.
- Preserve timeline interval interaction and existing UI.

### Task 1: Establish baseline

- [x] Add `scripts/performance.mjs`: generate 7/30/90 days of alternating project/unassigned events; measure `analyze`, activity types, and `unassignedActivities` separately using `performance.now()` and report event counts.
- [x] Run `node scripts/performance.mjs` before editing runtime code and retain timings for comparison.

### Task 2: Reduce analysis work

- [x] Cache prepared active windows, title/URL groups, and foreground intervals by data identity and exact start/end in `projects-core.mjs`; retain only the latest range per data object.
- [x] Optimize unassigned interval consumption in `unassigned-core.mjs` without changing original event priority for overlapping windows.
- [x] Add deterministic comparison tests against an independent per-second oracle, including unordered overlapping windows, browser evidence, and scopes in `unassigned.test.mjs`.
- [x] Run `npm test` and repeat the benchmark.

### Task 3: Avoid redundant loading and rendering overhead

- [x] Reuse report data in `workload-ui.mjs` when host and requested effective range are covered; explicit chart refresh must fetch fresh data.
- [x] Start editor loading alongside the window query for independently loaded workload ranges.
- [x] Reuse an `Intl.DateTimeFormat` instance for timeline labels and unassigned accessibility labels; build timeline nodes off-DOM.
- [x] Add browser checks for covered-range reuse and explicit refresh in `tests/workflow.spec.mjs`; run `npm run test:ui`.

### Task 4: Verify and document

- [x] Document cache boundaries and benchmark command in `AGENTS.md`.
- [x] Format changed files; inspect diff and run required suites.
- [x] Report measured gains and limits. Daily persistent caching, workers, and timeline redesign remain separate follow-up work if profiling warrants them.

## Verification results

All six Node test suites and 21 Playwright tests passed. The new overlap test compares 60 deterministic randomized fixtures against an independent per-second oracle. Browser tests cover initial covered-range reuse, narrower ranges, fresh explicit refresh, and fallback requests outside the report range.

Synthetic unassigned processing (single runs; milliseconds, hardware dependent):

| Days | Window events | Before | After |
| --- | ---: | ---: | ---: |
| 7 | 6,720 | 98 | 15 |
| 30 | 28,800 | 1,276 | 28 |
| 90 | 86,400 | 16,291 | 86 |

These are processing measurements, not total page-load timings. Source fetching, browser painting, and large numbers of timeline nodes can still dominate. No visual design changed, so README images need no regeneration.

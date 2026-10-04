**English** | [简体中文](README.zh-CN.md) | [日本語](README.ja-JP.md)

# Planit

A web-based project scheduler in the spirit of OmniPlan — a Gantt chart
planning tool built around **dependency-driven scheduling**. Change any task,
dependency, calendar, or resource and the whole chain re-solves automatically;
the critical path is highlighted in real time; resource overloads are leveled
away; every operation is undoable. All data lives in your browser — no server
required.

## Feature Guide

### Tasks & Scheduling

- **Task tree**: summary tasks / subtasks / milestones in three levels; summary
  dates roll up bottom-up automatically; a task's kind (leaf vs. group) is
  derived from its structure, so "has children but is still a leaf" dirty data
  cannot exist
- **Two scheduling modes**:
  - **Automatic** — the engine solves from dependencies and constraints. Each
    task can carry a **paired start/end constraint** (start-no-earlier-than /
    start-no-later-than / finish-no-earlier-than / finish-no-later-than): one
    start constraint + one end constraint
  - **Manual** — the interval is pinned; dependencies, constraints, and
    resource leveling never move it. When a dependency runs into a manual
    task, the conflict is reported honestly instead of silently shifting it
- **Per-task ASAP/ALAP** ordering inside its feasible window; the project as a
  whole can be scheduled forward (from the start date) or backward (from the
  deadline — falls back to the forward-computed finish when no deadline is set)
- **Drag to schedule**: drag a bar to move it, drag the left handle to change
  the start, drag the right handle to change the duration; drop points snap to
  workdays; a dragged task becomes manually scheduled — what you see is what
  you get
- **Milestones**: zero-duration time points that can carry dependencies and be
  delayed by leveling

### Dependencies

- **Four dependency types**: FS (finish→start), SS (start→start), FF
  (finish→finish), SF (start→finish) — draw them directly from a task bar's
  endpoints in the Gantt chart
- **Lag in three units**: workdays / elapsed days (spanning weekends and
  holidays) / a percentage of the predecessor's duration; all may be negative
  (lead time)
- Cycles are rejected at creation time (cycle detection) — not discovered at
  solve time
- Infeasible dependencies (e.g. squeezed by a manual task) are reported in the
  conflict list — never silently reconciled

### CPM Engine & Critical Path

- Full **Critical Path Method (CPM)** solve: forward pass (early dates),
  backward pass (late dates), total slack and free slack
- **Change anything, everything re-solves**: task duration, dependencies,
  constraints, calendars, resource assignments — any change triggers a re-solve
- **Real-time critical path**: the zero-slack chain is visible at a glance in
  the Gantt chart
- Infeasible schedules (negative slack) are reported honestly as conflicts,
  including how many workdays they are off by
- The solve runs on a **Web Worker**: a 10,000-task project keeps the UI at
  60fps while solving; the status bar shows a "computing" indicator (appears
  after a 300ms delay to avoid flicker)

### Working Calendars

- Every project carries a **configurable calendar**: weekday checkboxes plus
  holiday exceptions on any date
- Exceptions can be added/removed **per day or per range** (ranges expand
  day-by-day in the command layer, so one undo reverts them all)
- **Monthly calendar view**: three-state coloring for workday / non-workday /
  exception; click a date to toggle it
- Resources may attach their **own calendar** (`calendarId`) or use the
  project default
- Changing the calendar re-solves the whole project — every schedule, load,
  and earned-value figure follows

### Resources & Effort

- **Four resource kinds**: staff / equipment / material / group (groups nest;
  the panel folds by group)
- Per resource: **availability** (e.g. 50% for part-time), **efficiency**,
  **available period** (hire date / lease period), and **cost** (per-use +
  hourly rate)
- **Assignments have two symmetric entry points**: the task panel's "who works
  on this task" and the resource panel's "which tasks is this person on" —
  the same data, the same commands; either side edits the same record
- **Two effort models**:
  - Fixed duration: adding a person adds effort, the duration stays
  - **Fixed effort**: adding a person actually shortens the task (5 person-days
    with 2 people → 3 workdays)
- Outline and panels show derived totals per task and per resource: total
  uses, total hours, total cost

### Resource Leveling

- When a resource is scheduled above 100% availability on a given day, the
  engine automatically **pushes tasks forward using their slack** until the
  load fits or the slack runs out
- **Priority decides who yields**: higher-priority tasks keep the resource
  first; pinned tasks (manual scheduling / constraints) never move
- A manually set `delay` (minimum postponement) is honored, clamped to the
  available slack
- **Unresolvable overloads are reported honestly** (which resource, which day,
  at what load) — never claimed as "leveled"
- The resource view's timeline **highlights overloads** so you can see who is
  double-booked on which day at a glance
- Leveling is just a command — **it can be undone**

### Baselines & Earned Value Analysis

- **Multiple baseline snapshots**: snapshot the whole project at any time,
  keep as many as you like, switch the active comparison baseline freely
- **Schedule variance**: each task shows its baseline start/finish versus the
  current schedule in workdays (positive = later)
- **Earned value**: BAC / EV / PV / SV are derived by the engine from cost and
  progress — the UI never recomputes them
- Set a `statusDate` + an active baseline and PV / SV become available

### Views

- **Gantt view**: task bars, dependency lines (endpoint semantics for all four
  types), critical-path highlighting, non-workday shading, drag scheduling
- **Outline view**: the task tree as a table with a **27-column registry**
  (start / finish / slack / assigned / cost / variance…), a header context
  menu to configure visibility, draggable column widths (double-click to
  reset), persisted preferences
- **Calendar view** / **resource view**: together with Gantt and outline they
  form a four-way view switcher
- **Two-tab Inspector** (task / project): task info, scheduling, constraints,
  dependencies, assignments, baselines, earned value — 7 collapsible groups

### Data, Undo & i18n

- **Command model**: every data change goes through a registered command; the
  UI only dispatches, it never writes data directly
- **Full undo/redo**: Immer generates forward and inverse patches
  automatically, replayed from a dual stack; one drag = one undo record (no
  half-steps)
- **Autosave**: debounced persistence to IndexedDB — refresh and nothing is
  lost; schema versions migrate **hop-by-hop**, so old saves always open
- **Trilingual UI**: 中文 / English / 日本語, switchable at any time; every
  string (including undo messages) is fully translated

## Tech Stack

React 19 · TypeScript · Vite · Mantine 9 · SCSS Modules · react-i18next ·
Zustand · Immer · @tanstack/react-virtual · date-fns

## Development

```bash
pnpm install
pnpm dev        # dev server (port 5174; Playwright e2e uses the same port)
pnpm test       # unit tests (vitest)
pnpm typecheck  # type check
pnpm build      # production build
pnpm e2e        # e2e acceptance (Playwright; run pnpm exec playwright install chromium first)
```

`scripts/` holds development helper scripts, not shipped in the build:

- `seedLargeProject.ts` — generates a 1,000-task stress project (used by
  `perf.spec.ts`).
- `importOmniPlan.py` — converts a real OmniPlan document (`.oplx`) into
  planit `Project` JSON (with `schemaVersion` matching the current
  `SCHEMA_VERSION`), for testing the scheduling engine against real data.
  Pure standard library, no dependencies:

  ```bash
  python3 scripts/importOmniPlan.py path/to/xxx.oplx -o out.json
  ```

  The import is **one-way and lossy**: OmniPlan's leveling results
  (`leveled-start`) do not carry over — planit re-solves with its own CPM +
  leveling. The date differences between the two are exactly what these
  real-data experiments observe.

## Architecture

```
View  (React + Mantine)    ← only dispatches commands, never writes the store
  ↓
Command (registry)         ← the single entry point for all data changes
  ↓
Store  (Zustand + Immer)   ← commands + forward/inverse patch dual stacks
  ↓
Domain (pure TypeScript)   ← model / calendar / CPM solver, zero React deps
  ↓
Persist (IndexedDB)        ← debounced autosave
```

The scheduling engine (`src/domain/scheduler`) is a pure function, testable
without any UI — scheduling correctness is guaranteed by unit tests, and the
UI only has to verify "is the data right after the operation". Re-solves run
asynchronously on a Web Worker; the main thread only renders.

The engine's **rule alignment** with OmniPlan 4 (dependency conversions,
constraint semantics, resource leveling) is regression-tested via parity
fixtures extracted from real `.oplx` documents (integer-day, no-contention
subsets; `src/domain/scheduler/omniplan/`).

## Two UI-Layer Conventions

**The Mantine / hand-rolled boundary**: toolbars, forms, popovers, and layout
primitives use Mantine; the Gantt area (ruler, grid, task bars, dependency
lines, task-tree rows) is hand-rolled with SCSS Modules + absolute positioning
+ SVG. Those areas need pixel-level control and virtual scrolling — a
component library gets in the way.

**i18n**: all user-visible text goes through `t()`. A command's `label` field
stores an i18n key (e.g. `commands.task.create`), translated only when the UI
renders the undo message — keeping the command layer language-agnostic.

## End-to-End Acceptance (e2e/)

An earlier phase's UI acceptance was throwaway `browser_evaluate` assertions.
`e2e/` turned them into re-runnable Playwright tests:

- `regression.spec.ts` — six classes of subtle defects that actually happened
  (row alignment, sticky left column, connect-handles and resize-grips being
  clickable, dependency-line endpoints, store unchanged during a drag,
  shading following the calendar). Each uses **implementation-independent**
  expectations (DOM geometry or hand-computed dates), and each was verified to
  turn red by re-introducing the defect.
- `acceptance.spec.ts` — the automatable portion of the design document's
  acceptance criteria.
- `perf.spec.ts` — large-project stress tests (scroll frame rate, calendar
  change blocking).
- `known-limitations.spec.ts` — characterization tests for the "Known
  Limitations" below; fixing one will turn it red immediately.

```bash
pnpm e2e                                  # all
pnpm e2e regression.spec.ts               # regression only
pnpm e2e -g "底纹跟随用户日历"             # filter by title
```

## Known Limitations

> **Note**: each of the three limitations below has a characterization test.
> When you fix one, remove the corresponding test and entry here in the same
> change — otherwise the test turns red and you should know that is
> **expected**.

All three were measured and are reproducible (`e2e/perf.spec.ts` and
`e2e/known-limitations.spec.ts`); they are deliberately left unhandled.

### 1. Re-render stall when changing the calendar on large projects

**Solving is no longer the bottleneck**: the engine runs on a Web Worker —
main-thread blocking dropped from 797ms to ~40ms on a 10k-task plan, and the
UI holds 60fps while solving (see ROADMAP's "排期引擎性能" section).

**The remaining stall is re-rendering, and it only appears when the calendar
changes** (10,000 tasks, production build, measured):

| Operation | Max main-thread frame gap |
|---|---|
| Rename a task (no timeline rebuild) | **17ms** ✅ |
| **Change the calendar** (Gantt rebuilds timeline + shading) | **300ms** ❌ |

Breakdown (1,000-task tier, local headless Chromium):

| Part | Cost |
|---|---|
| `solve()` pure solve | ≈ 16ms |
| store-side sync + forced reflow | ≈ 17ms |
| **The rest ≈ 190ms: `ProjectView` re-render** | |
| ↳ of which the non-workday shading | ≈ 97ms |
| ↳ the rest (full-row geometry memo + timeline) | ≈ 97ms |

A 1,000-node chain stretches the timeline to ~4,200 days, and the
"non-workday shading" alone creates **1,200 DOM nodes** — temporarily making
every day a workday drops the stall to ≈ 113ms. The store side is light (the
solve is a dozen milliseconds).

**Conclusion**: a known performance ceiling, unoptimized. Future directions:
canvas / single-gradient shading, visibility-based sharding of `rectByTaskId`
and the timeline, lower `overscan` for long chains.

> An earlier benchmark (different machine / project shape) measured ~114ms
> at 1,000 tasks and ~215ms at 2,000. Absolute numbers vary with machine and
> timeline span; the order of magnitude is **hundreds of milliseconds**.
>
> ⚠️ Measure this with a **production build**: React dev-mode overhead
> dominates at 10k scale (same operation: 746ms dev vs 17ms prod) — dev
> numbers point optimization in the wrong direction.

### 2. Schedules before the project start render left of the timeline origin

When manual scheduling or a negative lag puts a task's start date **earlier
than `project.startDate`**, its bar lands left of the timeline origin
(negative `left`) and is covered by the sticky left column.

Example: project starts `2026-03-02`; a 3-day task manually pinned to finish
on `2026-03-03` back-computes a start of `2026-02-27` — three calendar days
before the origin, drawn at `x = -96px`.

This is **pre-existing** behavior: the timeline origin is fixed at
`project.startDate`, and any task scheduled before it is covered.
`e2e/known-limitations.spec.ts` pins the current behavior as evidence.

### 3. Column widths are not keyboard-adjustable

Outline column widths can only be changed by dragging the header separators
with a mouse or touch (double-click resets one column); there is no keyboard
entry point (the handle is a `role="separator"` div without a `tabindex`).
Width preferences live in `localStorage` under `planit.outlineColumnWidths` —
they never enter project files or the undo stack.

## Roadmap & Documentation

The v0.1 → v1.0 version series is fully delivered (task tree & dependency
scheduling → dual views & column system → Inspector → resources & effort →
resource leveling → calendar/resource views → date-time precision → baselines
& earned value), followed by the engine v2 rewrite (lag in three units,
manual scheduling, OmniPlan parity, the Web Worker move, and large-scale
performance work).

- [`docs/superpowers/ROADMAP.md`](docs/superpowers/ROADMAP.md) — the version
  roadmap and measured performance data
- [`docs/superpowers/HANDOFF.md`](docs/superpowers/HANDOFF.md) — cross-session
  handoff (state / queue / discipline)
- `docs/superpowers/specs/` — detailed design documents for every version

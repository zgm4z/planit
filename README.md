**English** | [简体中文](README.zh-CN.md) | [日本語](README.ja-JP.md)

# Planit

Planit is a browser-based project scheduling tool built around **dependency-driven
scheduling**. Change any task, dependency, calendar, or resource and the whole plan
re-solves automatically — the critical path stays highlighted, resource overloads are
leveled away, and every action is undoable. Everything runs and is stored in your
browser: no server, no account.

## Highlights

- **Automatic re-scheduling** — edit any task, dependency, calendar, or resource and
  the entire plan re-solves instantly
- **Live critical path** — the zero-slack chain is always visible on the Gantt chart
- **Resource leveling** — overloaded resources are leveled away using each task's slack
- **One plan, four views** — Gantt, outline, calendar, and resource, plus a
  task/project inspector
- **Full undo/redo** — one drag is one undo step; nothing is half-applied
- **Local-first** — autosaved in your browser, no server and no sign-up
- **Trilingual UI** — 中文 / English / 日本語, switchable at any time

## Features

### Tasks & Scheduling

- **Task tree** — summary tasks, subtasks, and milestones in a single structure;
  summary dates roll up bottom-up, and a task's kind (leaf vs. group) is derived from
  its structure, so inconsistent data cannot arise.
- **Two scheduling modes**
  - **Automatic** — the planner solves from dependencies and constraints; each task can
    carry a paired start/end constraint (start / finish, no earlier than / no later than).
  - **Manual** — the interval is pinned and never moved by dependencies or leveling;
    conflicts that run into a manual task are surfaced rather than silently absorbed.
- **ASAP / ALAP** placement within each task's feasible window; the project can be
  scheduled forward from the start date or backward from a deadline.
- **Drag to schedule** — drag a bar to move it, drag either handle to change the start or
  the duration; drop points snap to workdays, and a dragged task becomes manually scheduled.
- **Milestones** — zero-duration points that can carry dependencies and be delayed by leveling.

### Dependencies

- **Four dependency types** — finish-to-start, start-to-start, finish-to-finish, and
  start-to-finish — drawn directly from a bar's endpoints on the Gantt chart.
- **Lag in three units** — workdays, elapsed days (spanning weekends and holidays), or a
  percentage of the predecessor's duration; all may be negative as lead time.
- Cycles are rejected the moment they would be created.
- Dependencies that cannot be honored are listed as conflicts instead of being silently reconciled.

### Automatic Scheduling & Critical Path

- A full **critical path method (CPM)** solve: forward pass (early dates), backward pass
  (late dates), total slack, and free slack.
- **Change anything, everything re-solves** — durations, dependencies, constraints,
  calendars, and assignments all trigger a re-solve.
- **Live critical path** — the zero-slack chain is highlighted on the Gantt chart.
- Conflicts are collected in a dedicated list, with how far off a schedule is where relevant.
- The solve runs off the main thread, so large plans stay responsive while recomputing.

### Working Calendars

- Every project carries a **configurable calendar** — weekday selection plus holiday
  exceptions on any date.
- Exceptions can be added or removed **per day or per range**, and a range reverts as a
  single step.
- A **monthly calendar view** colors workdays, non-workdays, and exceptions; click a date
  to toggle it.
- Resources can attach their **own calendar** or fall back to the project default.
- Changing the calendar re-solves the whole project.

### Resources & Effort

- **Four resource kinds** — staff, equipment, material, and group (groups nest).
- Per resource: **availability** (for example 50% for part-time), **efficiency**, an
  **available period** (hire date / lease window), and **cost** (per-use plus an hourly rate).
- **Assignments from either side** — "who works on this task" from the task panel, or
  "which tasks this person is on" from the resource panel: the same record, the same commands.
- **Two effort models** — fixed duration (adding a person adds effort and keeps the
  duration) and fixed effort (adding a person actually shortens the task).
- Derived totals for every task and resource: uses, hours, and cost.

### Resource Leveling

- When a resource is over-allocated on a day, the planner **pushes tasks forward within
  their slack** until the load fits or the slack runs out.
- **Priority decides who yields** — higher-priority tasks keep the resource first, and
  pinned tasks (manual scheduling / constraints) never move.
- Overloads that cannot be resolved are reported precisely: which resource, which day, and
  at what load.
- The resource timeline **highlights overloads**, so double-bookings are visible at a glance.
- Leveling is a single command and can be undone.

### Baselines & Earned Value

- **Multiple baseline snapshots** — capture the plan at any time, keep as many as you
  like, and switch the active comparison baseline freely.
- **Schedule variance** — each task shows its baseline start/finish against the current
  schedule, in workdays.
- **Earned value** — BAC, EV, PV, and SV are derived from cost and progress.
- Set a status date together with an active baseline to unlock PV and SV.

### Views

- **Gantt** — task bars, dependency lines with correct endpoint semantics for all four
  types, critical-path highlighting, non-workday shading, and drag scheduling.
- **Outline** — the task tree as a table with a configurable column set (start, finish,
  slack, assigned, cost, variance, and more), draggable column widths, and persisted preferences.
- **Calendar** and **resource** views complete a four-way view switcher.
- A **two-tab inspector** (task / project) gathers task info, scheduling, constraints,
  dependencies, assignments, baselines, and earned value.

### Data, Undo & Language

- **Command model** — every change goes through a registered command; the UI dispatches,
  it never writes data directly.
- **Full undo/redo** — forward and inverse patches are generated automatically, and one
  drag is one undo step.
- **Autosave** — debounced persistence to browser storage; refresh and nothing is lost,
  and older saves keep opening as the schema evolves.
- **Trilingual UI** — 中文 / English / 日本語, with every string translated, including
  undo messages.

## Tech Stack

React 19 · TypeScript · Vite · Mantine 9 · SCSS Modules · react-i18next · Zustand ·
Immer · @tanstack/react-virtual · date-fns

## Getting Started

```bash
pnpm install
pnpm dev        # start the dev server (port 5174)
pnpm build      # production build
pnpm test       # unit tests
pnpm typecheck  # type check
```

## License

[PolyForm Noncommercial 1.0.0](LICENSE).

- **Noncommercial use is free** — use, modify, and distribute the software for personal
  study and research, hobby projects, and educational, charitable, public-research, and
  governmental use.
- **Forks and derivative works must retain** the original copyright and license notices
  and pass these terms along with any distribution.
- **Commercial use** is not covered by the license and requires the author's separate permission.

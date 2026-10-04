import type { Page } from '@playwright/test'
import {
  DEFAULT_FINISH_TIME,
  DEFAULT_START_TIME,
  ensureDateTime,
} from '../src/domain/calendar/dateTime'

/**
 * e2e 的公共夹具与工具。
 *
 * 设计原则（严格遵守）：
 * **期望值不来自实现内部的辅助函数。** 任务条几何、日期、底纹位置等断言，
 * 要么从 DOM 独立读出（`getBoundingClientRect`），要么在测试里手算。
 * 直接 import `timeline.ts` / `workdays.ts` 去算期望值是循环论证 —— 那些
 * 正是被测对象，一起改了测试照样绿。
 */

// ── 夹具项目（纯数据，可序列化后传进浏览器）──────────────────

export interface FixtureTask {
  id: string
  name: string
  parentId?: string | null
  duration?: number
  kind?: 'task' | 'milestone' | 'group'
  /** v0.6：平衡优先级（数值越大越优先） */
  priority?: number
  /** v0.6：平衡时应推迟的工作日数 */
  delay?: number
  /** v1.0：进度（0–100），挣值 EV 的输入 */
  progress?: number
}

export interface FixtureDep {
  id: string
  from: string
  to: string
  type?: 'FS' | 'SS' | 'FF' | 'SF'
  lag?: number
}

export interface FixtureCalendar {
  workingDays?: boolean[]
  exceptions?: Record<string, { kind: 'holiday' }>
}

export interface FixtureSpec {
  name?: string
  /** 项目基准开始日期 */
  startDate?: string
  tasks: FixtureTask[]
  deps?: FixtureDep[]
  calendar?: FixtureCalendar
  /** v0.5：夹具里的资源（缺省为空 —— 老夹具不必改） */
  resources?: {
    id: string
    name: string
    kind?: string
    /** v0.7：资源树的父子关系（缺省 = 顶层） */
    parentId?: string
    availableFrom?: string
    availableUntil?: string
    /** v1.0：一次性使用成本（挣值的预算来源） */
    usage?: number
    /** v1.0：小时费率 */
    hourly?: number
  }[]
  /** v0.5：夹具里的分配（task/resource 都是夹具里已声明的 id） */
  assignments?: { id: string; task: string; resource: string; units?: number }[]
  /** v1.0：挣值基准日（缺省 = 未设，PV / SV 不可算） */
  statusDate?: string
}

const DEFAULT_WORKING_DAYS = [true, true, true, true, true, false, false]

/**
 * 手工构造一个 Project 字面量 —— 不使用 `createProject` / `createTask` 工厂。
 *
 * 用工厂会引入自增 id 计数器（跨模块全局状态），id 随调用顺序漂移，
 * 测试里就没法用字面量 id 引用任务了。字面量构造让每个 id 都可预测。
 */
export function makeProject(spec: FixtureSpec): Record<string, unknown> {
  // v0.8：夹具**不经迁移**（loadFixture 直接 loadProject，不走 parsePersistedProject），
  // 所以它必须自己给出带时刻的形状 —— 与工厂/迁移用同一份 ensureDateTime（单一实现）。
  const startDate = ensureDateTime(spec.startDate ?? '2026-03-02', DEFAULT_START_TIME) // 周一
  const calendarId = 'default'

  const tasks: Record<string, unknown> = {}
  const hasChildren = new Set<string>()
  for (const t of spec.tasks) {
    if (t.parentId) hasChildren.add(t.parentId)
  }

  for (const t of spec.tasks) {
    // 有子任务即 group —— 与命令层不变式 2 是同一条规则。
    // 判序很重要：hasChildren 优先。写成 `t.parentId ? 'task' : …` 会把
    // 「既有父节点又有子任务」的节点错标成 task，那正是不变式 2 禁止的形状。
    const kind = t.kind ?? (hasChildren.has(t.id) ? 'group' : 'task')
    tasks[t.id] = {
      id: t.id,
      name: t.name,
      parentId: t.parentId ?? null,
      childIds: [] as string[],
      kind,
      duration: kind === 'milestone' ? 0 : (t.duration ?? 1),
      scheduling: { mode: 'auto' },
      progress: t.progress ?? 0,
      effortMode: 'fixedDuration',
      schedulingOrder: 'asap',
      note: '',
      allowSplitting: false,
      priority: t.priority ?? 0,
      delay: t.delay ?? 0,
    }
  }

  // 回填 childIds / rootIds —— 顺序即树序
  const rootIds: string[] = []
  for (const t of spec.tasks) {
    if (t.parentId) {
      ;(tasks[t.parentId] as { childIds: string[] }).childIds.push(t.id)
    } else {
      rootIds.push(t.id)
    }
  }

  const dependencies: Record<string, unknown> = {}
  for (const d of spec.deps ?? []) {
    dependencies[d.id] = {
      id: d.id,
      fromTaskId: d.from,
      toTaskId: d.to,
      type: d.type ?? 'FS',
      // v6：Dependency.lag 是带单位的 Lag（夹具用整数工作日表达）
      lag: { kind: 'workdays', days: d.lag ?? 0 },
    }
  }

  const now = '2026-03-01T00:00:00.000Z'
  return {
    id: 'proj_e2e',
    name: spec.name ?? 'E2E',
    schemaVersion: 6,
    startDate,
    schedulingDirection: 'forward',
    calendarId,
    calendars: {
      [calendarId]: {
        id: calendarId,
        name: '标准日历',
        workingDays: spec.calendar?.workingDays ?? DEFAULT_WORKING_DAYS,
        hoursPerDay: 8,
        exceptions: spec.calendar?.exceptions ?? {},
      },
    },
    tasks,
    rootIds,
    dependencies,
    // 资源的默认可用量给 1（满负荷）—— 夹具只声明排期相关字段，
    // 其余按 schema 默认值补齐，避免每个用例重复写一堆无关属性。
    resources: Object.fromEntries(
      (spec.resources ?? []).map((resource) => [
        resource.id,
        {
          id: resource.id,
          name: resource.name,
          kind: resource.kind ?? 'staff',
          parentId: resource.parentId ?? null,
          availability: 1,
          ...(resource.availableFrom
            ? { availableFrom: ensureDateTime(resource.availableFrom, DEFAULT_START_TIME) }
            : {}),
          ...(resource.availableUntil
            ? { availableUntil: ensureDateTime(resource.availableUntil, DEFAULT_FINISH_TIME) }
            : {}),
          // 费率字段只在夹具显式给出时才写 —— createResource 的默认成本是
          // 裸的 `{ currency }`，缺字段时引擎按 0 兜底（见 effort.ts 的 assignmentCost）。
          cost: {
            currency: 'CNY',
            ...(resource.usage !== undefined ? { usage: resource.usage } : {}),
            ...(resource.hourly !== undefined ? { hourly: resource.hourly } : {}),
          },
        },
      ]),
    ),
    assignments: Object.fromEntries(
      (spec.assignments ?? []).map((assignment) => [
        assignment.id,
        {
          id: assignment.id,
          taskId: assignment.task,
          resourceId: assignment.resource,
          units: assignment.units ?? 1,
        },
      ]),
    ),
    // v1.0：solve() 会读 project.baselines，缺字段会抛 —— 夹具必须显式给空数组
    baselines: [],
    activeBaselineId: null,
    ...(spec.statusDate
      ? { statusDate: ensureDateTime(spec.statusDate, DEFAULT_FINISH_TIME) }
      : {}),
    createdAt: now,
    updatedAt: now,
  }
}

/** 9 个任务的长链（t1 → t2 → … → t9），每个工期 2 个工作日。 */
export function chainProject(): Record<string, unknown> {
  const tasks = Array.from({ length: 9 }, (_, i) => ({
    id: `t${i + 1}`,
    name: `任务 ${i + 1}`,
    duration: 2,
  }))
  const deps = Array.from({ length: 8 }, (_, i) => ({
    id: `d${i + 1}`,
    from: `t${i + 1}`,
    to: `t${i + 2}`,
  }))
  return makeProject({ name: '链式项目', tasks, deps })
}

// ── 页面操作 ────────────────────────────────────────────────

/**
 * 等排期重算落地。
 *
 * 求解已移到 worker（无 Worker 时是同步兜底，但 store 的落地一律是异步）：
 * `dispatch` / `loadProject` 现在**先返回、稍后**才把结果写进 scheduleStore
 * （期间 `computing === true`）。凡「dispatch / loadProject 之后立刻读 store（或读
 * 由排期派生的 DOM）」的断言，都必须先等这一步，否则会读到上一次的结果（竞态）。
 */
export async function waitForScheduleSettled(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    const mod = (await import('/src/store/scheduleStore.ts')) as {
      useScheduleStore: { getState: () => { computing: boolean } }
    }
    return mod.useScheduleStore.getState().computing === false
  })
}

/** 打开首页并把一份夹具项目直接载入 store（绕过 IndexedDB / 新建流程）。 */
export async function loadFixture(page: Page, project: Record<string, unknown>): Promise<void> {
  await page.goto('/')
  await page.evaluate(async (p) => {
    const mod = (await import('/src/store/projectStore.ts')) as {
      useProjectStore: { getState: () => { loadProject: (project: unknown) => void } }
    }
    mod.useProjectStore.getState().loadProject(p)
  }, project)
  // 首次求解是异步的 —— 等它落地，后续断言才有确定的派生排期可读
  await waitForScheduleSettled(page)
  await page.waitForSelector('[data-testid="shared-scroll"]')
  // 等任务树渲染出行 —— 摘要任务没有任务条，因此不能用 task-bar 作等待条件
  await page.waitForSelector('[data-testid^="outline-row-"]')
}

/** 读取当前 store 的关键状态（project / 撤销栈长度 / 项目锚点）。 */
export async function readStore(page: Page): Promise<{
  undoLength: number
  redoLength: number
  taskIds: string[]
  schedulingOfT1: unknown
  taskCount: number
  schedulingDirection: string
  startDate: string
  endDate: string | undefined
  resourceIds: string[]
  assignmentCount: number
}> {
  return page.evaluate(async () => {
    const mod = (await import('/src/store/projectStore.ts')) as {
      useProjectStore: {
        getState: () => {
          project: {
            tasks: Record<string, { scheduling: unknown }>
            resources: Record<string, unknown>
            assignments: Record<string, unknown>
            schedulingDirection: string
            startDate: string
            endDate?: string
          } | null
          undoStack: unknown[]
          redoStack: unknown[]
        }
      }
    }
    const s = mod.useProjectStore.getState()
    const project = s.project!
    return {
      undoLength: s.undoStack.length,
      redoLength: s.redoStack.length,
      taskIds: Object.keys(project.tasks),
      schedulingOfT1: project.tasks.t1?.scheduling,
      taskCount: Object.keys(project.tasks).length,
      schedulingDirection: project.schedulingDirection,
      startDate: project.startDate,
      endDate: project.endDate,
      resourceIds: Object.keys(project.resources),
      assignmentCount: Object.keys(project.assignments).length,
    }
  })
}

/** 在页面内派发一条命令（走 store.dispatch，与真实 UI 同一条路径）。 */
export async function dispatch(page: Page, command: unknown): Promise<void> {
  await page.evaluate(async (cmd) => {
    const mod = (await import('/src/store/projectStore.ts')) as {
      useProjectStore: { getState: () => { dispatch: (c: unknown) => void } }
    }
    mod.useProjectStore.getState().dispatch(cmd)
  }, command)
  // 命令若真的改了项目，会触发一次**异步**重算 —— 等它落地再返回
  await waitForScheduleSettled(page)
}

interface ScheduleEntry {
  earlyStart: string
  earlyFinish: string
  scheduledStart: string
  scheduledFinish: string
  isCritical: boolean
  totalSlack: number
}

/**
 * 读取全部派生排期（taskId → 排期）、冲突任务 id 列表，以及 v0.6 平衡后残留的超载数。
 *
 * `levelingUnresolved` 由引擎产出（`result.leveling.unresolved`），不是测试里重算的 ——
 * 「平衡后是否还超载」这一判定的唯一实现是 `scheduler/leveling.ts`，这里只读它的结论。
 */
export async function readSchedules(
  page: Page,
): Promise<{
  schedules: Record<string, ScheduleEntry>
  conflictTaskIds: string[]
  levelingUnresolved: number
  earnedValues: Record<string, { bac: number; ev: number; pv: number | null; sv: number | null }>
  baselineDiffs: Record<
    string,
    { baselineStart?: string; baselineFinish?: string; startVariance?: number; finishVariance?: number }
  >
}> {
  await waitForScheduleSettled(page)
  return page.evaluate(async () => {
    const mod = (await import('/src/store/scheduleStore.ts')) as {
      useScheduleStore: {
        getState: () => {
          result: {
            schedules: Record<string, ScheduleEntry>
            conflicts: { taskId: string }[]
            leveling: { unresolved: unknown[] }
            earnedValues: Record<string, { bac: number; ev: number; pv: number | null; sv: number | null }>
            baselineDiffs: Record<
              string,
              { baselineStart?: string; baselineFinish?: string; startVariance?: number; finishVariance?: number }
            >
          }
        }
      }
    }
    const r = mod.useScheduleStore.getState().result
    return {
      schedules: r.schedules,
      conflictTaskIds: r.conflicts.map((c) => c.taskId),
      levelingUnresolved: r.leveling.unresolved.length,
      earnedValues: r.earnedValues,
      baselineDiffs: r.baselineDiffs,
    }
  })
}

/**
 * 读取基线列表、活动基线 id 与基准日（用于「切换基线」「删任务不级联」一类的断言）。
 *
 * 读的是 projectStore 里**落盘的那份** project —— 基线条目在删任务后仍在，
 * 正是本模块要独立于 UI 观察的事实。
 */
export async function readBaselines(page: Page): Promise<{
  baselines: {
    id: string
    name: string
    entries: Record<string, { name: string; start: string; finish: string }>
  }[]
  activeBaselineId: string | null
  statusDate: string | undefined
}> {
  return page.evaluate(async () => {
    const mod = (await import('/src/store/projectStore.ts')) as {
      useProjectStore: {
        getState: () => {
          project: {
            baselines: {
              id: string
              name: string
              entries: Record<string, { name: string; start: string; finish: string }>
            }[]
            activeBaselineId: string | null
            statusDate?: string
          } | null
        }
      }
    }
    const project = mod.useProjectStore.getState().project!
    return {
      baselines: project.baselines,
      activeBaselineId: project.activeBaselineId,
      statusDate: project.statusDate,
    }
  })
}

/** 当前项目的依赖条数。 */
export async function readDependencyCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const mod = (await import('/src/store/projectStore.ts')) as {
      useProjectStore: { getState: () => { project: { dependencies: Record<string, unknown> } | null } }
    }
    return Object.keys(mod.useProjectStore.getState().project!.dependencies).length
  })
}

/**
 * 用真实指针事件拖动某个任务条：从条中心水平位移 dx 像素。
 * 分步移动以产生多次 pointermove（拖拽实现按 rAF 节流）。
 */
export async function dragBar(
  page: Page,
  testId: string,
  dx: number,
  from: 'center' | 'left' | 'right' = 'center',
): Promise<void> {
  const box = (await page.locator(`[data-testid="${testId}"]`).boundingBox())!
  const cy = box.y + box.height / 2
  // 左右把手各占条两端 8px；取把手内侧 4px 作为按下点
  const cx =
    from === 'left' ? box.x + 4 : from === 'right' ? box.x + box.width - 4 : box.x + box.width / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  const steps = Math.max(3, Math.round(Math.abs(dx) / 16))
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(cx + (dx * i) / steps, cy)
  }
  await page.mouse.up()
  // 等两帧让影子/提交后的渲染稳定
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
  )
}

/** 读取某个任务的任意字段（用于断言 store 落盘结果）。 */
export async function readTask(page: Page, taskId: string): Promise<Record<string, unknown>> {
  return page.evaluate(async (id) => {
    const mod = (await import('/src/store/projectStore.ts')) as {
      useProjectStore: {
        getState: () => { project: { tasks: Record<string, Record<string, unknown>> } | null }
      }
    }
    return mod.useProjectStore.getState().project!.tasks[id]
  }, taskId)
}

/** TopBar 菜单栏里的六个菜单（§10.2）。 */
export type TopMenuId = 'file' | 'edit' | 'view' | 'task' | 'project' | 'resource'

/**
 * 展开菜单栏里的一个菜单（§10）。
 *
 * 为什么需要它：操作收进菜单后，条目是**浮层**内容 —— 只有菜单展开时才挂载到 DOM。
 * 因此 `[data-testid="new-task"]` 之类的断言必须先展开它所属的菜单。
 * 直接 `page.locator(...).click()` 会命中「元素不存在」，而不是「点错了地方」。
 */
export async function openTopMenu(page: Page, id: TopMenuId): Promise<void> {
  await page.locator(`[data-testid="menu-${id}"]`).click()
}

/** 点菜单栏里的一项：先展开所属菜单，再点条目。点中后菜单自行关闭。 */
export async function clickMenuItem(
  page: Page,
  menu: TopMenuId,
  itemTestId: string,
): Promise<void> {
  await openTopMenu(page, menu)
  await page.locator(`[data-testid="${itemTestId}"]`).click()
}

/** 切换视图并等到滚动容器的 data-view 变化 —— 避免在过渡中间断言 */
export async function switchView(
  page: Page,
  view: 'gantt' | 'outline' | 'calendar' | 'resources',
): Promise<void> {
  await page.locator(`[data-testid="view-option-${view}"]`).click()
  await page.waitForFunction(
    (expected) =>
      document.querySelector('[data-testid="shared-scroll"]')?.getAttribute('data-view') === expected,
    view,
  )
}

/** 读取甘特图的 dayWidth（一天的像素宽）与总天数 —— 从 DOM 独立读取，不走内部常量。 */
export async function readGanttMetrics(
  page: Page,
): Promise<{ dayWidth: number; totalDays: number; paneWidth: number }> {
  return page.evaluate(() => {
    const grid = document.querySelector('[data-testid="outline-column"]')!.parentElement as HTMLElement
    // grid 的模板列：第一列 outline 宽，第二列 gantt 宽
    const dayWidth = Number.parseFloat(
      getComputedStyle(grid).getPropertyValue('--day-width') || '0',
    )
    const pane = document.querySelector('[data-testid="gantt-pane"]') as HTMLElement
    const paneWidth = pane.getBoundingClientRect().width
    return { dayWidth, totalDays: Math.round(paneWidth / dayWidth), paneWidth }
  })
}

// ── v0.7 视图 A（项目日历）/ 视图 B（资源）────────────────────

/**
 * 从 store 独立读出当前日历的例外表（`date → kind`）。
 *
 * 为什么从 store 读而不是数 DOM 行：区间命令在命令层把一天一条**逐日展开**，
 * 而右栏列表经 `groupExceptions` 把连续同类日**聚合**成一行。数行只能验聚合结果，
 * 验不了「区间真的展开了 5 天」——那要看 store 里到底有几个键。这是戒律 ② 的落点：
 * 期望值来自 store 实体，不 import `groupExceptions` 去反推。
 */
export async function readExceptions(page: Page): Promise<Record<string, string>> {
  return page.evaluate(async () => {
    const mod = (await import('/src/store/projectStore.ts')) as {
      useProjectStore: {
        getState: () => {
          project: {
            calendarId: string
            calendars: Record<string, { exceptions: Record<string, { kind: string }> }>
          } | null
        }
      }
    }
    const project = mod.useProjectStore.getState().project!
    const calendar = project.calendars[project.calendarId]
    return Object.fromEntries(
      Object.entries(calendar.exceptions).map(([date, exception]) => [date, exception.kind]),
    )
  })
}

/**
 * 从 DOM 读出资源树的行 id 序列（前序），与 `views.spec.ts` 的 rowIds 同款。
 *
 * DOM 顺序即前序：`ResourceTree` 按 `flattenResourceRows` 的产出原序渲染
 * （虚拟化只改行内 `transform`，不改 DOM 出现顺序）。故这个序列直接反映树序，
 * 不 import `flattenResourceRows` —— 那是被测对象（戒律 ②）。
 */
export async function readResourceRows(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="resource-row-"]')).map((element) =>
      element.getAttribute('data-testid')!.replace('resource-row-', ''),
    ),
  )
}

// ── v1.1 复选（锚点 + 集合）──────────────────────────────────

/**
 * 读取当前选中态（锚点 + 集合）—— 从 store 独立读，不经 DOM 反推。
 * 期望值来自 store 实体（`viewStore`），不是渲染结果。
 */
export async function readSelection(page: Page): Promise<{
  taskIds: string[]
  resourceIds: string[]
  anchorTaskId: string | null
  anchorResourceId: string | null
}> {
  return page.evaluate(async () => {
    const mod = (await import('/src/store/viewStore.ts')) as {
      useViewStore: {
        getState: () => {
          selectedTaskId: string | null
          selectedTaskIds: string[]
          selectedResourceId: string | null
          selectedResourceIds: string[]
        }
      }
    }
    const s = mod.useViewStore.getState()
    return {
      taskIds: s.selectedTaskIds,
      resourceIds: s.selectedResourceIds,
      anchorTaskId: s.selectedTaskId,
      anchorResourceId: s.selectedResourceId,
    }
  })
}

/**
 * 从 DOM 读出「有选中态」的行 id（前序），靠行上的 `data-selected` 判据。
 *
 * 为什么从 DOM 读而不是读 store：多选最初正是「在 UI 上不可见」的 Blocker ——
 * store 里集合是对的、行却不亮。这条助手把「可见性」变成可断言的事实。
 */
export async function readVisibleSelectedRows(
  page: Page,
  prefix: 'outline-row-' | 'resource-row-',
): Promise<string[]> {
  return page.evaluate((rowPrefix) => {
    return Array.from(
      document.querySelectorAll(`[data-testid^="${rowPrefix}"][data-selected]`),
    ).map((element) => element.getAttribute('data-testid')!.replace(rowPrefix, ''))
  }, prefix)
}

/** 按住修饰键点击一行（复选 spec 用）。 */
export async function clickRowWithModifiers(
  page: Page,
  testId: string,
  mods: { ctrl?: boolean; meta?: boolean; shift?: boolean },
): Promise<void> {
  await page.locator(`[data-testid="${testId}"]`).click({
    modifiers: [
      ...(mods.ctrl ? (['Control'] as const) : []),
      ...(mods.meta ? (['Meta'] as const) : []),
      ...(mods.shift ? (['Shift'] as const) : []),
    ],
  })
}

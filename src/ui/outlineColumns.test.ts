import { describe, it, expect } from 'vitest'
import { createTask } from '../domain/model/factories'
import type { ComputedSchedule, Task } from '../domain/model/types'
import zhCN from '../i18n/locales/zh-CN.json'
import enUS from '../i18n/locales/en-US.json'
import jaJP from '../i18n/locales/ja-JP.json'
import {
  DEFAULT_VISIBLE_COLUMNS,
  GANTT_OUTLINE_COLUMNS,
  OUTLINE_COLUMNS,
  getOutlineCellValue,
  isEnabledOutlineColumnKey,
  isOutlineColumnKey,
  resolveScheduleDates,
  type OutlineColumnKey,
} from './outlineColumns'

/**
 * **本版可用**的 11 个 key。
 *
 * 与 spec §4.1 的联合类型**刻意不同**：`assignees` 在 spec 里被列进「本版可用」，
 * 但 §4.2 说它「本版留空占位（v0.5 填数据）」—— 没有真实数据来源，按 ROADMAP 的
 * 分批原则应当「显示但禁用」。因此它被归到 DISABLED_KEYS（见计划开头的偏差 5）。
 */
const ENABLED_KEYS: OutlineColumnKey[] = [
  'kind', 'title', 'note', 'id',
  'start', 'finish', 'duration',
  'priority', 'progress',
  'totalSlack', 'freeSlack',
]

/** **显示但禁用**的 16 个 key（依赖 v0.5 资源功能或 v1.0 基线/挣值功能） */
const DISABLED_KEYS: OutlineColumnKey[] = [
  'assignees',
  'effort', 'taskCost', 'resourceCost', 'totalCost',
  'baselineStart', 'baselineFinish', 'startVariance', 'finishVariance',
  'bcws', 'bcwp', 'acwp', 'cv', 'sv', 'eac', 'bac',
]

/** 沿点号取嵌套 key，取不到返回 undefined —— 不依赖 i18n 实例 */
function lookup(dict: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined),
    dict,
  )
}

function schedule(over: Partial<ComputedSchedule> = {}): ComputedSchedule {
  return {
    earlyStart: '2026-03-02',
    earlyFinish: '2026-03-04',
    lateStart: '2026-03-02',
    lateFinish: '2026-03-04',
    scheduledStart: '2026-03-02',
    scheduledFinish: '2026-03-04',
    totalSlack: 0,
    freeSlack: 0,
    isCritical: true,
    ...over,
  }
}

describe('OUTLINE_COLUMNS 注册表', () => {
  it('恰好覆盖 spec §4.1 联合类型里的 27 个 key，一个不多一个不少', () => {
    expect(OUTLINE_COLUMNS.map((c) => c.key)).toEqual([...ENABLED_KEYS, ...DISABLED_KEYS])
    expect(OUTLINE_COLUMNS).toHaveLength(27)
  })

  it('可用 11 列、禁用 16 列', () => {
    expect(OUTLINE_COLUMNS.filter((c) => c.enabled).map((c) => c.key)).toEqual(ENABLED_KEYS)
    expect(OUTLINE_COLUMNS.filter((c) => !c.enabled).map((c) => c.key)).toEqual(DISABLED_KEYS)
  })

  it('assignees 是禁用列（与 spec §4.1 的刻意偏离，见偏差 5）', () => {
    const assignees = OUTLINE_COLUMNS.find((c) => c.key === 'assignees')!
    expect(assignees.enabled).toBe(false)
    expect(assignees.disabledReasonKey).toBe('outline.disabledReason.resources')
  })

  it('只有 title 是 flex，且它在默认可见列里', () => {
    expect(OUTLINE_COLUMNS.filter((c) => c.flex).map((c) => c.key)).toEqual(['title'])
    expect(DEFAULT_VISIBLE_COLUMNS).toContain('title')
  })

  it('默认可见列的每个 key 都是可用列，且顺序与注册表一致', () => {
    // 注释声称「已按注册表顺序排列」。这里两件事一起钉：
    // 1) 塞进默认列的 key 必须是本版**可用**列 —— 否则首次打开就会冒出一个
    //    菜单里点不动、又删不掉的恒空列（见 isEnabledOutlineColumnKey 的注释）。
    for (const key of DEFAULT_VISIBLE_COLUMNS) {
      expect(isEnabledOutlineColumnKey(key), `${key} 不是本版可用列`).toBe(true)
    }
    // 2) 顺序必须与 OUTLINE_COLUMNS 注册表逐一对应（用注册表过滤反推顺序来断言）。
    expect(DEFAULT_VISIBLE_COLUMNS).toEqual(
      OUTLINE_COLUMNS.filter((c) => DEFAULT_VISIBLE_COLUMNS.includes(c.key)).map((c) => c.key),
    )
  })

  it('每个 key 唯一', () => {
    const keys = OUTLINE_COLUMNS.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('禁用列必须给出 disabledReasonKey，可用列不允许给', () => {
    for (const column of OUTLINE_COLUMNS) {
      if (column.enabled) {
        expect(column.disabledReasonKey, `${column.key} 不该有 disabledReasonKey`).toBeUndefined()
      } else {
        expect(column.disabledReasonKey, `${column.key} 缺 disabledReasonKey`).toBeTruthy()
      }
    }
  })

  it('每列的 labelKey 在三种语言里都有文案（不能渲染出裸 key）', () => {
    for (const column of OUTLINE_COLUMNS) {
      for (const [name, dict] of [['zh', zhCN], ['en', enUS], ['ja', jaJP]] as const) {
        expect(lookup(dict, column.labelKey), `${name} 缺 ${column.labelKey}`).toBeTypeOf('string')
      }
    }
  })

  it('禁用原因文案在三种语言里都存在', () => {
    for (const column of OUTLINE_COLUMNS) {
      if (!column.disabledReasonKey) continue
      for (const dict of [zhCN, enUS, jaJP]) {
        expect(lookup(dict, column.disabledReasonKey)).toBeTypeOf('string')
      }
    }
  })

  it('单元格单位的文案在三种语言里都存在', () => {
    for (const dict of [zhCN, enUS, jaJP]) {
      expect(lookup(dict, 'outline.cell.days')).toBeTypeOf('string')
      expect(lookup(dict, 'outline.cell.percent')).toBeTypeOf('string')
    }
  })

  it('甘特视图左列固定渲染 kind + title 两列', () => {
    expect(GANTT_OUTLINE_COLUMNS.map((c) => c.key)).toEqual(['kind', 'title'])
  })
})

describe('isOutlineColumnKey / isEnabledOutlineColumnKey', () => {
  it('isOutlineColumnKey：注册表里认识的 key 通过，其余一律拒绝', () => {
    expect(isOutlineColumnKey('title')).toBe(true)
    expect(isOutlineColumnKey('assignees')).toBe(true) // 认识 —— 只是本版禁用
    expect(isOutlineColumnKey('ghost-column')).toBe(false)
    expect(isOutlineColumnKey(42)).toBe(false)
    expect(isOutlineColumnKey(null)).toBe(false)
  })

  it('isEnabledOutlineColumnKey：认识的 key 里只有本版可用的算「可用」', () => {
    expect(isEnabledOutlineColumnKey('title')).toBe(true)
    expect(isEnabledOutlineColumnKey('start')).toBe(true)
    // 这几个都「认识」，但本版禁用 —— 载入配置时必须按不可用丢掉
    expect(isEnabledOutlineColumnKey('assignees')).toBe(false)
    expect(isEnabledOutlineColumnKey('effort')).toBe(false)
    expect(isEnabledOutlineColumnKey('bcws')).toBe(false)
    // 不认识的同样拒绝
    expect(isEnabledOutlineColumnKey('ghost-column')).toBe(false)
  })
})

describe('resolveScheduleDates — 单一日期口径', () => {
  it('返回 scheduled*（最终排期），不是 early*', () => {
    // 刻意让 scheduled* 与 early* 不同：只有读对了字段才能通过
    const s = schedule({
      earlyStart: '2026-03-02',
      earlyFinish: '2026-03-04',
      scheduledStart: '2026-03-10',
      scheduledFinish: '2026-03-12',
    })
    expect(resolveScheduleDates(s)).toEqual({ start: '2026-03-10', finish: '2026-03-12' })
  })
})

describe('getOutlineCellValue', () => {
  const task: Task = { ...createTask({ name: '写文档', duration: 3 }), note: '备注', priority: 4, progress: 40 }
  // 这份 schedule 刻意让 scheduled* ≠ early*（2026-03-10/12 vs 2026-03-02/04）：
  // spec §4.2 说列取值口径是本版最容易错的地方 —— 列表读**最终排期** scheduled*，
  // 甘特条读同一对字段；切成 backward 后 scheduled* 会与 early* 分道扬镳。
  // 若 fixture 让两者相等，把实现误写成读 earlyStart 也照样全绿，断言就失去判别力。
  const ctx = {
    task,
    schedule: schedule({
      earlyStart: '2026-03-02',
      earlyFinish: '2026-03-04',
      scheduledStart: '2026-03-10',
      scheduledFinish: '2026-03-12',
      totalSlack: 2,
      freeSlack: 1,
    }),
  }

  it('各可用列取值正确', () => {
    expect(getOutlineCellValue('kind', ctx)).toEqual({ type: 'text', text: '▪' })
    expect(getOutlineCellValue('title', ctx)).toEqual({ type: 'text', text: '写文档' })
    expect(getOutlineCellValue('note', ctx)).toEqual({ type: 'text', text: '备注' })
    expect(getOutlineCellValue('id', ctx)).toEqual({ type: 'text', text: task.id })
    // 断言的是 scheduled*（最终排期），不是 early* —— 见 ctx 上的注释
    expect(getOutlineCellValue('start', ctx)).toEqual({ type: 'text', text: '2026-03-10' })
    expect(getOutlineCellValue('finish', ctx)).toEqual({ type: 'text', text: '2026-03-12' })
    expect(getOutlineCellValue('duration', ctx)).toEqual({ type: 'days', count: 3 })
    expect(getOutlineCellValue('priority', ctx)).toEqual({ type: 'text', text: '4' })
    expect(getOutlineCellValue('progress', ctx)).toEqual({ type: 'percent', value: 40 })
    expect(getOutlineCellValue('totalSlack', ctx)).toEqual({ type: 'days', count: 2 })
    expect(getOutlineCellValue('freeSlack', ctx)).toEqual({ type: 'days', count: 1 })
  })

  it('kind 列是字形的唯一权威来源：分组 ▤（不是三角）/ 里程碑 ◆ / 任务 ▪', () => {
    // 渲染层（OutlineTree 的 KindCell）已改为消费这里的结果，不再另存一份表 ——
    // 这条断言因此是「同一条规则两份实现」的唯一防线。
    const group: Task = { ...createTask({ name: 'G', kind: 'group' }) }
    // 分组**不是** ▾ —— ▾ 是 title 列折叠按钮的字形，两者重复正是缺陷 1
    expect(getOutlineCellValue('kind', { ...ctx, task: group })).toEqual({ type: 'text', text: '▤' })
    const milestone: Task = { ...createTask({ name: 'M', kind: 'milestone' }) }
    expect(getOutlineCellValue('kind', { ...ctx, task: milestone })).toEqual({ type: 'text', text: '◆' })
  })

  it('里程碑的 duration 显示破折号而不是 0 天', () => {
    const milestone: Task = { ...createTask({ name: 'M', kind: 'milestone' }) }
    expect(getOutlineCellValue('duration', { ...ctx, task: milestone })).toEqual({
      type: 'text',
      text: '—',
    })
  })

  it('没有排期时日期/浮时列是空，而不是崩或 "undefined"', () => {
    const bare = { task, schedule: undefined }
    expect(getOutlineCellValue('start', bare)).toEqual({ type: 'empty' })
    expect(getOutlineCellValue('finish', bare)).toEqual({ type: 'empty' })
    expect(getOutlineCellValue('totalSlack', bare)).toEqual({ type: 'empty' })
    expect(getOutlineCellValue('freeSlack', bare)).toEqual({ type: 'empty' })
  })

  it('禁用列没有取值来源，一律为空（它们永远不会被渲染）', () => {
    for (const key of DISABLED_KEYS) {
      expect(getOutlineCellValue(key, ctx)).toEqual({ type: 'empty' })
    }
    // 显式钉一下 assignees：它在 spec 里被误列为「可用」，本版是禁用列
    expect(getOutlineCellValue('assignees', ctx)).toEqual({ type: 'empty' })
  })
})

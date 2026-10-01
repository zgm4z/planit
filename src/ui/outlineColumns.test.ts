import { describe, it, expect } from 'vitest'
import { createAssignment, createProject, createResource, createTask } from '../domain/model/factories'
import type { ComputedSchedule, Task } from '../domain/model/types'
import zhCN from '../i18n/locales/zh-CN.json'
import enUS from '../i18n/locales/en-US.json'
import jaJP from '../i18n/locales/ja-JP.json'
import {
  DEFAULT_VISIBLE_COLUMNS,
  GANTT_OUTLINE_COLUMNS,
  OUTLINE_COLUMNS,
  cellFlex,
  getOutlineCellValue,
  isEnabledOutlineColumnKey,
  isOutlineColumnKey,
  resolveScheduleDates,
  type OutlineColumnKey,
} from './outlineColumns'

/**
 * **本版可用**的 24 个 key。
 *
 * v0.5 起 `assignees` / `effort` / 三种成本列从「显示但禁用」转入可用；v1.0 起
 * 基线 4 列 + 可算的挣值 4 列同样转入可用 —— 它们都有了真实数据来源，再禁用就是
 * 说谎（分批原则：可用 = **有真实数据来源**）。
 */
const ENABLED_KEYS: OutlineColumnKey[] = [
  'kind', 'title', 'note', 'id',
  'start', 'finish', 'duration',
  'priority', 'progress',
  'totalSlack', 'freeSlack',
  'assignees', 'effort', 'taskCost', 'resourceCost', 'totalCost',
  // v1.0：基线 4 列 + 可算的挣值 4 列
  'baselineStart', 'baselineFinish', 'startVariance', 'finishVariance',
  'bcws', 'bcwp', 'sv', 'bac',
]

/** **显示但禁用**的 3 个 key（依赖实际成本录入 —— 尚未排期） */
const DISABLED_KEYS: OutlineColumnKey[] = ['acwp', 'cv', 'eac']

/** 沿点号取嵌套 key，取不到返回 undefined —— 不依赖 i18n 实例 */
function lookup(dict: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined),
    dict,
  )
}

/** 收集一棵字典树的全部「叶子字符串」路径 —— 与 inspectorGroups.test.ts 同款，用来比对三语键集合 */
function leafKeys(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix]
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
      leafKeys(value, prefix ? `${prefix}.${key}` : key),
    )
  }
  return []
}

const zhOutlineKeys = leafKeys(zhCN.outline, 'outline').sort()
const enOutlineKeys = leafKeys(enUS.outline, 'outline').sort()
const jaOutlineKeys = leafKeys(jaJP.outline, 'outline').sort()

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

  it('可用 24 列、禁用 3 列', () => {
    expect(OUTLINE_COLUMNS.filter((c) => c.enabled).map((c) => c.key)).toEqual(ENABLED_KEYS)
    expect(OUTLINE_COLUMNS.filter((c) => !c.enabled).map((c) => c.key)).toEqual(DISABLED_KEYS)
  })

  it('v0.5：assignees 已解禁（有真实数据来源），三种成本与投入列同批解禁', () => {
    const assignees = OUTLINE_COLUMNS.find((c) => c.key === 'assignees')!
    expect(assignees.enabled).toBe(true)
    expect(assignees.disabledReasonKey).toBeUndefined()
    for (const key of ['effort', 'taskCost', 'resourceCost', 'totalCost'] as const) {
      expect(OUTLINE_COLUMNS.find((c) => c.key === key)!.enabled).toBe(true)
    }
  })

  it('v1.0：基线 4 列与可算的挣值 4 列解禁；依赖实际成本的 3 列仍禁用且注明', () => {
    for (const key of [
      'baselineStart', 'baselineFinish', 'startVariance', 'finishVariance',
      'bcws', 'bcwp', 'sv', 'bac',
    ] as const) {
      const column = OUTLINE_COLUMNS.find((c) => c.key === key)!
      expect(column.enabled, key).toBe(true)
      expect(column.disabledReasonKey, key).toBeUndefined()
    }
    for (const key of ['acwp', 'cv', 'eac'] as const) {
      const column = OUTLINE_COLUMNS.find((c) => c.key === key)!
      expect(column.enabled, key).toBe(false)
      expect(column.disabledReasonKey, key).toBe('outline.disabledReason.actualCost')
      // 文案不指版本号 —— v1.0 是最后一版，「尚未排期」写在三语文案里（见 i18n 守卫）
    }
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
      // v0.5 新增的两种取值（投入 / 成本）也必须在三语里都有文案，否则渲染出裸 key
      expect(lookup(dict, 'outline.cell.effort')).toBeTypeOf('string')
      expect(lookup(dict, 'outline.cell.cost')).toBeTypeOf('string')
    }
  })

  it('甘特视图左列固定渲染 kind + title 两列', () => {
    expect(GANTT_OUTLINE_COLUMNS.map((c) => c.key)).toEqual(['kind', 'title'])
  })
})

describe('outline 的三语文案', () => {
  it('zh / en / ja 的 outline 叶子键集合完全相等 —— 双向差集，抓到「某语言多出一个键」的漂移', () => {
    // 上面那些逐键存在性检查（`labelKey` / `disabledReasonKey` 在三语里都有）只查
    // 「某个 key 在不在」，抓不到「某语言**多**出一个键」这种漂移 —— 本次正是
    // 「删 baseline、加 actualCost」的集合变更，漏删一侧时逐键检查全绿。
    // 因此这里断言整块键集合相等（双向）：多一个或少一个都会红。
    expect(enOutlineKeys).toEqual(zhOutlineKeys)
    expect(jaOutlineKeys).toEqual(zhOutlineKeys)
  })

  it('outline 叶子键数量足够多（三语文案确实落盘了，不是空对象对空对象）', () => {
    expect(zhOutlineKeys.length).toBeGreaterThan(20)
  })
})

describe('cellFlex — 表头与单元格共用的列宽口径', () => {
  it('flex 列吃剩余宽度（1 1 Wpx），其余固定宽且不收缩（0 0 Wpx）', () => {
    // title 是唯一的 flex 列；其余（如 start）固定宽、不收缩
    expect(cellFlex(OUTLINE_COLUMNS.find((c) => c.key === 'title')!)).toBe('1 1 240px')
    expect(cellFlex(OUTLINE_COLUMNS.find((c) => c.key === 'start')!)).toBe('0 0 100px')
  })
})

describe('isOutlineColumnKey / isEnabledOutlineColumnKey', () => {
  it('isOutlineColumnKey：注册表里认识的 key 通过，其余一律拒绝', () => {
    expect(isOutlineColumnKey('title')).toBe(true)
    expect(isOutlineColumnKey('assignees')).toBe(true) // 认识且本版可用（v0.5 解禁）
    expect(isOutlineColumnKey('ghost-column')).toBe(false)
    expect(isOutlineColumnKey(42)).toBe(false)
    expect(isOutlineColumnKey(null)).toBe(false)
  })

  it('isEnabledOutlineColumnKey：认识的 key 里只有本版可用的算「可用」', () => {
    expect(isEnabledOutlineColumnKey('title')).toBe(true)
    expect(isEnabledOutlineColumnKey('start')).toBe(true)
    // v0.5 起 assignees / effort 有了真实数据来源，载入配置时按可用接受
    expect(isEnabledOutlineColumnKey('assignees')).toBe(true)
    expect(isEnabledOutlineColumnKey('effort')).toBe(true)
    // v1.0 起 bcws 有真实数据来源（引擎的 costs），载入配置时按可用接受
    expect(isEnabledOutlineColumnKey('bcws')).toBe(true)
    // acwp 需要实际成本录入 —— 「认识」但本版禁用，载入时必须丢掉
    expect(isEnabledOutlineColumnKey('acwp')).toBe(false)
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

  it('摘要行（group）的 duration / progress 为空 —— 这两个量对摘要无意义', () => {
    // duration 取一个**非零且非默认**的值（7），否则「返回原值」与「返回空」
    // 在断言里区分不出来（新建任务的 duration 默认就是 1，取 1 会让假实现也通过）。
    // 构造一个真有子任务的摘要行：kind 为 group、childIds 非空。
    const summary: Task = {
      ...createTask({ name: '阶段一', kind: 'group', duration: 7 }),
      progress: 55,
      childIds: ['task_child'],
    }

    // 摘要行的 duration / progress 从不被维护（summarizeParents 只汇总排期/浮时），
    // 直接返回 task.* 会让摘要行显示陈旧原始值 —— 这里断言其为 EMPTY。
    expect(getOutlineCellValue('duration', { ...ctx, task: summary })).toEqual({ type: 'empty' })
    expect(getOutlineCellValue('progress', { ...ctx, task: summary })).toEqual({ type: 'empty' })

    // 反向对照：同样非零的 duration/progress 落在普通任务上必须原样透出，
    // 免得把「摘要行为空」误实现成「duration/progress 一律为空」。
    expect(getOutlineCellValue('duration', ctx)).toEqual({ type: 'days', count: 3 })
    expect(getOutlineCellValue('progress', ctx)).toEqual({ type: 'percent', value: 40 })
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
  })

  it('assignees 列取真实资源名；未分配时为 empty', () => {
    const resource = { ...createResource({ name: '张三' }), id: 'r1' }
    const assignment = { ...createAssignment({ taskId: task.id, resourceId: 'r1' }), id: 'a1' }
    const withAssignments = {
      ...ctx,
      project: { ...createProject('x'), resources: { r1: resource }, assignments: { a1: assignment } },
    }
    expect(getOutlineCellValue('assignees', withAssignments)).toEqual({ type: 'text', text: '张三' })
    expect(getOutlineCellValue('assignees', ctx)).toEqual({ type: 'empty' })
  })

  it('effort 列读引擎的 efforts；无之则为 empty', () => {
    expect(getOutlineCellValue('effort', { ...ctx, efforts: { [task.id]: 5 } })).toEqual({
      type: 'effort', count: 5,
    })
    expect(getOutlineCellValue('effort', ctx)).toEqual({ type: 'empty' })
  })

  it('三种成本列读引擎的 costs，零成本时为 empty', () => {
    const withCosts = { ...ctx, costs: { [task.id]: { task: 500, resource: 0, total: 500 } } }
    expect(getOutlineCellValue('taskCost', withCosts)).toEqual({ type: 'cost', amount: 500 })
    expect(getOutlineCellValue('resourceCost', withCosts)).toEqual({ type: 'empty' })
    expect(getOutlineCellValue('totalCost', withCosts)).toEqual({ type: 'cost', amount: 500 })
  })

  it('v1.0 基线列读引擎的 baselineDiffs；无差异数据时为 empty', () => {
    const withDiff = {
      ...ctx,
      baselineDiffs: {
        [task.id]: {
          baselineStart: '2026-03-02',
          baselineFinish: '2026-03-04',
          startVariance: 0,
          finishVariance: 2,
        },
      },
    }
    expect(getOutlineCellValue('baselineStart', withDiff)).toEqual({ type: 'text', text: '2026-03-02' })
    expect(getOutlineCellValue('baselineFinish', withDiff)).toEqual({ type: 'text', text: '2026-03-04' })
    // 差异是**工作日**（unit = days），不是金额 —— 与 sv 不同量纲
    expect(getOutlineCellValue('startVariance', withDiff)).toEqual({ type: 'days', count: 0 })
    expect(getOutlineCellValue('finishVariance', withDiff)).toEqual({ type: 'days', count: 2 })
    // 无差异数据 → 空。注意 startVariance 用 `=== undefined` 判定而非真值 —— 0 是
    // 真实数据（不早不晚），上面那条 0 必须渲染成「0 天」而不是空。
    expect(getOutlineCellValue('baselineStart', ctx)).toEqual({ type: 'empty' })
    expect(getOutlineCellValue('finishVariance', ctx)).toEqual({ type: 'empty' })
    expect(getOutlineCellValue('startVariance', ctx)).toEqual({ type: 'empty' })
  })

  it('v1.0 挣值列读引擎的 earnedValues（金额）；仅 null 视为空', () => {
    const withEv = {
      ...ctx,
      earnedValues: { [task.id]: { bac: 1000, ev: 400, pv: 750, sv: -350 } },
    }
    expect(getOutlineCellValue('bac', withEv)).toEqual({ type: 'cost', amount: 1000 })
    expect(getOutlineCellValue('bcwp', withEv)).toEqual({ type: 'cost', amount: 400 })
    expect(getOutlineCellValue('bcws', withEv)).toEqual({ type: 'cost', amount: 750 })
    expect(getOutlineCellValue('sv', withEv)).toEqual({ type: 'cost', amount: -350 })

    // 0 是**真实数据**（有成本但进度为 0），照常显示 —— 与成本列的「0 视同空」相反
    const zero = { ...ctx, earnedValues: { [task.id]: { bac: 0, ev: 0, pv: 0, sv: 0 } } }
    expect(getOutlineCellValue('bcwp', zero)).toEqual({ type: 'cost', amount: 0 })
    expect(getOutlineCellValue('bcws', zero)).toEqual({ type: 'cost', amount: 0 })

    // null = 算不出来（缺基准日 / 基线）→ 空。若实现把 null 当 0，这里会红
    const none = { ...ctx, earnedValues: { [task.id]: { bac: 1000, ev: 400, pv: null, sv: null } } }
    expect(getOutlineCellValue('bcws', none)).toEqual({ type: 'empty' })
    expect(getOutlineCellValue('sv', none)).toEqual({ type: 'empty' })
    expect(getOutlineCellValue('bcwp', none)).toEqual({ type: 'cost', amount: 400 })

    // 无 earnedValues 数据源 → 全部为空
    for (const key of ['bcws', 'bcwp', 'sv', 'bac'] as const) {
      expect(getOutlineCellValue(key, ctx)).toEqual({ type: 'empty' })
    }
  })

  it('整表不变式：遍历 ENABLED_KEYS，每个可用 key 在一个「数据齐全」的 ctx 下都取到非空值', () => {
    // 兑现 getOutlineCellValue 上方注释的承诺（「每个可用 key 都有取值口径」能**整表**
    // 断言）。上面各用例都是子集；这条用一个把五种数据源全填满的 ctx 遍历全部可用 key，
    // 漏写/写错某个 case 的 key 会在这里红，而不是靠在别处碰巧枚举到。
    const resource = { ...createResource({ name: '张三' }), id: 'r1' }
    const assignment = { ...createAssignment({ taskId: task.id, resourceId: 'r1' }), id: 'a1' }
    const rich = {
      ...ctx,
      project: { ...createProject('x'), resources: { r1: resource }, assignments: { a1: assignment } },
      efforts: { [task.id]: 5 },
      costs: { [task.id]: { task: 500, resource: 200, total: 700 } },
      earnedValues: { [task.id]: { bac: 1000, ev: 400, pv: 750, sv: -350 } },
      baselineDiffs: {
        [task.id]: {
          baselineStart: '2026-03-02',
          baselineFinish: '2026-03-04',
          startVariance: 0,
          finishVariance: 2,
        },
      },
    }
    for (const key of ENABLED_KEYS) {
      expect(getOutlineCellValue(key, rich).type, `${key} 没有取值口径`).not.toBe('empty')
    }
  })
})

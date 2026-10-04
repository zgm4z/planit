import { describe, it, expect, beforeEach, vi } from 'vitest'
import { COLUMN_WIDTH_MAX, COLUMN_WIDTH_MIN, TITLE_COLUMN_WIDTH_MIN, DEFAULT_VISIBLE_COLUMNS } from './columnKeys'
import {
  COLUMN_WIDTHS_PERSIST_DEBOUNCE_MS,
  DAY_WIDTH_MAX,
  DAY_WIDTH_MIN,
  DAY_WIDTH_PRESETS,
  OUTLINE_COLUMNS_STORAGE_KEY,
  OUTLINE_COLUMN_WIDTHS_STORAGE_KEY,
  loadColumnWidths,
  loadVisibleColumns,
  normalizeColumnWidths,
  normalizeVisibleColumns,
  presetOfDayWidth,
  useViewStore,
  __resetViewStoreForTests,
} from './viewStore'

beforeEach(() => {
  localStorage.clear()
  __resetViewStoreForTests()
})

describe('normalizeVisibleColumns', () => {
  it('过滤不认识的 key', () => {
    expect(normalizeVisibleColumns(['title', 'ghost-column', 'start'])).toEqual(['title', 'start'])
  })

  it('本版禁用（但认识）的 key 同样被丢掉', () => {
    // acwp / cv 依赖实际成本录入（v1.0 未交付），认识但禁用。绝不能放进来 ——
    // 菜单里它们的开关是 disabled，渲染出来就关不掉了。
    // v1.0 起 bcws / baselineStart 已解禁，因此这里改用仍禁用的 acwp / cv 取样。
    expect(normalizeVisibleColumns(['title', 'acwp', 'cv'])).toEqual(['title'])
  })

  it('去重并按注册表顺序排列（与输入顺序无关）', () => {
    expect(normalizeVisibleColumns(['freeSlack', 'title', 'title', 'kind'])).toEqual([
      'kind',
      'title',
      'freeSlack',
    ])
  })

  it('空数组也会补上 title —— 至少一列可见', () => {
    expect(normalizeVisibleColumns([])).toEqual(['title'])
  })

  it('非数组输入（存档被改坏）退回「只有 title」而不是抛错', () => {
    expect(normalizeVisibleColumns({ nope: true })).toEqual(['title'])
    expect(normalizeVisibleColumns(null)).toEqual(['title'])
    expect(normalizeVisibleColumns('title')).toEqual(['title'])
  })
})

describe('loadVisibleColumns', () => {
  it('没有存档时用默认列', () => {
    expect(loadVisibleColumns()).toEqual(DEFAULT_VISIBLE_COLUMNS)
  })

  it('读到存档时按存档来（未知 key 被静默丢掉）', () => {
    localStorage.setItem(
      OUTLINE_COLUMNS_STORAGE_KEY,
      JSON.stringify(['title', 'ghost-column', 'note']),
    )
    expect(loadVisibleColumns()).toEqual(['title', 'note'])
  })

  it('非法 JSON 退回默认，绝不因此崩溃', () => {
    localStorage.setItem(OUTLINE_COLUMNS_STORAGE_KEY, '{oops')
    expect(loadVisibleColumns()).toEqual(DEFAULT_VISIBLE_COLUMNS)
  })
})

describe('viewStore 的列配置', () => {
  it('setVisibleColumns 归一化后落盘到 localStorage', () => {
    useViewStore.getState().setVisibleColumns(['progress', 'title', 'bogus'])
    expect(useViewStore.getState().visibleColumns).toEqual(['title', 'progress'])
    expect(JSON.parse(localStorage.getItem(OUTLINE_COLUMNS_STORAGE_KEY)!)).toEqual([
      'title',
      'progress',
    ])
  })

  it('toggleColumn 打开 / 关闭一列', () => {
    // 用 `note` 取样而不是 `progress`：progress 现在**在默认集里**（§7 的列优先级），
    // 首次 toggle 会把它关掉 —— 那样断言的是「关闭」而不是「打开」，判别力反了。
    const { toggleColumn } = useViewStore.getState()
    toggleColumn('note')
    expect(useViewStore.getState().visibleColumns).toContain('note')

    toggleColumn('note')
    expect(useViewStore.getState().visibleColumns).not.toContain('note')
  })

  it('toggleColumn 对 title 是 no-op —— title 不允许取消', () => {
    useViewStore.getState().toggleColumn('title')
    expect(useViewStore.getState().visibleColumns).toContain('title')
  })

  it('把所有可取消的列都关掉，title 仍在', () => {
    const { toggleColumn, visibleColumns } = useViewStore.getState()
    for (const key of [...visibleColumns]) toggleColumn(key)
    expect(useViewStore.getState().visibleColumns).toEqual(['title'])
  })
})

describe('viewStore 的 activeView', () => {
  it('默认是 gantt，且 setActiveView 不写 localStorage', () => {
    expect(useViewStore.getState().activeView).toBe('gantt')
    useViewStore.getState().setActiveView('outline')
    expect(useViewStore.getState().activeView).toBe('outline')
    // 不持久化：localStorage 里不该出现视图相关的键
    expect(localStorage.length).toBe(0)
  })
})

// Inspector 的 Tab 与选中资源从组件 useState 提升到 store（菜单栏要够得着），
// 这两个字段的默认值必须与搬移前完全一致，否则是行为变更而非「搬家」。
describe('viewStore 的 Inspector Tab 与选中资源', () => {
  it('activeInspectorTab 默认 task，setActiveInspectorTab 改它且不落盘', () => {
    expect(useViewStore.getState().activeInspectorTab).toBe('task')
    useViewStore.getState().setActiveInspectorTab('resource')
    expect(useViewStore.getState().activeInspectorTab).toBe('resource')
    useViewStore.getState().setActiveInspectorTab('project')
    expect(useViewStore.getState().activeInspectorTab).toBe('project')
    // 不持久化：与 activeView 同族（每次打开默认「任务」更符合直觉）
    expect(localStorage.length).toBe(0)
  })

  it('selectedResourceId 默认 null，selectResource 选中／清空', () => {
    expect(useViewStore.getState().selectedResourceId).toBeNull()
    useViewStore.getState().selectResource('res-1')
    expect(useViewStore.getState().selectedResourceId).toBe('res-1')
    useViewStore.getState().selectResource(null)
    expect(useViewStore.getState().selectedResourceId).toBeNull()
  })

  it('selectResource 是纯 setter：不改 selectedTaskId（不触发换任务的复位）', () => {
    // 这条钉住「菜单新建资源只切 Tab + 选资源，不该牵动任务选中态」——
    // 否则 Inspector 的「换任务复位到任务 Tab」会被误触发、刚切到资源 Tab 又被弹回。
    useViewStore.getState().selectTask('task-9')
    useViewStore.getState().selectResource('res-1')
    expect(useViewStore.getState().selectedTaskId).toBe('task-9')
  })
})

// v0.7：视图从二值扩到四值。这条钉住「四值都被接受，且初值仍是 gantt」——
// 只要 setActiveView 还是旧的二值联合，类型层面就会先红。
describe('四个并列视图（v0.7）', () => {
  it('setActiveView 接受四值；初值仍是 gantt（不持久化）', () => {
    expect(useViewStore.getState().activeView).toBe('gantt')
    for (const view of ['outline', 'calendar', 'resources', 'gantt'] as const) {
      useViewStore.getState().setActiveView(view)
      expect(useViewStore.getState().activeView).toBe(view)
    }
  })

  it('__resetViewStoreForTests 把 activeView 复位成 gantt', () => {
    useViewStore.getState().setActiveView('resources')
    __resetViewStoreForTests()
    expect(useViewStore.getState().activeView).toBe('gantt')
  })
})

describe('资源树的折叠态（v0.7）', () => {
  it('toggleResourceCollapsed 增删同一个 Set；重复点同一个 id 来回切换', () => {
    const { toggleResourceCollapsed } = useViewStore.getState()
    expect(useViewStore.getState().collapsedResourceIds.has('resource_1')).toBe(false)
    toggleResourceCollapsed('resource_1')
    expect(useViewStore.getState().collapsedResourceIds.has('resource_1')).toBe(true)
    toggleResourceCollapsed('resource_1')
    expect(useViewStore.getState().collapsedResourceIds.has('resource_1')).toBe(false)
  })

  it('__resetViewStoreForTests 把折叠态清空（否则跨用例泄漏）', () => {
    useViewStore.getState().toggleResourceCollapsed('resource_9')
    __resetViewStoreForTests()
    expect(useViewStore.getState().collapsedResourceIds.size).toBe(0)
  })
})

describe('normalizeColumnWidths', () => {
  it('过滤不认识的 key', () => {
    expect(normalizeColumnWidths({ title: 300, 'ghost-column': 100 })).toEqual({ title: 300 })
  })

  it('**认识但禁用**的 key 保留 —— 与 visibleColumns 的口径刻意不同', () => {
    // acwp 本版禁用（依赖「实际成本录入」，无数据源）。它出现在 visibleColumns
    // 里会卡住一个关不掉的空列，所以那里必须过滤；而禁用列根本不渲染，一条宽度
    // 只是死数据 —— 零危害，留着还能在该列将来解禁时原地复活用户的偏好。
    // 别把两处「统一」成同一个口径，那是有意的分歧。
    expect(normalizeColumnWidths({ acwp: 200 })).toEqual({ acwp: 200 })
  })

  it('非有限数被丢弃（NaN / Infinity / 字符串 / null）', () => {
    // 它们会让 `flex: 0 0 NaNpx` 成为无效值，整列宽度塌回 auto
    expect(
      normalizeColumnWidths({ title: NaN, start: Infinity, finish: '300', duration: null }),
    ).toEqual({})
  })

  it('越界值被 clamp', () => {
    expect(normalizeColumnWidths({ start: 5, title: 5, finish: 99999 })).toEqual({
      start: COLUMN_WIDTH_MIN,
      title: TITLE_COLUMN_WIDTH_MIN,
      finish: COLUMN_WIDTH_MAX,
    })
  })

  it('非对象输入退回空表而不是抛错', () => {
    expect(normalizeColumnWidths(null)).toEqual({})
    expect(normalizeColumnWidths('title')).toEqual({})
    expect(normalizeColumnWidths([1, 2])).toEqual({})
  })
})

describe('loadColumnWidths', () => {
  it('没有存档时是空表', () => {
    expect(loadColumnWidths()).toEqual({})
  })

  it('非法 JSON 退回空表，绝不因此崩溃', () => {
    localStorage.setItem(OUTLINE_COLUMN_WIDTHS_STORAGE_KEY, '{oops')
    expect(loadColumnWidths()).toEqual({})
  })

  it('读到存档时按存档来，且经过归一化（未知 key 丢弃、越界值 clamp）', () => {
    localStorage.setItem(
      OUTLINE_COLUMN_WIDTHS_STORAGE_KEY,
      JSON.stringify({ start: 140, 'ghost-column': 300, finish: 99999 }),
    )
    expect(loadColumnWidths()).toEqual({ start: 140, finish: COLUMN_WIDTH_MAX })
  })
})

describe('viewStore 的列宽（columnWidths）', () => {
  it('默认空 —— 没拖过的列用 COLUMN_META 的默认宽', () => {
    expect(useViewStore.getState().columnWidths).toEqual({})
  })

  it('setColumnWidth 写入并 clamp', () => {
    useViewStore.getState().setColumnWidth('start', 140)
    expect(useViewStore.getState().columnWidths).toEqual({ start: 140 })

    useViewStore.getState().setColumnWidth('start', 5)
    expect(useViewStore.getState().columnWidths.start).toBe(COLUMN_WIDTH_MIN)

    useViewStore.getState().setColumnWidth('title', 5)
    expect(useViewStore.getState().columnWidths.title).toBe(TITLE_COLUMN_WIDTH_MIN)
  })

  it('resetColumnWidth 删除 key —— 是删除，不是写回默认宽', () => {
    // 这条钉住「复位」的语义：title 的 flex 来自 COLUMN_META 的默认值，覆盖值
    // 一删 flex 就回来了（见 applyColumnWidths）。若实现写成
    // `setColumnWidth(key, 默认宽)`，title 会变成固定 240px 的刚性列 ——
    // 下面的 `in` 断言会红。
    useViewStore.getState().setColumnWidth('title', 300)
    expect('title' in useViewStore.getState().columnWidths).toBe(true)

    useViewStore.getState().resetColumnWidth('title')
    expect('title' in useViewStore.getState().columnWidths).toBe(false)
  })

  it('拖拽中的连续写入只落盘一次（debounce 200ms）', () => {
    vi.useFakeTimers()
    try {
      const { setColumnWidth } = useViewStore.getState()
      setColumnWidth('start', 100)
      setColumnWidth('start', 110)
      setColumnWidth('start', 120)

      // 拖拽进行中：一次都没落盘
      expect(localStorage.getItem(OUTLINE_COLUMN_WIDTHS_STORAGE_KEY)).toBeNull()

      vi.advanceTimersByTime(COLUMN_WIDTHS_PERSIST_DEBOUNCE_MS)

      expect(
        JSON.parse(localStorage.getItem(OUTLINE_COLUMN_WIDTHS_STORAGE_KEY)!),
      ).toEqual({ start: 120 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('__resetViewStoreForTests 清空列宽并取消挂起的落盘（否则跨用例泄漏）', () => {
    vi.useFakeTimers()
    try {
      useViewStore.getState().setColumnWidth('start', 200)
      __resetViewStoreForTests()
      expect(useViewStore.getState().columnWidths).toEqual({})

      // 挂起的定时器若没被取消，会在下一个用例里写进 localStorage
      vi.advanceTimersByTime(COLUMN_WIDTHS_PERSIST_DEBOUNCE_MS)
      expect(localStorage.getItem(OUTLINE_COLUMN_WIDTHS_STORAGE_KEY)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

// v1.1：连续缩放 —— dayWidth 成为唯一事实源，zoom 枚举删除。
describe('dayWidth 单一事实源（连续缩放）', () => {
  it('默认 dayWidth = 32；预设表就是 32 / 12 / 4', () => {
    expect(useViewStore.getState().dayWidth).toBe(32)
    expect(DAY_WIDTH_PRESETS).toEqual({ day: 32, week: 12, month: 4 })
  })

  it('zoom / setZoom / ZoomLevel 已彻底移除（状态上没有这两个键）', () => {
    const state = useViewStore.getState() as unknown as Record<string, unknown>
    expect('zoom' in state).toBe(false)
    expect('setZoom' in state).toBe(false)
  })

  it('presetOfDayWidth：命中三预设、连续值不命中、非有限数不命中', () => {
    expect(presetOfDayWidth(32)).toBe('day')
    expect(presetOfDayWidth(12)).toBe('week')
    expect(presetOfDayWidth(4)).toBe('month')
    expect(presetOfDayWidth(31.9)).toBeNull()
    expect(presetOfDayWidth(2)).toBeNull()
    expect(presetOfDayWidth(256)).toBeNull()
    expect(presetOfDayWidth(NaN)).toBeNull()
    expect(presetOfDayWidth(Infinity)).toBeNull()
  })

  it('presetOfDayWidth 用 1e-9 表示容差，但不吞掉邻近的连续值', () => {
    expect(presetOfDayWidth(32 + 1e-10)).toBe('day')
    expect(presetOfDayWidth(32 + 1e-8)).toBeNull()
    expect(presetOfDayWidth(12 - 1e-10)).toBe('week')
  })

  it('setDayWidth clamp 到 [DAY_WIDTH_MIN, DAY_WIDTH_MAX]', () => {
    useViewStore.getState().setDayWidth(1000)
    expect(useViewStore.getState().dayWidth).toBe(DAY_WIDTH_MAX)
    useViewStore.getState().setDayWidth(0)
    expect(useViewStore.getState().dayWidth).toBe(DAY_WIDTH_MIN)
    useViewStore.getState().setDayWidth(20)
    expect(useViewStore.getState().dayWidth).toBe(20)
  })

  it('setDayWidth 对 NaN / ±Infinity 是 no-op（不写入，也不静默跳回默认值）', () => {
    useViewStore.getState().setDayWidth(20)
    useViewStore.getState().setDayWidth(NaN)
    expect(useViewStore.getState().dayWidth).toBe(20)
    useViewStore.getState().setDayWidth(Infinity)
    expect(useViewStore.getState().dayWidth).toBe(20)
  })

  it('__resetViewStoreForTests 把 dayWidth 复位到 32', () => {
    useViewStore.getState().setDayWidth(100)
    __resetViewStoreForTests()
    expect(useViewStore.getState().dayWidth).toBe(32)
  })
})

// v?.x：选中模型从单值扩成「锚点 + 集合」。锚点保留原语义（右栏/拖拽仍读它），
// 集合是新增的全集。这三条不变式是后面所有交互的地基。
describe('viewStore 的选中集合（多选）', () => {
  it('selectTask 同时写锚点与集合（单选 = 长度 1）', () => {
    useViewStore.getState().selectTask('t1')
    expect(useViewStore.getState().selectedTaskId).toBe('t1')
    expect(useViewStore.getState().selectedTaskIds).toEqual(['t1'])

    useViewStore.getState().selectTask(null)
    expect(useViewStore.getState().selectedTaskId).toBeNull()
    expect(useViewStore.getState().selectedTaskIds).toEqual([])
  })

  it('setTaskSelection 去重；缺省 anchor 取集合末元素', () => {
    useViewStore.getState().setTaskSelection(['t1', 't2', 't1'])
    expect(useViewStore.getState().selectedTaskIds).toEqual(['t1', 't2'])
    expect(useViewStore.getState().selectedTaskId).toBe('t2')
  })

  it('anchor 不在集合里时回落到末元素；空集合清空锚点', () => {
    useViewStore.getState().setTaskSelection(['t1', 't2'], 'ghost')
    expect(useViewStore.getState().selectedTaskId).toBe('t2')

    useViewStore.getState().setTaskSelection([], 't1')
    expect(useViewStore.getState().selectedTaskId).toBeNull()
    expect(useViewStore.getState().selectedTaskIds).toEqual([])
  })

  it('anchor 在集合里时被保留（Shift 扩选不动锚点）', () => {
    useViewStore.getState().setTaskSelection(['t1', 't2', 't3'], 't1')
    expect(useViewStore.getState().selectedTaskId).toBe('t1')
    expect(useViewStore.getState().selectedTaskIds).toEqual(['t1', 't2', 't3'])
  })

  it('clearTaskMultiSelect 收敛到只含锚点，且不换锚点', () => {
    useViewStore.getState().setTaskSelection(['t1', 't2', 't3'], 't2')
    useViewStore.getState().clearTaskMultiSelect()
    expect(useViewStore.getState().selectedTaskIds).toEqual(['t2'])
    expect(useViewStore.getState().selectedTaskId).toBe('t2')
  })

  it('资源侧同构：selectResource 同步集合；setResourceSelection 归一化', () => {
    useViewStore.getState().selectResource('r1')
    expect(useViewStore.getState().selectedResourceIds).toEqual(['r1'])

    useViewStore.getState().setResourceSelection(['r1', 'r2', 'r2'])
    expect(useViewStore.getState().selectedResourceIds).toEqual(['r1', 'r2'])
    expect(useViewStore.getState().selectedResourceId).toBe('r2')

    useViewStore.getState().clearResourceMultiSelect()
    expect(useViewStore.getState().selectedResourceIds).toEqual(['r2'])
  })

  it('__resetViewStoreForTests 把两个集合清空（否则跨用例泄漏）', () => {
    useViewStore.getState().setTaskSelection(['t1', 't2'])
    useViewStore.getState().setResourceSelection(['r1', 'r2'])
    __resetViewStoreForTests()
    expect(useViewStore.getState().selectedTaskIds).toEqual([])
    expect(useViewStore.getState().selectedResourceIds).toEqual([])
    expect(useViewStore.getState().selectedTaskId).toBeNull()
    expect(useViewStore.getState().selectedResourceId).toBeNull()
  })
})

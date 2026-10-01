import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_VISIBLE_COLUMNS } from './columnKeys'
import {
  OUTLINE_COLUMNS_STORAGE_KEY,
  loadVisibleColumns,
  normalizeVisibleColumns,
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

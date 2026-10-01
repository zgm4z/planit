import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_VISIBLE_COLUMNS } from '../ui/outlineColumns'
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
    const { toggleColumn } = useViewStore.getState()
    toggleColumn('progress')
    expect(useViewStore.getState().visibleColumns).toContain('progress')

    toggleColumn('progress')
    expect(useViewStore.getState().visibleColumns).not.toContain('progress')
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

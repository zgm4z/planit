import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import type { VirtualItem } from '@tanstack/react-virtual'

import zhCN from '../../i18n/locales/zh-CN.json'
import enUS from '../../i18n/locales/en-US.json'
import jaJP from '../../i18n/locales/ja-JP.json'
import { initCommands, __resetRegistryForTests } from '../../commands/registry'
import {
  createAssignment,
  createProject,
  createResource,
  createTask,
  __resetIdCounterForTests,
} from '../../domain/model/factories'
import type { Project } from '../../domain/model/types'
import { solve } from '../../domain/scheduler'
import { useProjectStore } from '../../store/projectStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useViewStore, __resetViewStoreForTests } from '../../store/viewStore'
import { ROW_HEIGHT } from '../shared/useSharedVirtualizer'
import { flattenResourceRows } from '../shared/flattenResources'
import { createScale } from '../gantt/timeline'
import { ResourceView } from './ResourceView'
import i18n from '../../i18n'

/** 手造虚拟项：绕过虚拟化器（jsdom 里没有布局），每行一条，位置可预测 */
function virtualItems(count: number): VirtualItem[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    key: index,
    start: index * ROW_HEIGHT,
    size: ROW_HEIGHT,
    end: (index + 1) * ROW_HEIGHT,
    lane: 0,
  }))
}

/** 一个组 + 两名成员；t1 分给「张三」（2 天），t2 分给张三（1 天） */
function fixture(): Project {
  __resetIdCounterForTests()
  const project = createProject('资源', '2026-03-02')
  const group = createResource({ name: '后端', kind: 'group' })
  const alice = createResource({ name: '张三', parentId: group.id })
  const bob = createResource({ name: '李四', parentId: group.id })
  for (const r of [group, alice, bob]) project.resources[r.id] = r

  const t1 = createTask({ name: '写文档', duration: 2 })
  const t2 = createTask({ name: '评审', duration: 1 })
  for (const t of [t1, t2]) {
    project.tasks[t.id] = t
    project.rootIds.push(t.id)
  }
  const a1 = createAssignment({ taskId: t1.id, resourceId: alice.id, units: 1 })
  const a2 = createAssignment({ taskId: t2.id, resourceId: alice.id, units: 1 })
  project.assignments[a1.id] = a1
  project.assignments[a2.id] = a2
  return project
}

/**
 * 测试夹具：`rows` 的派生**接到 store 上** —— 与 Task 3 里 ProjectView 的做法一致
 * （它订阅 `collapsedResourceIds`，折叠后据此重算 `rows` 再传进来）。
 *
 * 计划原文在 `render()` **之前**把 `rows` 算好当静态 prop 传入，于是点折叠按钮改的
 * 只是 store、props 不会变、组件不重渲 —— 「折叠组 → 子树行消失」这条断言无论如何
 * 都不会通过（实测：张三仍在 DOM 里）。资源视图本身是纯展示组件（rows 由父级给出，
 * 见 spec §7），夹具必须补上「订阅 → 重算 → 重渲」这一段，断言才测得到真行为。
 */
function ViewHarness({ project }: { project: Project }) {
  const collapsedResourceIds = useViewStore((state) => state.collapsedResourceIds)
  const rows = flattenResourceRows(project, collapsedResourceIds)
  return (
    <MantineProvider>
      <ResourceView
        project={project}
        rows={rows}
        virtualItems={virtualItems(rows.length)}
        schedules={useScheduleStore.getState().result.schedules}
        leveling={useScheduleStore.getState().result.leveling}
        scale={createScale(project.startDate, 32)}
        totalDays={60}
      />
    </MantineProvider>
  )
}

function renderView(project: Project) {
  return render(<ViewHarness project={project} />)
}

beforeEach(async () => {
  __resetRegistryForTests()
  initCommands()
  __resetIdCounterForTests()
  await i18n.changeLanguage('zh-CN')
  __resetViewStoreForTests()
})

describe('资源视图（视图 B）', () => {
  it('按 parentId 展开树：组的行在前，成员缩进；行的 data-testid 序列等于前序', () => {
    const project = fixture()
    useProjectStore.setState({ project, undoStack: [], redoStack: [], lastError: null })
    useScheduleStore.setState({ result: solve(project), error: null })
    renderView(project)

    const rows = screen.getAllByTestId(/^resource-row-/).map((el) => el.getAttribute('data-testid'))
    const ids = flattenResourceRows(project, new Set()).map((r) => `resource-row-${r.resourceId}`)
    expect(rows).toEqual(ids)
    // 缩进的硬证据：成员名单元格内层的 padding-left（内联样式）> 组名的
    const group = Object.values(project.resources).find((r) => r.name === '后端')!
    const alice = Object.values(project.resources).find((r) => r.name === '张三')!
    const pad = (id: string) =>
      parseFloat(
        (screen.getByTestId(`resource-cell-name-${id}`).firstElementChild as HTMLElement).style
          .paddingLeft || '0',
      )
    expect(pad(alice.id)).toBeGreaterThan(pad(group.id))
  })

  it('折叠组 → 它的子树行消失', () => {
    const project = fixture()
    useProjectStore.setState({ project, undoStack: [], redoStack: [], lastError: null })
    useScheduleStore.setState({ result: solve(project), error: null })
    const group = Object.values(project.resources).find((r) => r.name === '后端')!
    renderView(project)

    fireEvent.click(within(screen.getByTestId(`resource-row-${group.id}`)).getByRole('button'))
    expect(screen.queryByText('张三')).not.toBeInTheDocument()
  })

  it('点一个资源 → viewStore 选中它，且 Inspector 切到「资源」Tab', () => {
    const project = fixture()
    useProjectStore.setState({ project, undoStack: [], redoStack: [], lastError: null })
    useScheduleStore.setState({ result: solve(project), error: null })
    const alice = Object.values(project.resources).find((r) => r.name === '张三')!
    renderView(project)

    fireEvent.click(screen.getByTestId(`resource-row-${alice.id}`))
    expect(useViewStore.getState().selectedResourceId).toBe(alice.id)
    expect(useViewStore.getState().activeInspectorTab).toBe('resource')
  })

  it('主区只画该资源的分配条（条数 = 它的 assignment 数），不画别人的', () => {
    const project = fixture()
    useProjectStore.setState({ project, undoStack: [], redoStack: [], lastError: null })
    useScheduleStore.setState({ result: solve(project), error: null })
    const alice = Object.values(project.resources).find((r) => r.name === '张三')!
    const t1 = Object.values(project.tasks).find((t) => t.name === '写文档')!
    const t2 = Object.values(project.tasks).find((t) => t.name === '评审')!
    useViewStore.setState({ selectedResourceId: alice.id })
    renderView(project)

    expect(screen.getAllByTestId(/^resource-bar-/)).toHaveLength(2) // 张三有 2 条分配
    expect(screen.getByTestId(`resource-bar-${t1.id}`)).toBeInTheDocument()
    expect(screen.getByTestId(`resource-bar-${t2.id}`)).toBeInTheDocument()
  })

  it('没有任何资源 → 空态文字 + 新建按钮（不是空白）', () => {
    const project = createProject('空资源', '2026-03-02')
    useProjectStore.setState({ project, undoStack: [], redoStack: [], lastError: null })
    useScheduleStore.setState({ result: solve(project), error: null })
    renderView(project)
    expect(screen.getByText('还没有资源。')).toBeInTheDocument()
  })
})

/** 三语叶子键集合相等 —— 与 inspectorGroups.test.ts / outlineColumns.test.ts 同款守卫 */
function leafKeys(node: unknown, prefix = ''): string[] {
  if (node === null || typeof node !== 'object') return [prefix]
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leafKeys(value, prefix ? `${prefix}.${key}` : key),
  )
}

describe('resourceView 块的三语叶子键集合', () => {
  it('zh / en / ja 完全相等（缺一个翻译就红）', () => {
    const zh = leafKeys(zhCN.resourceView, 'resourceView').sort()
    expect(leafKeys(enUS.resourceView, 'resourceView').sort()).toEqual(zh)
    expect(leafKeys(jaJP.resourceView, 'resourceView').sort()).toEqual(zh)
  })
})

import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import type { VirtualItem } from '@tanstack/react-virtual'

import { initCommands, __resetRegistryForTests } from '../commands/registry'
import { createProject, createTask, __resetIdCounterForTests } from '../domain/model/factories'
import type { ComputedSchedule, Project } from '../domain/model/types'
import { flattenVisibleRows } from './flattenRows'
import { GANTT_OUTLINE_COLUMNS, OUTLINE_COLUMNS } from './outlineColumns'
import { OutlineTree } from './OutlineTree'
import { ROW_HEIGHT } from './useSharedVirtualizer'
import { useProjectStore } from '../store/projectStore'
import i18n from '../i18n'

let project: Project
let parentId: string
let childId: string

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

function schedule(start: string, finish: string): ComputedSchedule {
  return {
    earlyStart: start,
    earlyFinish: finish,
    lateStart: start,
    lateFinish: finish,
    scheduledStart: start,
    scheduledFinish: finish,
    totalSlack: 0,
    freeSlack: 0,
    isCritical: true,
  }
}

function renderTree(columns = GANTT_OUTLINE_COLUMNS, schedules: Record<string, ComputedSchedule> = {}) {
  const rows = flattenVisibleRows(project, new Set())
  return render(
    <MantineProvider>
      <OutlineTree
        project={project}
        rows={rows}
        virtualItems={virtualItems(rows.length)}
        schedules={schedules}
        columns={columns}
        selectedTaskId={null}
        onSelect={() => {}}
        onToggleCollapse={() => {}}
      />
    </MantineProvider>,
  )
}

beforeEach(async () => {
  __resetRegistryForTests()
  initCommands()
  __resetIdCounterForTests()
  await i18n.changeLanguage('zh-CN')

  project = createProject('测试', '2026-03-02')
  const parent = createTask({ name: '阶段一', duration: 2 })
  const child = createTask({ name: '写文档', duration: 3 })
  project.tasks[parent.id] = parent
  project.tasks[child.id] = { ...child, parentId: parent.id }
  project.tasks[parent.id].childIds = [child.id]
  project.tasks[parent.id].kind = 'group'
  project.rootIds = [parent.id]
  parentId = parent.id
  childId = child.id

  useProjectStore.setState({ project, undoStack: [], redoStack: [], lastError: null })
})

describe('OutlineTree', () => {
  it('每个可见列出且只出一个单元格（列多时 row 不重复）', () => {
    renderTree()

    // 两行 × 两列
    expect(screen.getAllByTestId(/^outline-row-/)).toHaveLength(2)
    expect(screen.getByTestId(`outline-cell-kind-${childId}`)).toBeInTheDocument()
    expect(screen.getByTestId(`outline-cell-title-${childId}`)).toBeInTheDocument()
    // 没传的列不出单元格
    expect(screen.queryByTestId(`outline-cell-note-${childId}`)).not.toBeInTheDocument()
  })

  it('大纲视图传全量列时，短列名各自成格', () => {
    renderTree(OUTLINE_COLUMNS.filter((c) => c.enabled))

    expect(screen.getByTestId(`outline-cell-note-${childId}`)).toBeInTheDocument()
    expect(screen.getByTestId(`outline-cell-id-${childId}`)).toBeInTheDocument()
    expect(screen.getByTestId(`outline-cell-progress-${childId}`)).toBeInTheDocument()
  })

  it('kind 列按任务类型出图标：分组 ▤ / 里程碑 ◆ / 任务 ▪', () => {
    renderTree()
    // 分组**不是** ▾ —— 那是 title 列折叠按钮的字形，两者重复正是缺陷 1
    expect(screen.getByTestId(`outline-cell-kind-${parentId}`)).toHaveTextContent('▤')
    expect(screen.getByTestId(`outline-cell-kind-${childId}`)).toHaveTextContent('▪')
  })

  it('摘要行只出一个三角，且那个三角在可点的折叠按钮里（缺陷 1 回归）', () => {
    renderTree()

    const row = screen.getByTestId(`outline-row-${parentId}`)
    // kind 列的分组图标若仍是 ▾，会和 title 列的折叠按钮并排凑出两个三角
    const triangles = within(row).queryAllByText(/[▾▸]/)
    expect(triangles).toHaveLength(1)
    // 留下的那个必须是可点的折叠按钮（e2e 依赖「行内唯一的 button」）
    expect(triangles[0].closest('button')).not.toBeNull()
  })

  it('title 单元格带折叠按钮，点击回调带任务 id', async () => {
    const onToggleCollapse = vi.fn()
    const rows = flattenVisibleRows(project, new Set())
    render(
      <MantineProvider>
        <OutlineTree
          project={project}
          rows={rows}
          virtualItems={virtualItems(rows.length)}
          schedules={{}}
          columns={GANTT_OUTLINE_COLUMNS}
          selectedTaskId={null}
          onSelect={() => {}}
          onToggleCollapse={onToggleCollapse}
        />
      </MantineProvider>,
    )

    const button = screen.getByTestId(`outline-row-${parentId}`).querySelector('button')!
    fireEvent.click(button)
    expect(onToggleCollapse).toHaveBeenCalledWith(parentId)
  })

  it('日期列读排期（scheduled*），工期列按「N 天」渲染、里程碑显示破折号', () => {
    const milestone = createTask({ name: 'M', kind: 'milestone' })
    project.tasks[milestone.id] = milestone
    project.rootIds.push(milestone.id)

    renderTree(
      OUTLINE_COLUMNS.filter((c) => ['kind', 'title', 'start', 'finish', 'duration'].includes(c.key)),
      {
        [childId]: schedule('2026-03-04', '2026-03-06'),
        [milestone.id]: schedule('2026-03-04', '2026-03-04'),
      },
    )

    expect(screen.getByTestId(`outline-cell-start-${childId}`)).toHaveTextContent('2026-03-04')
    expect(screen.getByTestId(`outline-cell-finish-${childId}`)).toHaveTextContent('2026-03-06')
    expect(screen.getByTestId(`outline-cell-duration-${childId}`)).toHaveTextContent('3 天')
    expect(screen.getByTestId(`outline-cell-duration-${milestone.id}`)).toHaveTextContent('—')
  })

  it('备注列：双击进编辑态，回车提交 task.setNote', async () => {
    const user = userEvent.setup()
    renderTree(OUTLINE_COLUMNS.filter((c) => c.key === 'title' || c.key === 'note'))

    await user.dblClick(screen.getByTestId(`outline-note-${childId}`))
    const input = screen.getByTestId(`outline-note-input-${childId}`)
    await user.type(input, '这是一条备注{Enter}')

    expect(useProjectStore.getState().project!.tasks[childId].note).toBe('这是一条备注')
    // 提交后回到只读态
    expect(screen.getByTestId(`outline-note-${childId}`)).toBeInTheDocument()
  })

  it('备注列：Escape 放弃编辑，store 不变', async () => {
    const user = userEvent.setup()
    renderTree(OUTLINE_COLUMNS.filter((c) => c.key === 'title' || c.key === 'note'))

    await user.dblClick(screen.getByTestId(`outline-note-${childId}`))
    await user.type(screen.getByTestId(`outline-note-input-${childId}`), '不要的{Escape}')

    expect(useProjectStore.getState().project!.tasks[childId].note).toBe('')
  })
})

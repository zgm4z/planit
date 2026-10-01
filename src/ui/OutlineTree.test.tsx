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
        efforts={{}}
        costs={{}}
        earnedValues={{}}
        baselineDiffs={{}}
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

  useProjectStore.setState({
    project,
    undoStack: [],
    redoStack: [],
    lastError: null,
    // 合并屏障是跨用例的全局状态：漏清会让下一条 dispatch 强制新开记录，
    // 把「两次编辑是否合并」这条断言变成假阳性 / 假阴性
    coalesceBarrier: false,
  })
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
          efforts={{}}
          costs={{}}
          earnedValues={{}}
          baselineDiffs={{}}
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

  it('备注列：失焦即提交（不必按回车）', async () => {
    const user = userEvent.setup()
    renderTree(OUTLINE_COLUMNS.filter((c) => c.key === 'title' || c.key === 'note'))

    await user.dblClick(screen.getByTestId(`outline-note-${childId}`))
    const input = screen.getByTestId(`outline-note-input-${childId}`)
    await user.type(input, '失焦就提交')
    fireEvent.blur(input)

    expect(useProjectStore.getState().project!.tasks[childId].note).toBe('失焦就提交')
    // 提交后回到只读态
    expect(screen.getByTestId(`outline-note-${childId}`)).toBeInTheDocument()
  })

  it('备注列：两次连续编辑各成一条撤销记录（中间无其它命令也不塌缩）', async () => {
    const user = userEvent.setup()
    renderTree(OUTLINE_COLUMNS.filter((c) => c.key === 'title' || c.key === 'note'))

    // 第一次编辑：双击 → 输入 → **失焦**提交（顺带覆盖失焦这条路径）
    await user.dblClick(screen.getByTestId(`outline-note-${childId}`))
    await user.type(screen.getByTestId(`outline-note-input-${childId}`), '备注①')
    fireEvent.blur(screen.getByTestId(`outline-note-input-${childId}`))

    // 第二次编辑**同一个任务** —— 中间没有任何其它命令（连选中都没动过）。
    // 两次 dispatch 的 coalesceKey 相同，若编辑开始时没打断合并，就会塌缩成一条。
    await user.dblClick(screen.getByTestId(`outline-note-${childId}`))
    await user.type(screen.getByTestId(`outline-note-input-${childId}`), '又改了{Enter}')

    // 两次编辑各留一条撤销记录 —— 这才是本用例的判据（笔记内容仅作旁证；
    // renderTree 传的是静态 project prop，编辑框初值取自那份不随 store 更新的快照）。
    // 塌缩成一条时，一次 Ctrl+Z 会把两次编辑一起退回
    // （这正是 projectStore 的 coalesceBarrier 明文要防的 bug）。
    expect(useProjectStore.getState().undoStack).toHaveLength(2)
    expect(useProjectStore.getState().project!.tasks[childId].note).toBe('又改了')
  })

  it('备注列：Escape 放弃编辑，store 不变', async () => {
    const user = userEvent.setup()
    renderTree(OUTLINE_COLUMNS.filter((c) => c.key === 'title' || c.key === 'note'))

    await user.dblClick(screen.getByTestId(`outline-note-${childId}`))
    await user.type(screen.getByTestId(`outline-note-input-${childId}`), '不要的{Escape}')

    expect(useProjectStore.getState().project!.tasks[childId].note).toBe('')
  })

  it('备注单元格按 task.id 挂 key：行位不变、底层任务换 id 时退出编辑态（草稿不跨任务泄漏）', async () => {
    const user = userEvent.setup()
    const columns = OUTLINE_COLUMNS.filter((c) => c.key === 'title' || c.key === 'note')

    const tree = (p: Project) => {
      const rows = flattenVisibleRows(p, new Set())
      return (
        <MantineProvider>
          <OutlineTree
            project={p}
            rows={rows}
            virtualItems={virtualItems(rows.length)}
            schedules={{}}
            efforts={{}}
            costs={{}}
            earnedValues={{}}
            baselineDiffs={{}}
            columns={columns}
            selectedTaskId={null}
            onSelect={() => {}}
            onToggleCollapse={() => {}}
          />
        </MantineProvider>
      )
    }

    // 第二份 project：结构与第一份**同形**（一个 group 根 + 一个子任务，仍是 2 行），
    // 但每个任务的 id 都不同 —— 这样行**下标**不变、底层任务却换了。
    const next = createProject('测试2', '2026-03-02')
    const nextParent = createTask({ name: '阶段二', duration: 2 })
    const nextChild = createTask({ name: '另一个', duration: 3 })
    next.tasks[nextParent.id] = nextParent
    next.tasks[nextChild.id] = { ...nextChild, parentId: nextParent.id }
    next.tasks[nextParent.id].childIds = [nextChild.id]
    next.tasks[nextParent.id].kind = 'group'
    next.rootIds = [nextParent.id]

    const { rerender } = render(tree(project))

    // 下标 0 处（parentId 那一行）进入编辑态，留下一条旧任务的草稿。
    await user.dblClick(screen.getByTestId(`outline-note-${parentId}`))
    await user.type(screen.getByTestId(`outline-note-input-${parentId}`), '旧任务的草稿')
    expect(screen.getByTestId(`outline-note-input-${parentId}`)).toHaveValue('旧任务的草稿')

    // 行容器用 `key={item.key}`（= 行下标），所以这次 rerender 会**复用**下标 0 处的
    // 组件实例。若 NoteCell 没有 `key={task.id}`，编辑态与草稿会跟着实例一起被复用
    // —— 于是下标 0 处仍是「编辑中」、draft 仍是「旧任务的草稿」，只是 task 变成了
    // nextParent；此时失焦会用 nextParent.id 提交旧任务的文字（写错数据）。
    rerender(tree(next))

    // 有 key={task.id} 时 NoteCell 被强制重挂载：退出编辑态，只剩只读的备注单元格。
    expect(screen.queryByTestId(`outline-note-input-${nextParent.id}`)).not.toBeInTheDocument()
    expect(screen.getByTestId(`outline-note-${nextParent.id}`)).toBeInTheDocument()
  })
})

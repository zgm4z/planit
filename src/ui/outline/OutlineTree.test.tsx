import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import type { VirtualItem } from '@tanstack/react-virtual'

import { initCommands, __resetRegistryForTests } from '../../commands/registry'
import { createProject, createTask, __resetIdCounterForTests } from '../../domain/model/factories'
import type { ComputedSchedule, Project } from '../../domain/model/types'
import { flattenVisibleRows } from '../shared/flattenRows'
import { GANTT_OUTLINE_COLUMNS, OUTLINE_COLUMNS } from './outlineColumns'
import { OutlineTree } from './OutlineTree'
import { ROW_HEIGHT } from '../shared/useSharedVirtualizer'
import styles from '../styles/ProjectView.module.scss'
import { useProjectStore } from '../../store/projectStore'
import { __resetViewStoreForTests, useViewStore } from '../../store/viewStore'
import i18n from '../../i18n'

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
        selectedTaskIds={new Set()}
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
  __resetViewStoreForTests()
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
          selectedTaskIds={new Set()}
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

  it('数字与日期走 format.ts：成本千分位、工期带「天」、日期 YYYY-MM-DD', () => {
    const rows = flattenVisibleRows(project, new Set())
    render(
      <MantineProvider>
        <OutlineTree
          project={project}
          rows={rows}
          virtualItems={virtualItems(rows.length)}
          schedules={{ [childId]: schedule('2026-03-04', '2026-03-06') }}
          efforts={{}}
          costs={{ [childId]: { task: 1234, resource: 0, total: 1234 } }}
          earnedValues={{}}
          baselineDiffs={{}}
          columns={OUTLINE_COLUMNS.filter((c) =>
            ['title', 'start', 'duration', 'taskCost'].includes(c.key),
          )}
          selectedTaskIds={new Set()}
          selectedTaskId={null}
          onSelect={() => {}}
          onToggleCollapse={() => {}}
        />
      </MantineProvider>,
    )

    // §1.3：成本 0 位 + 千分位
    expect(screen.getByTestId(`outline-cell-taskCost-${childId}`)).toHaveTextContent('1,234')
    // 工期 0 位 + 「天」
    expect(screen.getByTestId(`outline-cell-duration-${childId}`)).toHaveTextContent('3 天')
    // 日期一律 YYYY-MM-DD（date 变体过 formatDate）
    expect(screen.getByTestId(`outline-cell-start-${childId}`)).toHaveTextContent('2026-03-04')
  })

  it('三种「空」视觉可分（§3.3）：真实 0 显示 0、算不出来弱化 —、无此概念也是 —', () => {
    const rows = flattenVisibleRows(project, new Set())
    render(
      <MantineProvider>
        <OutlineTree
          project={project}
          rows={rows}
          virtualItems={virtualItems(rows.length)}
          schedules={{ [childId]: schedule('2026-03-04', '2026-03-06') }}
          efforts={{}}
          costs={{}}
          // bcwp = 0 是**真实数据**（进度为 0）；bcws = null 是「算不出来」
          earnedValues={{ [childId]: { bac: 1000, ev: 0, pv: null, sv: null } }}
          baselineDiffs={{}}
          columns={OUTLINE_COLUMNS.filter((c) =>
            ['title', 'bcwp', 'bcws', 'duration'].includes(c.key),
          )}
          selectedTaskIds={new Set()}
          selectedTaskId={null}
          onSelect={() => {}}
          onToggleCollapse={() => {}}
        />
      </MantineProvider>,
    )

    // 真的是 0 → 显示 0（不是 —，也不是空白）
    expect(screen.getByTestId(`outline-cell-bcwp-${childId}`)).toHaveTextContent('0')
    // 算不出来（缺基准日）→ 弱化 `—` 而不是 0
    expect(screen.getByTestId(`outline-cell-bcws-${childId}`)).toHaveTextContent('—')
    expect(screen.getByTestId(`outline-cell-bcws-${childId}`)).not.toHaveTextContent('0')
    // 无此概念（摘要行的工期）→ 也是 `—`（§6：空单元格不是空白）
    expect(screen.getByTestId(`outline-cell-duration-${parentId}`)).toHaveTextContent('—')
  })

  it('空备注也渲染弱化的 —（整列为空时一眼可辨「还没填」而不是「坏了」）', () => {
    renderTree(OUTLINE_COLUMNS.filter((c) => ['title', 'note'].includes(c.key)))
    // 夹具里 child 的 note 为空串 → 只读态渲染 `—`
    expect(screen.getByTestId(`outline-note-${childId}`)).toHaveTextContent('—')
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
            selectedTaskIds={new Set()}
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

  it('数字列：双击 progress 输 150 回车 → clamp 到 100', async () => {
    const user = userEvent.setup()
    renderTree(
      OUTLINE_COLUMNS.filter((c) => c.key === 'title' || c.key === 'progress'),
      { [childId]: schedule('2026-03-04', '2026-03-06') },
    )

    await user.dblClick(screen.getByTestId(`outline-edit-progress-${childId}`))
    const input = screen.getByTestId(`outline-edit-input-progress-${childId}`)
    await user.clear(input)
    await user.type(input, '150{Enter}')

    expect(useProjectStore.getState().project!.tasks[childId].progress).toBe(100)
  })

  it('数字列：非法输入不提交、保留编辑态、撤销栈不增', async () => {
    const user = userEvent.setup()
    renderTree(
      OUTLINE_COLUMNS.filter((c) => c.key === 'title' || c.key === 'duration'),
      { [childId]: schedule('2026-03-04', '2026-03-06') },
    )

    await user.dblClick(screen.getByTestId(`outline-edit-duration-${childId}`))
    const input = screen.getByTestId(`outline-edit-input-duration-${childId}`)
    await user.clear(input)
    await user.type(input, 'abc')
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByTestId(`outline-edit-input-duration-${childId}`)).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(useProjectStore.getState().undoStack).toHaveLength(0)
  })

  it('日期列：双击 start 选日期回车 → task.moveTo，任务落 manual 且起点 = 所选日', async () => {
    const user = userEvent.setup()
    renderTree(
      OUTLINE_COLUMNS.filter((c) => ['title', 'start', 'finish'].includes(c.key)),
      { [childId]: schedule('2026-03-04', '2026-03-06') },
    )

    await user.dblClick(screen.getByTestId(`outline-edit-start-${childId}`))
    const input = screen.getByTestId(`outline-edit-input-start-${childId}`)
    await user.clear(input)
    await user.type(input, '2026-03-05')
    fireEvent.keyDown(input, { key: 'Enter' })

    const task = useProjectStore.getState().project!.tasks[childId]
    expect(task.scheduling.mode).toBe('manual')
    expect(task.scheduling.mode === 'manual' && task.scheduling.start).toBe('2026-03-05')
  })

  it('只读列：双击 id / kind 不进编辑态（无输入框）', async () => {
    const user = userEvent.setup()
    renderTree(OUTLINE_COLUMNS.filter((c) => ['title', 'id', 'kind'].includes(c.key)))

    await user.dblClick(screen.getByTestId(`outline-cell-id-${childId}`))
    await user.dblClick(screen.getByTestId(`outline-cell-kind-${childId}`))
    expect(screen.queryByTestId(`outline-edit-input-id-${childId}`)).not.toBeInTheDocument()
    expect(screen.queryByTestId(`outline-edit-input-kind-${childId}`)).not.toBeInTheDocument()
  })

  it('守卫：manual 任务的 duration、group 的 start 双击不进编辑态，且显示态有原因 title', async () => {
    const user = userEvent.setup()
    // renderTree 读的是**文件级的 project 变量**（不是 store）—— 就地把它换成含 manual 子任务的项目
    project = {
      ...project,
      tasks: {
        ...project.tasks,
        [childId]: {
          ...project.tasks[childId],
          scheduling: { mode: 'manual', start: '2026-03-04T09:00', finish: '2026-03-06T18:00' },
        },
      },
    }
    renderTree(
      OUTLINE_COLUMNS.filter((c) => ['title', 'start', 'duration'].includes(c.key)),
      { [childId]: schedule('2026-03-04', '2026-03-06'), [parentId]: schedule('2026-03-04', '2026-03-06') },
    )

    // manual 任务的工期列：无编辑器，显示态有原因
    await user.dblClick(screen.getByTestId(`outline-cell-duration-${childId}`))
    expect(screen.queryByTestId(`outline-edit-input-duration-${childId}`)).not.toBeInTheDocument()
    expect(
      within(screen.getByTestId(`outline-cell-duration-${childId}`)).getByTitle('手动排期的工期由区间决定，请改开始/结束日'),
    ).toBeInTheDocument()

    // group 的 start 列：理由「摘要任务的该字段由子任务汇总」
    expect(
      within(screen.getByTestId(`outline-cell-start-${parentId}`)).getByTitle('摘要任务的该字段由子任务汇总'),
    ).toBeInTheDocument()
  })

  it('撤销：改 A 的优先级再改 B 的优先级 → 两条记录，Ctrl 语义各一条', async () => {
    const user = userEvent.setup()
    renderTree(OUTLINE_COLUMNS.filter((c) => c.key === 'title' || c.key === 'priority'))

    await user.dblClick(screen.getByTestId(`outline-edit-priority-${parentId}`))
    const p1 = screen.getByTestId(`outline-edit-input-priority-${parentId}`)
    await user.clear(p1)
    await user.type(p1, '3{Enter}')

    await user.dblClick(screen.getByTestId(`outline-edit-priority-${childId}`))
    const p2 = screen.getByTestId(`outline-edit-input-priority-${childId}`)
    await user.clear(p2)
    await user.type(p2, '5{Enter}')

    expect(useProjectStore.getState().undoStack).toHaveLength(2)
    expect(useProjectStore.getState().project!.tasks[parentId].priority).toBe(3)
    expect(useProjectStore.getState().project!.tasks[childId].priority).toBe(5)

    useProjectStore.getState().undo()
    expect(useProjectStore.getState().project!.tasks[childId].priority).toBe(0)
    expect(useProjectStore.getState().project!.tasks[parentId].priority).toBe(3)
  })

  it('title：双击名称进改名、回车提交 task.rename；折叠三角仍可点（回归）', async () => {
    const user = userEvent.setup()
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
          selectedTaskIds={new Set()}
          selectedTaskId={null}
          onSelect={() => {}}
          onToggleCollapse={onToggleCollapse}
        />
      </MantineProvider>,
    )

    // 双击名称 → 改名
    await user.dblClick(screen.getByTestId(`outline-title-${childId}`))
    const input = screen.getByTestId(`outline-title-input-${childId}`)
    await user.clear(input)
    await user.type(input, '新名字{Enter}')
    expect(useProjectStore.getState().project!.tasks[childId].name).toBe('新名字')

    // 折叠三角仍然是可点的折叠按钮（双击名称不会吞掉三角的 click）
    fireEvent.click(screen.getByTestId(`outline-row-${parentId}`).querySelector('button')!)
    expect(onToggleCollapse).toHaveBeenCalledWith(parentId)
  })

  it('日期列：双击 finish 改结束端 → 起点不变、duration 按新区间重算', async () => {
    const user = userEvent.setup()
    renderTree(
      OUTLINE_COLUMNS.filter((c) => ['title', 'start', 'finish'].includes(c.key)),
      { [childId]: schedule('2026-03-04', '2026-03-06') },
    )

    await user.dblClick(screen.getByTestId(`outline-edit-finish-${childId}`))
    const input = screen.getByTestId(`outline-edit-input-finish-${childId}`)
    await user.clear(input)
    await user.type(input, '2026-03-05')
    fireEvent.keyDown(input, { key: 'Enter' })

    const task = useProjectStore.getState().project!.tasks[childId]
    expect(task.scheduling.mode).toBe('manual')
    // 起点不动，只有结束端变了
    expect(task.scheduling.mode === 'manual' && task.scheduling.start).toBe('2026-03-04')
    expect(task.scheduling.mode === 'manual' && task.scheduling.finish).toBe('2026-03-05')
    // duration 恒等于结果区间宽度：03-04..03-05 = 2 个工作日
    expect(task.duration).toBe(2)
  })
})

describe('OutlineTree 的多选修饰键', () => {
  it('行点击把 ctrl/meta/shift 透传给 onSelect', () => {
    const calls: { id: string; mods: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean } }[] = []
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
          selectedTaskIds={new Set()}
          selectedTaskId={null}
          onSelect={(id, mods) => calls.push({ id, mods })}
          onToggleCollapse={() => {}}
        />
      </MantineProvider>,
    )

    fireEvent.click(screen.getByTestId(`outline-row-${parentId}`), { ctrlKey: true })
    fireEvent.click(screen.getByTestId(`outline-row-${childId}`), { shiftKey: true })

    expect(calls[0]).toEqual({ id: parentId, mods: { ctrlKey: true, metaKey: false, shiftKey: false } })
    expect(calls[1]).toEqual({ id: childId, mods: { ctrlKey: false, metaKey: false, shiftKey: true } })
  })
})

describe('OutlineTree 的多选高亮', () => {
  const renderWithSelection = (selected: string[], anchor: string | null) => {
    const rows = flattenVisibleRows(project, new Set())
    return render(
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
          selectedTaskIds={new Set(selected)}
          selectedTaskId={anchor}
          onSelect={() => {}}
          onToggleCollapse={() => {}}
        />
      </MantineProvider>,
    )
  }

  it('集合里每一行都高亮；锚点另带 data-anchor（焦点）', () => {
    renderWithSelection([parentId, childId], parentId)

    const parentRow = screen.getByTestId(`outline-row-${parentId}`)
    const childRow = screen.getByTestId(`outline-row-${childId}`)
    expect(parentRow).toHaveAttribute('data-selected', 'true')
    expect(childRow).toHaveAttribute('data-selected', 'true')
    // 焦点（锚点）只有父行
    expect(parentRow).toHaveAttribute('data-anchor', 'true')
    expect(childRow).not.toHaveAttribute('data-anchor')
  })

  it('不在集合里的行不高亮（高亮判据是全集，不只是锚点）', () => {
    renderWithSelection([childId], childId)

    expect(screen.getByTestId(`outline-row-${parentId}`)).not.toHaveAttribute('data-selected')
    expect(screen.getByTestId(`outline-row-${childId}`)).toHaveAttribute('data-selected', 'true')
  })
})

describe('标题回车新建同级任务', () => {
  it('回车：提交改名 + 紧下方新建同级 + 选中并进入编辑', async () => {
    const user = userEvent.setup()
    renderTree()

    await user.dblClick(screen.getByTestId(`outline-title-${parentId}`))
    const input = screen.getByTestId(`outline-title-input-${parentId}`)
    await user.clear(input)
    await user.type(input, '改过的名字')
    await user.keyboard('{Enter}')

    const p = useProjectStore.getState().project!
    expect(p.tasks[parentId].name).toBe('改过的名字') // ① 改名已提交

    expect(p.rootIds).toHaveLength(2) // ② 新建了一条根任务
    const newId = p.rootIds[1]
    expect(newId).not.toBe(parentId)
    expect(p.tasks[newId].name).toBe('新任务') // 默认名（三语 outline.newTaskName）

    expect(useViewStore.getState().selectedTaskId).toBe(newId) // ③ 已选中
    expect(useViewStore.getState().editingTitleTaskId).toBe(newId) // ③ 已进入编辑
    expect(useProjectStore.getState().undoStack).toHaveLength(2) // 改名 + 新建，两条
  })

  it('标题清空后回车：不改名，但仍新建（只有一条撤销记录）', async () => {
    const user = userEvent.setup()
    renderTree()

    await user.dblClick(screen.getByTestId(`outline-title-${parentId}`))
    await user.clear(screen.getByTestId(`outline-title-input-${parentId}`))
    await user.keyboard('{Enter}')

    const p = useProjectStore.getState().project!
    expect(p.tasks[parentId].name).toBe('阶段一') // 原名保留
    expect(p.rootIds).toHaveLength(2) // 仍新建
    expect(useProjectStore.getState().undoStack).toHaveLength(1) // 只有「新建」一条
  })

  it('连续回车可连续新建（每次都插在上一条之后）', async () => {
    const user = userEvent.setup()
    renderTree()

    await user.dblClick(screen.getByTestId(`outline-title-${parentId}`))
    await user.keyboard('{Enter}') // 第一次：建第 2 条

    // rows 是静态传入的，新行不会自己出现 —— 把模块级 project 同步到 store 后重渲染。
    // 重渲染时那一行因 editingTitleTaskId 指向它而**已在编辑态**，直接回车即可。
    project = useProjectStore.getState().project!
    const first = project.rootIds[1]
    renderTree()
    const secondInput = screen.getByTestId(`outline-title-input-${first}`)
    await user.clear(secondInput) // 自动进入编辑时草稿已填默认名「新任务」
    await user.type(secondInput, '第二条')
    await user.keyboard('{Enter}')

    const p = useProjectStore.getState().project!
    expect(p.rootIds).toHaveLength(3)
    expect(p.tasks[p.rootIds[1]].name).toBe('第二条')
    expect(p.tasks[p.rootIds[2]].name).toBe('新任务')
  })

  it('editingTitleTaskId 指向某任务时，该行标题自动进入编辑态', () => {
    useViewStore.getState().beginTitleEdit(childId)
    renderTree()

    expect(screen.getByTestId(`outline-title-input-${childId}`)).toBeTruthy()
  })

  it('备注单元格回车不新建（只有标题那条路径会建）', async () => {
    const user = userEvent.setup()
    renderTree([...OUTLINE_COLUMNS])

    const before = useProjectStore.getState().project!.rootIds.length
    await user.dblClick(screen.getByTestId(`outline-note-${parentId}`))
    await user.type(screen.getByTestId(`outline-note-input-${parentId}`), 'abc')
    await user.keyboard('{Enter}')

    expect(useProjectStore.getState().project!.rootIds).toHaveLength(before)
  })
})

describe('OutlineTree 右键菜单容器（user-select 回归）', () => {
  it('容器带 ctxMenuHost，computed user-select 恢复为 text（不被 Mantine 的 none 吃掉）', () => {
    renderTree()

    // 容器 = TaskContextMenu 渲染的那层，是每行的**直接父节点**
    const host = screen.getByTestId(`outline-row-${childId}`).parentElement as HTMLElement
    expect(host).not.toBeNull()

    // ① 结构断言（任何环境都成立）：调用方把 ctxMenuHost 传进了容器
    expect(host.className).toContain(styles.ctxMenuHost)

    // ② 行为断言：Mantine 的 Menu.ContextMenu 会从**内联 style** 注入
    //    user-select:none（`use-context-menu-handlers`），.ctxMenuHost 的 `!important`
    //    规则把它盖回 text —— 保住「鼠标选中大纲行文字」的既有行为。
    expect(getComputedStyle(host).userSelect).toBe('text')
  })
})

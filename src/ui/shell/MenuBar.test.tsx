import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'

import { createProject, createTask, __resetIdCounterForTests } from '../../domain/model/factories'
import type { Project } from '../../domain/model/types'
import { initCommands, __resetRegistryForTests } from '../../commands/registry'
import { useProjectStore } from '../../store/projectStore'
import { useViewStore, __resetViewStoreForTests } from '../../store/viewStore'
import { MenuBar } from './MenuBar'
import i18n from '../../i18n'

/**
 * MenuBar 的单测。
 *
 * 浮层在 jsdom 里「不显形」（计算样式停在 display:none，见 Inspector.test.tsx 的注释），
 * 但**展开后 DOM 是真实挂载的** —— 因此用 fireEvent 打开菜单、再断言条目的
 * DOM 状态（disabled / 勾选 / 文案）是可行的。看得见与否由 e2e 验收。
 */

let project: Project
let ids: { parent: string; child1: string; child2: string }

/** 一个摘要任务 + 两个子任务：缩进 / 反缩进 / 折叠 都有可用材料。 */
function makeProject(): Project {
  const p = createProject('测试项目', '2026-03-02')
  const parent = createTask({ name: '父任务' })
  const child1 = createTask({ name: '子一', parentId: parent.id })
  const child2 = createTask({ name: '子二', parentId: parent.id })
  // createTask 造出来的是普通任务；有子任务后它才是摘要（真实流程里由 reconcileKind 完成）。
  parent.kind = 'group'
  parent.childIds = [child1.id, child2.id]
  p.tasks = { [parent.id]: parent, [child1.id]: child1, [child2.id]: child2 }
  p.rootIds = [parent.id]
  ids = { parent: parent.id, child1: child1.id, child2: child2.id }
  return p
}

function renderBar() {
  return render(
    <MantineProvider>
      <MenuBar />
    </MantineProvider>,
  )
}

/** 打开某个菜单并等它的下拉挂载（用该菜单里一定存在的条目作句柄）。 */
async function openMenu(id: string, itemTestId: string) {
  fireEvent.click(screen.getByTestId(`menu-${id}`))
  return screen.findByTestId(itemTestId)
}

beforeEach(async () => {
  __resetRegistryForTests()
  initCommands()
  __resetIdCounterForTests()
  await i18n.changeLanguage('zh-CN')
  __resetViewStoreForTests()
  project = makeProject()
  useProjectStore.setState({ project, undoStack: [], redoStack: [], lastError: null })
})

describe('MenuBar 的菜单标题', () => {
  it('渲染六个标题，从左到右是 文件 / 编辑 / 视图 / 任务 / 项目 / 资源', () => {
    renderBar()
    const labels = ['文件', '编辑', '视图', '任务', '项目', '资源']
    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('已展开时悬停其它标题即切换：旧菜单收起、新菜单出现', async () => {
    renderBar()
    await openMenu('file', 'menu-back-to-list')
    expect(screen.getByTestId('menu-back-to-list')).toBeInTheDocument()

    fireEvent.mouseEnter(screen.getByTestId('menu-edit'))

    await screen.findByTestId('undo')
    // 悬停切换是**跨菜单**的：文件的下拉必须已经收起（条目不再挂载）。
    // 用 waitFor 而不是立即断言 —— 关闭走的是 Mantine 的退出过渡，节点要等过渡走完才卸载。
    await waitFor(() =>
      expect(screen.queryByTestId('menu-back-to-list')).not.toBeInTheDocument(),
    )
  })

  it('没有任何菜单展开时，悬停标题不会弹出菜单', () => {
    renderBar()
    fireEvent.mouseEnter(screen.getByTestId('menu-view'))
    expect(screen.queryByTestId('menu-view-gantt')).not.toBeInTheDocument()
  })
})

describe('MenuBar「任务」菜单的条目纪律', () => {
  it('新建任务始终可用 —— 它没有前提', async () => {
    renderBar()
    await openMenu('task', 'new-task')
    expect(screen.getByTestId('new-task')).toBeEnabled()
  })

  it('未选中任务时：缩进 / 反缩进 / 设为里程碑 禁用，且各给出理由（不隐藏）', async () => {
    renderBar()
    await openMenu('task', 'new-task')

    for (const testId of ['indent', 'outdent', 'toggle-milestone']) {
      const item = screen.getByTestId(testId)
      expect(item).toBeDisabled()
      // §10.3.2：禁用要**给理由**，而不是让用户对着灰条目猜
      expect(item).toHaveTextContent('未选中任务')
    }
  })

  it('缩进的可用性复用 outlineActions：选中第一个子任务仍禁用，选中第二个才可用', async () => {
    renderBar()
    await openMenu('task', 'new-task')

    // 子一没有前一个兄弟 → canIndent 为假 → 禁用（且理由换成缩进规则本身）
    act(() => useViewStore.getState().selectTask(ids.child1))
    const indent = screen.getByTestId('indent')
    expect(indent).toBeDisabled()
    expect(indent).toHaveTextContent('需前一个同级任务，且它不是里程碑')

    // 子二前一个是「子一」（不是里程碑）→ 可缩进
    act(() => useViewStore.getState().selectTask(ids.child2))
    expect(screen.getByTestId('indent')).toBeEnabled()
  })

  it('摘要任务不能设为里程碑（与 task.toggleMilestone 的守卫一致）', async () => {
    renderBar()
    await openMenu('task', 'new-task')

    act(() => useViewStore.getState().selectTask(ids.parent))
    const item = screen.getByTestId('toggle-milestone')
    expect(item).toBeDisabled()
    expect(item).toHaveTextContent('摘要任务不支持')
  })

  it('设为里程碑的文案随当前状态变：已是里程碑时显示「取消里程碑」', async () => {
    renderBar()
    project.tasks[ids.child1] = { ...project.tasks[ids.child1], kind: 'milestone', duration: 0 }
    await openMenu('task', 'new-task')

    act(() => useViewStore.getState().selectTask(ids.child1))
    expect(screen.getByTestId('toggle-milestone')).toHaveTextContent('取消里程碑')
  })

  it('点击「新建任务」dispatch 出 task.create（把操作真的接上命令层）', async () => {
    renderBar()
    await openMenu('task', 'new-task')
    const before = Object.keys(useProjectStore.getState().project!.tasks).length

    fireEvent.click(screen.getByTestId('new-task'))

    expect(Object.keys(useProjectStore.getState().project!.tasks)).toHaveLength(before + 1)
  })
})

describe('MenuBar「视图」菜单的状态表达', () => {
  it('当前视图与缩放档位用勾选标记表达（勾选 = 有图标，未选 = 空占位）', async () => {
    renderBar()
    await openMenu('view', 'menu-view-gantt')

    // activeView 默认 gantt、zoom 默认 day
    expect(screen.getByTestId('menu-view-gantt').querySelector('svg')).not.toBeNull()
    expect(screen.getByTestId('menu-view-outline').querySelector('svg')).toBeNull()
    expect(screen.getByTestId('menu-zoom-option-day').querySelector('svg')).not.toBeNull()
    expect(screen.getByTestId('menu-zoom-option-week').querySelector('svg')).toBeNull()
  })

  it('点击「任务列表」切换视图', async () => {
    renderBar()
    await openMenu('view', 'menu-view-gantt')

    fireEvent.click(screen.getByTestId('menu-view-outline'))
    expect(useViewStore.getState().activeView).toBe('outline')
  })

  it('「折叠全部」在没有任何分组时禁用并给理由；有分组时可用', async () => {
    // 一个没有子任务的扁平项目 → 无可折叠项
    const flat = createProject('扁平', '2026-03-02')
    const solo = createTask({ name: '独苗' })
    flat.tasks = { [solo.id]: solo }
    flat.rootIds = [solo.id]
    useProjectStore.setState({ project: flat })

    renderBar()
    await openMenu('view', 'menu-view-gantt')
    const item = screen.getByTestId('menu-collapse-all')
    expect(item).toBeDisabled()
    expect(item).toHaveTextContent('没有可折叠的分组')
  })

  it('「折叠全部」把有子任务的行全部收进 collapsedIds，「展开全部」清空它', async () => {
    renderBar()
    await openMenu('view', 'menu-view-gantt')

    fireEvent.click(screen.getByTestId('menu-collapse-all'))
    expect([...useViewStore.getState().collapsedIds]).toEqual([ids.parent])

    // 折叠后菜单重开：「折叠全部」变禁用（已全部折叠），「展开全部」可用
    await openMenu('view', 'menu-view-gantt')
    expect(screen.getByTestId('menu-collapse-all')).toBeDisabled()
    expect(screen.getByTestId('menu-collapse-all')).toHaveTextContent('已全部折叠')
    expect(screen.getByTestId('menu-expand-all')).toBeEnabled()

    fireEvent.click(screen.getByTestId('menu-expand-all'))
    expect(useViewStore.getState().collapsedIds.size).toBe(0)
  })
})

describe('MenuBar「编辑」菜单', () => {
  it('撤销栈为空时：撤销禁用、给出理由、不显示快捷键', async () => {
    renderBar()
    await openMenu('edit', 'undo')

    const undo = screen.getByTestId('undo')
    expect(undo).toBeDisabled()
    expect(undo).toHaveTextContent('没有可撤销的操作')
    // §10.3.3：禁用的条目不该标一个按不出来的快捷键
    expect(undo.textContent).not.toContain('Z')
  })

  it('有历史时：撤销可用、条目带「撤的是哪一步」、并显示快捷键', async () => {
    useProjectStore.getState().dispatch({
      type: 'task.create',
      label: 'commands.task.create',
      payload: { name: '加一个' },
    })

    renderBar()
    await openMenu('edit', 'undo')

    const undo = screen.getByTestId('undo')
    expect(undo).toBeEnabled()
    expect(undo).toHaveTextContent('撤销：新建任务')
    // 快捷键真的绑了（Toolbar 的 useUndoRedoShortcuts）才标出来
    expect(undo.textContent).toContain('Ctrl')
  })

  it('未选中任务时「删除任务」禁用并给理由', async () => {
    renderBar()
    await openMenu('edit', 'undo')

    const del = screen.getByTestId('delete-task')
    expect(del).toBeDisabled()
    expect(del).toHaveTextContent('未选中任务')
  })
})

describe('MenuBar「项目」/「资源」菜单', () => {
  it('未设置基线时「删除当前基线」禁用并给理由', async () => {
    renderBar()
    await openMenu('project', 'menu-save-baseline')

    const del = screen.getByTestId('menu-delete-baseline')
    expect(del).toBeDisabled()
    expect(del).toHaveTextContent('未设置基线')
  })

  it('「保存基线」dispatch project.setBaseline，之后「删除当前基线」解禁', async () => {
    renderBar()
    await openMenu('project', 'menu-save-baseline')

    fireEvent.click(screen.getByTestId('menu-save-baseline'))
    expect(useProjectStore.getState().project!.baselines).toHaveLength(1)

    await openMenu('project', 'menu-save-baseline')
    expect(screen.getByTestId('menu-delete-baseline')).toBeEnabled()
  })

  it('「排期方向」是子菜单，点「向后排期」dispatch project.setDirection', async () => {
    renderBar()
    await openMenu('project', 'menu-save-baseline')

    // 子菜单靠悬停展开（Floating UI 的 pointer enter）
    const target = screen.getByTestId('menu-direction')
    fireEvent.pointerEnter(target)
    fireEvent.mouseEnter(target)

    const backward = await screen.findByTestId('menu-direction-backward')
    fireEvent.click(backward)
    expect(useProjectStore.getState().project!.schedulingDirection).toBe('backward')
  })

  it('「新建资源」dispatch resource.create', async () => {
    renderBar()
    await openMenu('resource', 'menu-new-resource')

    fireEvent.click(screen.getByTestId('menu-new-resource'))
    expect(Object.keys(useProjectStore.getState().project!.resources)).toHaveLength(1)
  })

  // 核心原则「点了没反应比明确禁用更糟」：菜单建了资源却停在原 Tab、不选中，
  // 用户看不到任何变化 = 点了没反应。这条钉住菜单真的把右栏带到了新资源上。
  it('「新建资源」把右栏切到「资源」Tab 并选中刚建的资源', async () => {
    renderBar()
    await openMenu('resource', 'menu-new-resource')

    fireEvent.click(screen.getByTestId('menu-new-resource'))

    const resources = Object.keys(useProjectStore.getState().project!.resources)
    expect(resources).toHaveLength(1)
    // 选中的正是刚建的那一个（id 由命令层生成，UI 靠 key 差集拿到）
    expect(useViewStore.getState().selectedResourceId).toBe(resources[0])
    // 且切到了资源 Tab —— 否则选中态在看不见的面板里，仍等于没反应
    expect(useViewStore.getState().activeInspectorTab).toBe('resource')
  })
})

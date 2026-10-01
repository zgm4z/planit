import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'

import { initCommands, __resetRegistryForTests } from '../commands/registry'
import {
  createDependency,
  createProject,
  createTask,
  __resetIdCounterForTests,
} from '../domain/model/factories'
import { useProjectStore } from '../store/projectStore'
import { useViewStore } from '../store/viewStore'
import { Inspector } from './Inspector'
import i18n from '../i18n'

let parentId: string
let taskId: string
let siblingId: string

function renderInspector() {
  return render(
    <MantineProvider>
      <Inspector />
    </MantineProvider>,
  )
}

beforeEach(async () => {
  __resetRegistryForTests()
  initCommands()
  __resetIdCounterForTests()
  await i18n.changeLanguage('zh-CN')

  const project = createProject('测试', '2026-03-02')
  const parent = createTask({ name: '阶段一' })
  const child = createTask({ name: '写文档', duration: 3 })
  const sibling = createTask({ name: '写代码', duration: 2 })
  project.tasks[parent.id] = parent
  project.tasks[child.id] = { ...child, parentId: parent.id }
  project.tasks[sibling.id] = { ...sibling, parentId: parent.id }
  project.tasks[parent.id].childIds = [child.id, sibling.id]
  project.tasks[parent.id].kind = 'group'
  project.rootIds = [parent.id]
  parentId = parent.id
  taskId = child.id
  siblingId = sibling.id

  useProjectStore.setState({ project, undoStack: [], redoStack: [], lastError: null })
  useViewStore.setState({ selectedTaskId: child.id, collapsedIds: new Set() })
})

// 注：Mantine 的 Tabs**面板外壳**（data-testid="inspector-*-panel" 的那个 <div>）无论
// keepMounted 与否都常驻 DOM（非活动时 display:none），所以「面板外壳不在 DOM」是不可达的
// 断言 —— 那是恒真/恒假，区分不了对错。改为断言「非活动面板的**内容**不渲染」：
// keepMounted={false} 时非活动面板只渲染 null，于是任务内容（写文档 / 工期）在项目 Tab 下
// 消失；这依赖真实实现，写错就会红。
describe('Inspector 外壳（Tabs）', () => {
  it('选中任务时「任务」Tab 生效', () => {
    renderInspector()
    expect(screen.getByRole('tab', { name: '任务' })).toHaveAttribute('aria-selected', 'true')
    // 任务面板的内容确实渲染了（挂载策略无关：只有活动面板才渲染内容）
    expect(screen.getByDisplayValue('写文档')).toBeInTheDocument()
  })

  it('未选中任务时显示「项目」Tab（右栏不塌陷）', () => {
    useViewStore.setState({ selectedTaskId: null })
    renderInspector()

    expect(screen.getByTestId('inspector')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '项目' })).toHaveAttribute('aria-selected', 'true')
    // 项目面板的内容真的渲染了（不是空白右栏）—— 这条就是「修掉塌陷」的实质证据
    expect(screen.getByLabelText('名称')).toHaveValue('测试')
  })

  it('未选中任务时「任务」Tab 被禁用，点不动', () => {
    useViewStore.setState({ selectedTaskId: null })
    renderInspector()
    expect(screen.getByRole('tab', { name: '任务' })).toBeDisabled()
  })

  it('选着任务时能手动切到「项目」Tab', async () => {
    const user = userEvent.setup()
    renderInspector()

    await user.click(screen.getByRole('tab', { name: '项目' }))
    expect(screen.getByRole('tab', { name: '项目' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '任务' })).toHaveAttribute('aria-selected', 'false')
    // 任务面板内容随 Tab 失活而消失（否则任务与项目两个「名称」输入框会同屏重名）
    expect(screen.queryByDisplayValue('写文档')).not.toBeInTheDocument()
    // 项目面板内容出现 —— 这才是「切换生效」的实质证据
    expect(screen.getByLabelText('名称')).toHaveValue('测试')
  })
})

describe('Inspector 任务面板的 7 个分组', () => {
  it('7 个分组都渲染成可折叠的分组头', () => {
    renderInspector()
    for (const label of [
      '任务信息',
      '日程安排',
      '基线',
      '相关性',
      '分配的资源',
      '资源分配',
      '预计的工作量',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('默认展开状态符合 spec §5：前三组展开、后四组折叠', () => {
    renderInspector()
    const expanded = (label: string) =>
      screen.getByRole('button', { name: label }).getAttribute('aria-expanded')

    expect(expanded('任务信息')).toBe('true')
    expect(expanded('日程安排')).toBe('true')
    expect(expanded('相关性')).toBe('true')
    expect(expanded('基线')).toBe('false')
    expect(expanded('分配的资源')).toBe('false')
    expect(expanded('资源分配')).toBe('false')
    expect(expanded('预计的工作量')).toBe('false')
  })

  it('点分组头能折叠 / 展开', async () => {
    const user = userEvent.setup()
    renderInspector()
    const info = screen.getByRole('button', { name: '任务信息' })

    await user.click(info)
    expect(info).toHaveAttribute('aria-expanded', 'false')
    await user.click(info)
    expect(info).toHaveAttribute('aria-expanded', 'true')
  })

  it('占位组展开后是禁用态且有说明文案（不是隐藏）', async () => {
    const user = userEvent.setup()
    renderInspector()

    await user.click(screen.getByRole('button', { name: '基线' }))
    expect(screen.getByTestId('placeholder-baseline')).toBeInTheDocument()
    expect(screen.getByLabelText('未设置基线')).toBeDisabled()
    expect(screen.getByText(/基线对比将在 v1\.0 提供/)).toBeInTheDocument()
  })
})

describe('Inspector（搬迁后的既有行为仍成立）', () => {
  it('显示选中任务的名称', () => {
    renderInspector()
    expect(screen.getByDisplayValue('写文档')).toBeInTheDocument()
  })

  it('修改工期会写回 store', async () => {
    const user = userEvent.setup()
    renderInspector()

    const input = screen.getByLabelText('工期')
    await user.clear(input)
    await user.type(input, '5')

    expect(useProjectStore.getState().project!.tasks[taskId].duration).toBe(5)
  })

  it('摘要任务不显示工期输入框，且显示汇总说明', () => {
    useViewStore.setState({ selectedTaskId: parentId })
    renderInspector()

    expect(screen.queryByLabelText('工期')).not.toBeInTheDocument()
    expect(screen.getByText(/日期由子任务汇总/)).toBeInTheDocument()
  })

  it('冲突在任务 Tab 顶部显示，且用当前语言的约束名', () => {
    const project = useProjectStore.getState().project!
    const dep = createDependency(siblingId, taskId, 'FS', 0)
    useProjectStore.setState({
      project: {
        ...project,
        dependencies: { ...project.dependencies, [dep.id]: dep },
        tasks: {
          ...project.tasks,
          [taskId]: {
            ...project.tasks[taskId],
            scheduling: { mode: 'constraint', type: 'startOn', date: '2026-03-02' },
          },
        },
      },
    })

    renderInspector()

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('固定开始日期')
    expect(alert).not.toHaveTextContent('startOn')
  })

  it('切换到 English 后标签变英文', async () => {
    await i18n.changeLanguage('en-US')
    renderInspector()

    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Duration')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Task' })).toBeInTheDocument()
  })
})

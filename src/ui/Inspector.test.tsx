import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'

import { initCommands, __resetRegistryForTests } from '../commands/registry'
import {
  createAssignment,
  createDependency,
  createProject,
  createResource,
  createTask,
  __resetIdCounterForTests,
} from '../domain/model/factories'
import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'
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

/** 当前选中任务在 store 里的样子 —— 断言落在 store 上而不是外观上 */
function currentTask() {
  return useProjectStore.getState().project!.tasks[taskId]
}

/**
 * 展开 Mantine 浮层下拉并点选一项。jsdom 里浮层的计算样式停在 display:none，
 * userEvent.click 会因「元素不可见」拒绝点击，故这里用 fireEvent 直接派发，
 * 且按 `hidden: true` 取（仍在 DOM 但被判定为不可见）的 option。
 * 「能不能看得见」这类真实可见性由 e2e 验收，不在单测范围。
 *
 * `scopeTestId`（可选）把候选项限定到某一段的**候选容器**里：相关性组的两个「添加」
 * 下拉候选集相同（同一个叶子任务在两个方向上都可连），而 Mantine 把下拉渲染进 portal
 * 且 keepMounted（关闭时仍在 DOM），不限定就会命中两个同名 option 而抛错 —— 那不是
 * 被测代码的问题。该 testid 由 `RelationSection` 经公开的 `scrollAreaProps` 挂在下拉
 * 候选容器上，**不再依赖 Mantine 内部的 `aria-controls` / id 注入时机**。
 */
async function chooseOption(
  user: ReturnType<typeof userEvent.setup>,
  selectLabel: string,
  optionLabel: string,
  scopeTestId?: string,
) {
  const combobox = screen.getByRole('combobox', { name: selectLabel })
  await user.click(combobox)
  const option = scopeTestId
    ? within(screen.getByTestId(scopeTestId)).getByRole('option', {
        name: optionLabel,
        hidden: true,
      })
    : screen.getByRole('option', { name: optionLabel, hidden: true })
  fireEvent.click(option)
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

  it('默认展开状态符合 spec §5：基线解禁后共五组展开、两个占位组折叠', () => {
    renderInspector()
    const expanded = (label: string) =>
      screen.getByRole('button', { name: label }).getAttribute('aria-expanded')

    // 不变式「默认展开的 ⟺ 非占位组」：基线组解禁后必须进默认展开集，
    // 否则 inspectorGroups.test.ts 的守卫会红（也见 DEFAULT_OPEN_GROUPS）。
    expect(expanded('任务信息')).toBe('true')
    expect(expanded('日程安排')).toBe('true')
    expect(expanded('基线')).toBe('true')
    expect(expanded('相关性')).toBe('true')
    expect(expanded('分配的资源')).toBe('true')
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

  // 「基线」组在 v1.0 已解禁，不再是占位组 —— 本用例改用**仍是占位**的「资源分配」组。
  it('占位组展开后是只读事实块 + 说明文案，且不含任何禁用控件（§3.3）', async () => {
    const user = userEvent.setup()
    renderInspector()

    await user.click(screen.getByRole('button', { name: '资源分配' }))
    const group = screen.getByTestId('placeholder-allocation')
    expect(group).toBeInTheDocument()
    expect(screen.getByText(/分配变更时的自动调整尚未排期/)).toBeInTheDocument()

    // 区分性断言（§3.3「绝不用灰掉的禁用输入框表达数据」）：占位组改为只读事实行后，
    // 组内**不能再有任何表单控件**。一旦有人把禁用 Select 加回来，这两条立刻变红。
    expect(within(group).queryAllByRole('combobox')).toHaveLength(0)
    expect(within(group).queryAllByRole('textbox')).toHaveLength(0)
    // 字段名仍以**可读文本**呈现（规格表的标签列），而不是被吸附在控件上
    expect(within(group).getByText('当资源分配更改时')).toBeInTheDocument()
    expect(within(group).getByText('任务进度需要')).toBeInTheDocument()
  })

  // 「预计的工作量」同属占位组，此前没有用例覆盖 —— 补一条，防止 NumberInput 回归。
  it('「预计的工作量」占位组同样是只读事实块，无 NumberInput', async () => {
    const user = userEvent.setup()
    renderInspector()

    await user.click(screen.getByRole('button', { name: '预计的工作量' }))
    const group = screen.getByTestId('placeholder-expected-effort')
    expect(group).toBeInTheDocument()
    expect(screen.getByText(/预计工作量尚未排期/)).toBeInTheDocument()
    // 三个量（最小 / 最大 / 期望）曾是三个禁用的 NumberInput —— 现在是三行事实文本
    expect(within(group).queryAllByRole('spinbutton')).toHaveLength(0)
    expect(within(group).getByText('最小值')).toBeInTheDocument()
    expect(within(group).getByText('期望值')).toBeInTheDocument()
  })
})

// v1.0 Task 5：「基线」组从占位组解禁为活组件（保存 / 切换 / 删除 / 看差异 / 已删除条目）。
// 断言全部落在**真实派生数据**上（project.baselines + 引擎的 result.baselineDiffs），
// 而不是外观 —— 这样实现一旦把「当前 − 基线」偷偷在 UI 里重算就会红。
describe('基线分组（v1.0 解禁）', () => {
  // 基线组解禁后进了 DEFAULT_OPEN_GROUPS（默认展开），所以不再需要点开——
  // 点它反而会把它折叠起来（Accordion 的默认展开是「已展开」）。
  it('未设置基线时显示「未设置基线」而不是占位说明', () => {
    renderInspector()

    expect(screen.getByTestId('inspector-baseline')).toBeInTheDocument()
    expect(screen.getByText('未设置基线')).toBeInTheDocument()
    // 占位态彻底消失：不再有「将在 v1.0 提供」的说明（那门组件已经真的到了）
    expect(screen.queryByText(/v1\.0/)).not.toBeInTheDocument()
  })

  it('「保存当前排期为基线」把快照交给命令层（不落 UI 拼的 payload）', async () => {
    const user = userEvent.setup()
    renderInspector()

    await user.click(screen.getByTestId('baseline-save'))

    const project = useProjectStore.getState().project!
    expect(project.baselines).toHaveLength(1)
    // 快照只含叶子任务：写文档 / 写代码 —— 不含摘要「阶段一」
    expect(Object.keys(project.baselines[0].entries).sort()).toEqual([taskId, siblingId].sort())
    // 保存即设为活动基线（命令层的契约）
    expect(project.activeBaselineId).toBe(project.baselines[0].id)
  })

  it('切换基线写回 activeBaselineId；选「不对比」则归零', async () => {
    const user = userEvent.setup()
    // 造两条基线（用真实命令，保证形状合法）
    act(() =>
      useProjectStore.getState().dispatch({
        type: 'project.setBaseline',
        label: 'commands.project.setBaseline',
        payload: { name: '基线 1' },
      }),
    )
    act(() =>
      useProjectStore.getState().dispatch({
        type: 'project.setBaseline',
        label: 'commands.project.setBaseline',
        payload: { name: '基线 2' },
      }),
    )
    const first = useProjectStore.getState().project!.baselines[0]

    renderInspector()
    // 第二条是保存后的活动基线
    expect(screen.getByTestId('baseline-select')).toHaveValue('基线 2')

    await chooseOption(user, '对比基线', '基线 1')
    expect(useProjectStore.getState().project!.activeBaselineId).toBe(first.id)

    await chooseOption(user, '对比基线', '不对比')
    expect(useProjectStore.getState().project!.activeBaselineId).toBeNull()
  })

  it('删除活动基线后清空 activeBaselineId（不留悬空引用）', async () => {
    const user = userEvent.setup()
    act(() =>
      useProjectStore.getState().dispatch({
        type: 'project.setBaseline',
        label: 'commands.project.setBaseline',
        payload: { name: '基线 1' },
      }),
    )

    renderInspector()
    await user.click(screen.getByTestId('baseline-delete'))

    const project = useProjectStore.getState().project!
    expect(project.baselines).toHaveLength(0)
    expect(project.activeBaselineId).toBeNull()
  })

  it('显示引擎派生的基线与差异（工作日口径），不在 UI 重算', () => {
    // 保存一份「此刻」的基线，之后把工期改长，再看差异 —— 差异由引擎派生，不由 UI 重算
    act(() =>
      useProjectStore.getState().dispatch({
        type: 'project.setBaseline',
        label: 'commands.project.setBaseline',
        payload: { name: '基线 1' },
      }),
    )
    // 基线拍完后把工期 +2（写文档 3 → 5）→ 结束日应比基线晚 2 个工作日
    act(() =>
      useProjectStore.getState().dispatch({
        type: 'task.setDuration',
        label: 'commands.task.setDuration',
        payload: { taskId, duration: 5 },
      }),
    )

    renderInspector()

    const diff = useScheduleStore.getState().result.baselineDiffs[taskId]
    expect(diff.baselineStart).toBe('2026-03-02')
    expect(diff.baselineFinish).toBe('2026-03-04')
    expect(diff.finishVariance).toBe(2)
    // 差异改为「只读事实块」后，标签与数值各占一格（结构变化），断言强度不变：
    // 渲染值必须逐字等于引擎派生值 —— UI 若自己重算一遍「当前 − 基线」这里就会红。
    expect(screen.getByText('开始差异')).toBeInTheDocument()
    expect(screen.getByText('结束差异')).toBeInTheDocument()
    expect(screen.getByTestId('baseline-start-variance')).toHaveTextContent(`${diff.startVariance} 天`)
    expect(screen.getByTestId('baseline-finish-variance')).toHaveTextContent(
      `${diff.finishVariance} 天`,
    )
    // 基线起止日期也一律 YYYY-MM-DD（§1.3）
    expect(screen.getByTestId('baseline-start')).toHaveTextContent('2026-03-02')
    expect(screen.getByTestId('baseline-finish')).toHaveTextContent('2026-03-04')
  })

  it('摘要任务在基线组里不显示差异（快照只含叶子），而是给汇总说明', async () => {
    act(() =>
      useProjectStore.getState().dispatch({
        type: 'project.setBaseline',
        label: 'commands.project.setBaseline',
        payload: { name: '基线 1' },
      }),
    )
    act(() => useViewStore.setState({ selectedTaskId: parentId }))

    renderInspector()
    // 限定到基线组内 —— 「任务信息」组对摘要行也渲染同一句 summaryHint，
    // 不限定就会命中两个（那不是被测代码的问题）
    const baseline = screen.getByTestId('inspector-baseline')
    expect(within(baseline).getByText(/日期由子任务汇总/)).toBeInTheDocument()
  })

  it('基线里含已删除任务时，该条目仍显示且标注「已删除」（不消失、不崩溃）', () => {
    const project = useProjectStore.getState().project!

    // 手工构造一条活动基线，其条目里混入一个已不在 project.tasks 中的 id ——
    // 「删任务不级联删基线条目」是命令层刻意保证的（见 Task 3 反向用例），
    // 这里是该契约在 UI 上的后果：必须靠条目里存的 name 才能辨认（偏差 1 / D9）。
    useProjectStore.setState({
      project: {
        ...project,
        baselines: [
          {
            id: 'bl-test',
            name: '基线 1',
            createdAt: '2026-03-02T00:00:00.000Z',
            entries: {
              [siblingId]: { name: '写代码', start: '2026-03-05', finish: '2026-03-06' },
              ghost: { name: '被删掉的任务', start: '2026-03-05', finish: '2026-03-06' },
            },
          },
        ],
        activeBaselineId: 'bl-test',
      },
    })

    renderInspector()

    // 已删除的条目仍在，且用存的 name 明确标注「已删除」——既不是空白也不是崩溃
    expect(screen.getByTestId('baseline-deleted-entry')).toHaveTextContent('被删掉的任务（已删除）')
    // 区分性：**未**删除的条目不能被一并倒进「已删除」告警里 —— 否则这条断言恒真
    expect(screen.queryByText(/写代码（已删除）/)).not.toBeInTheDocument()
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

describe('任务信息组', () => {
  it('类型 Select 反映 kind，切到「里程碑」会把工期归零', async () => {
    const user = userEvent.setup()
    renderInspector()

    expect(screen.getByRole('combobox', { name: '类型' })).toHaveValue('任务')

    await chooseOption(user, '类型', '里程碑')

    const task = useProjectStore.getState().project!.tasks[taskId]
    expect(task.kind).toBe('milestone')
    expect(task.duration).toBe(0)
  })

  it('「分组」选项是禁用的（没有命令能把 task 变成 group —— 只能靠加子任务）', async () => {
    const user = userEvent.setup()
    renderInspector()

    // 选项只有在展开下拉后才挂载（与 chooseOption 的同一条路径）
    await user.click(screen.getByRole('combobox', { name: '类型' }))
    const groupOption = screen.getByRole('option', { name: '分组', hidden: true })
    // Mantine 9 的 Combobox.Option 对 disabled 只落 `data-combobox-disabled`（mod 派生），
    // 既无 `data-disabled` 也无 `aria-disabled`。这条属性由 data 里的 `disabled: true` 驱动 ——
    // 一旦把它删掉，属性即消失、用例变红，不是恒真断言。
    expect(groupOption).toHaveAttribute('data-combobox-disabled', 'true')
  })

  it('任务本身是分组时，类型 Select 整体禁用并给出说明', () => {
    useViewStore.setState({ selectedTaskId: parentId })
    renderInspector()

    expect(screen.getByRole('combobox', { name: '类型' })).toBeDisabled()
    expect(screen.getByText(/分组的类型由子任务决定/)).toBeInTheDocument()
  })

  it('投入 / 剩余显示引擎派生的真实值，且是只读文本而非禁用输入框', () => {
    const project = useProjectStore.getState().project!
    const resource = createResource({ name: '张三' })
    const assignment = createAssignment({ taskId, resourceId: resource.id, units: 1 })
    useProjectStore.setState({
      project: {
        ...project,
        resources: { [resource.id]: resource },
        tasks: { ...project.tasks, [taskId]: { ...project.tasks[taskId], effortMode: 'fixedDuration' } },
        assignments: { [assignment.id]: assignment },
      },
    })
    renderInspector()

    // duration 3 天 × Σunits(1) = 3 人日（fixedDuration 正算）；progress=0 → 剩余 = 投入
    expect(screen.getByTestId('stat-effort')).toHaveTextContent('3')
    expect(screen.getByTestId('stat-remaining')).toHaveTextContent('3')
    // 区分性断言（§3.3「绝不用灰掉的禁用输入框表达数据」）：这两个量不再是表单控件 ——
    // 一旦有人把它们改回 NumberInput，getByLabelText 就会命中、这条立刻变红。
    expect(screen.queryByLabelText('投入')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('剩余')).not.toBeInTheDocument()
    // 未设费率 → 成本概念未启用 → 整块收起（不是三个恒为 0 的灰框占三行）
    expect(screen.queryByTestId('inspector-costs')).not.toBeInTheDocument()
    // 旧的「v0.5 提供」占位文案必须消失 —— 它们现在有真实值了，再标版本就是说谎。
    expect(screen.queryByText(/投入与剩余将在 v0\.5 提供/)).not.toBeInTheDocument()
    expect(screen.queryByText(/成本将在 v0\.5 提供/)).not.toBeInTheDocument()
  })

  it('投入按 §1.3 格式化：0.8889 显示为 0.9（绝不放原始浮点）', () => {
    const project = useProjectStore.getState().project!
    const resource = createResource({ name: '张三' })
    // units = 1/9、工期 8 → 投入 = 8/9 = 0.8888…
    const assignment = createAssignment({ taskId, resourceId: resource.id, units: 1 / 9 })
    useProjectStore.setState({
      project: {
        ...project,
        resources: { [resource.id]: resource },
        tasks: {
          ...project.tasks,
          [taskId]: { ...project.tasks[taskId], effortMode: 'fixedDuration', duration: 8 },
        },
        assignments: { [assignment.id]: assignment },
      },
    })
    renderInspector()

    // 引擎给的是 0.888888…，渲染必须是「0.9」—— 写错（用原始值 / toFixed(4)）就会红
    expect(screen.getByTestId('stat-effort')).toHaveTextContent('0.9')
    expect(screen.getByTestId('stat-effort')).not.toHaveTextContent('0.8889')
  })

  it('启用成本概念后，三种成本合并成一行只读文本（不是三个灰框）', () => {
    const project = useProjectStore.getState().project!
    // 一次性使用成本 1000 → 任务成本 = 1000；无小时费率 → 资源成本 0
    // （工厂不接受 cost 覆盖，故先建后补 —— 与命令层写回的形状一致）
    const resource = { ...createResource({ name: '张三' }), cost: { currency: 'CNY', usage: 1000 } }
    const assignment = createAssignment({ taskId, resourceId: resource.id, units: 1 })
    useProjectStore.setState({
      project: {
        ...project,
        resources: { [resource.id]: resource },
        assignments: { [assignment.id]: assignment },
      },
    })
    renderInspector()

    // 一行只读文本，含千分位（§1.3：成本 0 位 + 千分位）
    expect(screen.getByTestId('inspector-costs')).toHaveTextContent(
      '任务成本 1,000 · 资源成本 0 · 总成本 1,000',
    )
    // 区分性：三个独立控件必须不复存在 —— 否则「用控件表达数据」的缺陷又回来了
    expect(screen.queryByLabelText('任务成本')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('资源成本')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('总成本')).not.toBeInTheDocument()
  })

  // 以下两条是 v0.4 Task 2 重写测试文件时误删的既有用例（覆盖倒退），
  // 现恢复。断言强度不改，只在控件形态变化处改写交互（见各条注释）。
  it('修改进度会写回 store', async () => {
    const user = userEvent.setup()
    renderInspector()

    const input = screen.getByLabelText('进度（%）')
    await user.clear(input)
    await user.type(input, '40')

    expect(currentTask().progress).toBe(40)
  })

  it('切换里程碑会把工期归零', async () => {
    const user = userEvent.setup()
    renderInspector()

    // Task 3 把「里程碑」复选框换成了「类型」Select 的选项之一，
    // 交互因此从「点 label」改为「选选项」；断言本身不变。
    await chooseOption(user, '类型', '里程碑')

    const task = currentTask()
    expect(task.kind).toBe('milestone')
    expect(task.duration).toBe(0)
  })
})

describe('日程安排组', () => {
  it('排期方式切到固定开始日期会写入约束', async () => {
    const user = userEvent.setup()
    renderInspector()

    // 初始读出的应是「自动排期」（合并 Select 的 auto 项）
    expect(screen.getByRole('combobox', { name: '排期方式' })).toHaveValue('自动排期')

    await chooseOption(user, '排期方式', '固定开始日期')

    const scheduling = currentTask().scheduling
    expect(scheduling.mode).toBe('constraint')
    if (scheduling.mode !== 'constraint') throw new Error('unreachable')
    expect(scheduling.type).toBe('startOn')
    // 这条断言测的是「UI 把用户看到的开始日写进约束日期」——属于派生取值，
    // 应与 Inspector 取同一个字段（scheduledStart），而不是引擎原始输出 earlyStart。
    expect(scheduling.date).toBe(
      useScheduleStore.getState().result.schedules[taskId].scheduledStart,
    )
  })

  it('排期方式切到固定结束日期会写入 finishOn', async () => {
    const user = userEvent.setup()
    renderInspector()

    await chooseOption(user, '排期方式', '固定结束日期')

    expect(currentTask().scheduling).toEqual({
      mode: 'constraint',
      type: 'finishOn',
      date: '2026-03-02',
    })
  })

  it('排期方式切回自动会清掉约束', async () => {
    const user = userEvent.setup()
    useProjectStore.setState({
      project: {
        ...useProjectStore.getState().project!,
        tasks: {
          ...useProjectStore.getState().project!.tasks,
          [taskId]: {
            ...currentTask(),
            scheduling: { mode: 'constraint', type: 'finishOn', date: '2026-03-05' },
          },
        },
      },
    })

    renderInspector()
    await chooseOption(user, '排期方式', '自动排期')

    expect(currentTask().scheduling).toEqual({ mode: 'auto' })
  })

  it('已存在的约束会被排期下拉正确读出', () => {
    useProjectStore.setState({
      project: {
        ...useProjectStore.getState().project!,
        tasks: {
          ...useProjectStore.getState().project!.tasks,
          [taskId]: {
            ...currentTask(),
            scheduling: { mode: 'constraint', type: 'finishOn', date: '2026-03-05' },
          },
        },
      },
    })

    renderInspector()

    expect(screen.getByRole('combobox', { name: '排期方式' })).toHaveValue('固定结束日期')
    // Task 4 把「约束日期」并入开始/结束两个字段：finishOn 属「结束」族，
    // 约束的日期就显示在「结束」输入框里（断言强度不变，只是换了控件位置）。
    expect(screen.getByLabelText('结束')).toHaveValue('2026-03-05')
  })

  it('下拉列出全部 6 种 ConstraintType（一个控件即可设置任一约束）', async () => {
    const user = userEvent.setup()
    renderInspector()

    await user.click(screen.getByRole('combobox', { name: '排期方式' }))
    const options = [
      '固定开始日期',
      '固定结束日期',
      '开始不早于',
      '开始不晚于',
      '结束不早于',
      '结束不晚于',
    ]
    for (const label of options) {
      expect(screen.getByRole('option', { name: label, hidden: true })).toBeInTheDocument()
    }
  })

  it('自动模式下开始 / 结束都只读', () => {
    renderInspector()
    expect(screen.getByLabelText('开始')).toBeDisabled()
    expect(screen.getByLabelText('结束')).toBeDisabled()
  })

  it('endOn 约束下「结束」可编辑、「开始」仍只读（偏差 3：族决定可编辑性）', () => {
    const project = useProjectStore.getState().project!
    useProjectStore.setState({
      project: {
        ...project,
        tasks: {
          ...project.tasks,
          [taskId]: {
            ...project.tasks[taskId],
            scheduling: { mode: 'constraint', type: 'finishOn', date: '2026-03-05' },
          },
        },
      },
    })
    renderInspector()

    // finishOn 属于「结束」族 → 结束可编辑、开始只读
    expect(screen.getByLabelText('结束')).not.toBeDisabled()
    expect(screen.getByLabelText('开始')).toBeDisabled()
  })

  it('startOn 约束下「开始」可编辑、「结束」仍只读（族是 start 侧）', () => {
    const project = useProjectStore.getState().project!
    useProjectStore.setState({
      project: {
        ...project,
        tasks: {
          ...project.tasks,
          [taskId]: {
            ...project.tasks[taskId],
            scheduling: { mode: 'constraint', type: 'startOn', date: '2026-03-05' },
          },
        },
      },
    })
    renderInspector()

    expect(screen.getByLabelText('开始')).not.toBeDisabled()
    expect(screen.getByLabelText('结束')).toBeDisabled()
  })

  it('编辑「结束」写回 finishOn 约束的日期（不偷换类型）', () => {
    const project = useProjectStore.getState().project!
    useProjectStore.setState({
      project: {
        ...project,
        tasks: {
          ...project.tasks,
          [taskId]: {
            ...project.tasks[taskId],
            scheduling: { mode: 'constraint', type: 'finishOn', date: '2026-03-05' },
          },
        },
      },
    })
    renderInspector()

    // date 输入框用 fireEvent.change（userEvent 对 type="date" 的逐字符输入不稳定）
    fireEvent.change(screen.getByLabelText('结束'), { target: { value: '2026-03-09' } })

    // 类型仍是 finishOn —— 编辑日期不允许把 Select 上的类型悄悄换成 startOn
    expect(currentTask().scheduling).toEqual({
      mode: 'constraint',
      type: 'finishOn',
      date: '2026-03-09',
    })
  })

  it('「安排：尽晚」写回 schedulingOrder=alap，切回尽快写回 asap', async () => {
    const user = userEvent.setup()
    renderInspector()

    // 用有浮时可言的叶子任务（写文档无依赖、父下有兄弟），而不是孤立的单任务 ——
    // 命令是否真的落到 store 上，是这一层要钉死的东西（引擎是否据此挪动由 e2e 验收）。
    await user.click(screen.getByTestId('order-alap'))
    expect(currentTask().schedulingOrder).toBe('alap')

    await user.click(screen.getByTestId('order-asap'))
    expect(currentTask().schedulingOrder).toBe('asap')
  })

  it('优先级连改合并成一条撤销；失焦后另起一条', async () => {
    const user = userEvent.setup()
    renderInspector()
    const input = screen.getByLabelText('优先级')

    await user.clear(input)
    await user.type(input, '3')
    expect(useProjectStore.getState().undoStack).toHaveLength(1)

    fireEvent.blur(input)
    await user.clear(input)
    await user.type(input, '7')
    expect(useProjectStore.getState().undoStack).toHaveLength(2)
    expect(currentTask().priority).toBe(7)
  })

  it('合并键带 taskId：改 A 的优先级不会并进 B 的记录（即使没有失焦打断）', async () => {
    const user = userEvent.setup()
    renderInspector()

    const input = screen.getByLabelText('优先级')
    await user.clear(input)
    await user.type(input, '3')
    expect(useProjectStore.getState().undoStack).toHaveLength(1)

    // 刻意直接 setState（而不走 viewStore.selectTask）—— selectTask 会 breakCoalescing，
    // 那样就测不出「合并键是否带 taskId」这条契约。这里不给屏障：唯一能阻止两条记录
    // 合并的东西，就是 coalesceKey 里的 taskId。
    act(() => useViewStore.setState({ selectedTaskId: siblingId }))

    const next = screen.getByLabelText('优先级')
    await user.clear(next)
    await user.type(next, '9')

    expect(useProjectStore.getState().undoStack).toHaveLength(2)
    expect(useProjectStore.getState().project!.tasks[taskId].priority).toBe(3)
    expect(useProjectStore.getState().project!.tasks[siblingId].priority).toBe(9)
  })

  it('延迟写回 delay，且允许拆分是禁用态并注明版本', async () => {
    const user = userEvent.setup()
    renderInspector()

    const input = screen.getByLabelText('延迟')
    await user.clear(input)
    await user.type(input, '2')
    expect(currentTask().delay).toBe(2)

    expect(screen.getByLabelText('允许拆分')).toBeDisabled()
    expect(screen.getByText(/拆分排期尚未实现/)).toBeInTheDocument()
  })

  it('摘要任务下「延迟」禁用、「优先级」可编辑（不对称是有意的）', () => {
    useViewStore.setState({ selectedTaskId: parentId })
    renderInspector()

    // task.setDelay 对 group 是 no-op → 必须禁用，否则是个「点了没反应」的输入框
    expect(screen.getByLabelText('延迟')).toBeDisabled()
    // 但 task.setPriority 对摘要**生效**（备注与优先级对摘要同样有意义）→ 绝不能禁用。
    // 这条断言就是防止下一个人来「统一」这个刻意的对称缺口。
    expect(screen.getByLabelText('优先级')).not.toBeDisabled()
  })

  it('日期输入不依赖原生 type=date —— 显示始终 YYYY-MM-DD（§1.3）', () => {
    renderInspector()
    const start = screen.getByLabelText('开始')

    // 原生 <input type="date"> 会按浏览器 locale 渲染成 2026/03/02；改用文本框后
    // 值只可能是 YYYY-MM-DD。写回 type="date" 这条立刻变红（那正是规范点名的缺陷）。
    expect(start).not.toHaveAttribute('type', 'date')
    expect(start).toHaveValue('2026-03-02')
    expect(start).toHaveAttribute('placeholder', 'YYYY-MM-DD')
  })

  it('没有排期时：日期留空，浮时是弱化的 —（不是空白、也不是 0）', () => {
    const result = useScheduleStore.getState().result
    useScheduleStore.setState({ result: { ...result, schedules: {} } })

    renderInspector()

    // §3.3 的「算不出来」：显 —，而不是把 undefined 兜成 0 天
    expect(screen.getByTestId('inspector-slack')).toHaveTextContent('—')
    expect(screen.getByTestId('inspector-slack')).not.toHaveTextContent('0 天')
    expect(screen.getByLabelText('开始')).toHaveValue('')
  })

  it('手动模式下显示手动安排提示', async () => {
    const user = userEvent.setup()
    renderInspector()
    await chooseOption(user, '排期方式', '固定开始日期')
    expect(screen.getByText(/此任务已手动安排/)).toBeInTheDocument()
  })
})

// Task 5：相关性重构为「必要条件 / 从属」两段（同一份 Dependency 数据的两个过滤方向）。
// 下面这些用例替换了上面那 5 条基于「←/→ 单列表」的旧用例 —— 交互形态变了（两段 + 两个
// 添加下拉），但覆盖的**契约**一条不少：建边（两个方向）/ 改类型 / 改 lag / 删除 /
// 候选过滤（同向才占用候选）/ 方向不搞反。断言强度只增不减。
describe('相关性组（必要条件 / 从属两段）', () => {
  it('分成「必要条件」与「从属」两段，各段有添加下拉', () => {
    renderInspector()
    expect(screen.getByText('必要条件（挡在我前面的）')).toBeInTheDocument()
    expect(screen.getByText('从属（我在挡的）')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '添加必要条件' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '添加从属' })).toBeInTheDocument()
  })

  it('两段在无依赖时都显示「无」', () => {
    renderInspector()
    expect(within(screen.getByTestId('relation-predecessors')).getByText('无')).toBeInTheDocument()
    expect(within(screen.getByTestId('relation-successors')).getByText('无')).toBeInTheDocument()
  })

  it('在「必要条件」里添加：候选 → 本任务，且只落在「必要条件」段', async () => {
    const user = userEvent.setup()
    renderInspector()

    await chooseOption(user, '添加必要条件', '写代码', 'add-predecessor')

    const deps = Object.values(useProjectStore.getState().project!.dependencies)
    expect(deps).toHaveLength(1)
    expect(deps[0]).toMatchObject({ fromTaskId: siblingId, toTaskId: taskId, type: 'FS', lag: 0 })

    // 方向不搞反：这条前驱渲染在「必要条件」段，而**不在**「从属」段。
    // 只断言「出现在列表里」是恒真的 —— 两段都会把依赖名渲染出来；必须限定到具体那一段。
    const predSection = screen.getByTestId('relation-predecessors')
    const succSection = screen.getByTestId('relation-successors')
    expect(within(predSection).getByText('写代码')).toBeInTheDocument()
    expect(within(succSection).queryByText('写代码')).not.toBeInTheDocument()
  })

  it('在「从属」里添加：本任务 → 候选，且只落在「从属」段', async () => {
    const user = userEvent.setup()
    renderInspector()

    await chooseOption(user, '添加从属', '写代码', 'add-successor')

    const deps = Object.values(useProjectStore.getState().project!.dependencies)
    expect(deps).toHaveLength(1)
    expect(deps[0]).toMatchObject({ fromTaskId: taskId, toTaskId: siblingId, type: 'FS', lag: 0 })

    // 与上一条镜像：同一条数据、相反方向，渲染段必须跟着反过来（方向搞反就红）
    const predSection = screen.getByTestId('relation-predecessors')
    const succSection = screen.getByTestId('relation-successors')
    expect(within(succSection).getByText('写代码')).toBeInTheDocument()
    expect(within(predSection).queryByText('写代码')).not.toBeInTheDocument()
  })

  it('已在某候选连过前驱时，它从「必要条件」候选里消失（另一段不受影响）', () => {
    const project = useProjectStore.getState().project!
    const dep = createDependency(siblingId, taskId, 'FS', 0)
    useProjectStore.setState({
      project: { ...project, dependencies: { ...project.dependencies, [dep.id]: dep } },
    })
    renderInspector()

    expect(screen.queryByRole('combobox', { name: '添加必要条件' })).not.toBeInTheDocument()
    // 从属段的候选仍是「写代码」——那是一条合法的新边
    expect(screen.getByRole('combobox', { name: '添加从属' })).toBeInTheDocument()
  })

  it('反向边不占用候选：「本任务 → 写代码」不影响「必要条件」的候选', () => {
    const project = useProjectStore.getState().project!
    const dep = createDependency(taskId, siblingId, 'FS', 0) // 出边：本任务 → 写代码
    useProjectStore.setState({
      project: { ...project, dependencies: { ...project.dependencies, [dep.id]: dep } },
    })
    renderInspector()

    // 同向才占候选：出边不该把「写代码」从前驱候选里抹掉（它仍是一条合法的入边）
    expect(screen.getByRole('combobox', { name: '添加必要条件' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '写代码', hidden: true })).toBeInTheDocument()
  })

  it('行内改类型与 lag、删除依赖都能生效', async () => {
    const user = userEvent.setup()
    renderInspector()

    await chooseOption(user, '添加必要条件', '写代码', 'add-predecessor')

    await chooseOption(user, '必要条件（挡在我前面的） 写代码', 'SS')

    const lagInput = screen.getByLabelText('延迟 写代码')
    await user.clear(lagInput)
    await user.type(lagInput, '2')

    const dep = Object.values(useProjectStore.getState().project!.dependencies)[0]
    expect(dep.type).toBe('SS')
    expect(dep.lag).toBe(2)

    await user.click(screen.getByLabelText('删除依赖 写代码'))
    expect(Object.values(useProjectStore.getState().project!.dependencies)).toHaveLength(0)
    // 删除后两段都回到空态（既有用例原本也断言了「列表里那条消失」，这里以空态文案承接）
    expect(within(screen.getByTestId('relation-predecessors')).getByText('无')).toBeInTheDocument()
    expect(within(screen.getByTestId('relation-successors')).getByText('无')).toBeInTheDocument()
  })

  it('摘要任务不渲染添加下拉（日期由子任务汇总）', () => {
    useViewStore.setState({ selectedTaskId: parentId })
    renderInspector()
    expect(screen.queryByRole('combobox', { name: '添加必要条件' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '添加从属' })).not.toBeInTheDocument()
  })
})

// v0.5 Task 6：投入/成本解禁为派生只读量，并新增「工作量模式 + 投入」编辑入口（spec §5）。
describe('工作量模式与投入', () => {
  it('切到「固定工作量」后出现投入输入，改投入会改工期（反解）', async () => {
    const user = userEvent.setup()
    renderInspector()

    await user.click(screen.getByTestId('effort-mode-effort'))
    const task = useProjectStore.getState().project!.tasks[taskId]
    expect(task.effortMode).toBe('fixedEffort')
    // 切模式时以「工期 × max(Σunits,1)」初始化 effort（无资源 → 3 × 1 = 3）
    expect(task.effort).toBe(3)

    const input = screen.getByLabelText('投入')
    await user.clear(input)
    await user.type(input, '9')
    expect(useProjectStore.getState().project!.tasks[taskId].effort).toBe(9)
  })
})

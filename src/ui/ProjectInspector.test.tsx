import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'

import { initCommands, __resetRegistryForTests } from '../commands/registry'
import { createDependency, createProject, createTask } from '../domain/model/factories'
import { solve } from '../domain/scheduler'
import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'
import { ProjectInspector } from './ProjectInspector'
import i18n from '../i18n'

function renderProjectInspector() {
  return render(
    <MantineProvider>
      <ProjectInspector />
    </MantineProvider>,
  )
}

async function chooseOption(
  user: ReturnType<typeof userEvent.setup>,
  selectLabel: string,
  optionLabel: string,
) {
  await user.click(screen.getByRole('combobox', { name: selectLabel }))
  fireEvent.click(screen.getByRole('option', { name: optionLabel, hidden: true }))
}

beforeEach(async () => {
  __resetRegistryForTests()
  initCommands()
  await i18n.changeLanguage('zh-CN')

  const project = createProject('测试项目', '2026-03-02')
  const a = createTask({ name: 'A', duration: 3 })
  const b = createTask({ name: 'B', duration: 2 })
  project.tasks[a.id] = a
  project.tasks[b.id] = b
  project.rootIds = [a.id, b.id]
  const dep = createDependency(a.id, b.id)
  project.dependencies[dep.id] = dep

  useProjectStore.setState({ project, undoStack: [], redoStack: [], lastError: null })
  useScheduleStore.setState({ result: solve(project), error: null })
})

describe('ProjectInspector', () => {
  it('名称写回 project.rename', async () => {
    const user = userEvent.setup()
    renderProjectInspector()

    const input = screen.getByLabelText('名称')
    await user.clear(input)
    await user.type(input, '新名字')

    expect(useProjectStore.getState().project!.name).toBe('新名字')
  })

  it('方向下拉写回 schedulingDirection', async () => {
    const user = userEvent.setup()
    renderProjectInspector()

    await chooseOption(user, '排期方向', '从固定结束时间向后')
    expect(useProjectStore.getState().project!.schedulingDirection).toBe('backward')
  })

  it('forward 下开始日期可编辑；backward 下只读并说明（偏差 4）', async () => {
    const user = userEvent.setup()
    renderProjectInspector()

    expect(screen.getByLabelText('开始日期')).not.toBeDisabled()

    await chooseOption(user, '排期方向', '从固定结束时间向后')
    expect(screen.getByLabelText('开始日期')).toBeDisabled()
    expect(screen.getByText(/由引擎推导/)).toBeInTheDocument()
    // 方向切换只影响「开始日期」——「结束日期」在两个方向下都仍是可编辑输入
    expect(screen.getByLabelText('结束日期')).not.toBeDisabled()
  })

  it('结束日期在两个方向下都可编辑，写回 endDate；清空即无期限', () => {
    renderProjectInspector()

    const input = screen.getByLabelText('结束日期')
    fireEvent.change(input, { target: { value: '2026-06-30' } })
    expect(useProjectStore.getState().project!.endDate).toBe('2026-06-30')

    fireEvent.change(input, { target: { value: '' } })
    expect(useProjectStore.getState().project!.endDate).toBeUndefined()
  })

  it('摘要显示项目跨度、总工作日与任务数', () => {
    renderProjectInspector()
    // A: 03-02..03-04，B: 03-05..03-06 → 03-02..03-06 = 5 个工作日
    expect(screen.getByText(/项目跨度：2026-03-02 → 2026-03-06/)).toBeInTheDocument()
    expect(screen.getByText(/总工作日：5/)).toBeInTheDocument()
    expect(screen.getByText(/任务数：2/)).toBeInTheDocument()
  })

  it('投入单位换算可编辑并写回 hoursPerDay；货币是只读事实行而非禁用控件', () => {
    renderProjectInspector()

    const conversion = screen.getByLabelText('投入单位转换')
    expect(conversion).not.toHaveAttribute('readonly')

    // NumberInput 的 clear 在 jsdom 里不稳定（min 的回填会黏住旧值），改用 fireEvent.change
    fireEvent.change(conversion, { target: { value: '6' } })
    expect(useProjectStore.getState().project!.calendars.default.hoursPerDay).toBe(6)

    // §3.3：货币曾是一个禁用的空 Select（「用控件表达数据」），现为只读事实行。
    // 区分性断言：一旦有人把它改回 Select，这条 queryByRole 就会命中、立刻变红。
    expect(screen.queryByRole('combobox', { name: '货币' })).not.toBeInTheDocument()
    // 无此概念 → 弱化的 `—`（不是空 Select 的空白，也不是「0」）
    expect(screen.getByTestId('project-currency')).toHaveTextContent('—')
    // v1.0 是路线图最后一版，货币与格式再也指不出一个真实版本 → 写「尚未排期」（偏差 6）
    expect(screen.getByText(/尚未排期/)).toBeInTheDocument()
    expect(screen.queryByText(/v1\.0/)).not.toBeInTheDocument()
  })

  it('基准日输入框写入 project.statusDate；清空即删除该字段（不是空串）', () => {
    renderProjectInspector()

    // 缺省未设 → 值显示为空串
    expect(screen.getByLabelText('基准日')).toHaveValue('')

    fireEvent.change(screen.getByLabelText('基准日'), { target: { value: '2026-03-04' } })
    expect(useProjectStore.getState().project!.statusDate).toBe('2026-03-04')

    // 清空 = 未设基准日（PV / SV 不可算）—— 必须是 undefined，不能留 ''
    fireEvent.change(screen.getByLabelText('基准日'), { target: { value: '' } })
    expect(useProjectStore.getState().project!.statusDate).toBeUndefined()
  })

  it('基准日 hint 说明 EVM 以之为界（不出现裸 key）', () => {
    renderProjectInspector()
    expect(screen.getByText(/基准日为界/)).toBeInTheDocument()
  })
})

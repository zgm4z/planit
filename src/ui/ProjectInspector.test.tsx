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

  it('投入单位换算只读地取 calendar.hoursPerDay；货币禁用并注明版本', () => {
    renderProjectInspector()
    const conversion = screen.getByLabelText('投入单位转换')
    expect(conversion).toHaveValue('1 工作日 = 8 小时')
    expect(conversion).toHaveAttribute('readonly')

    // Mantine 9 的（禁用）Select 会把 options 的 listbox 容器也挂上 label 关联，
    // 于是 getByLabelText('货币') 命中两个节点 —— 用 role 收窄到输入框本身（与全库对 Select 的查法一致）。
    expect(screen.getByRole('combobox', { name: '货币' })).toBeDisabled()
    expect(screen.getByText(/货币与格式将在 v0\.5 提供/)).toBeInTheDocument()
  })
})

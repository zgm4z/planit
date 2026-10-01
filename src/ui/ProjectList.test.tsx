import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { initCommands, __resetRegistryForTests } from '../commands/registry'
import { createProject, __resetIdCounterForTests } from '../domain/model/factories'
import { deleteAllProjects, listProjects, saveProject } from '../persist/indexeddb'
import { useProjectStore } from '../store/projectStore'
import { __resetViewStoreForTests } from '../store/viewStore'
import { ProjectList } from './ProjectList'
import '../i18n'

function renderList() {
  return render(
    <MantineProvider>
      <ProjectList />
    </MantineProvider>,
  )
}

beforeEach(async () => {
  __resetRegistryForTests()
  initCommands()
  await deleteAllProjects()
  // id 计数器是模块级的，不在用例间复位就会让「刷新后新建」那条测试
  // 依赖执行顺序而假绿（前几条用例的 createProject 已经把它推高）
  __resetIdCounterForTests()
  useProjectStore.setState({ project: null, undoStack: [], redoStack: [], lastError: null })
  __resetViewStoreForTests()
  await import('../i18n').then((m) => m.default.changeLanguage('zh-CN'))
})

describe('ProjectList', () => {
  it('空态显示提示文案', async () => {
    renderList()
    expect(await screen.findByText(/还没有任何计划/)).toBeInTheDocument()
  })

  it('列出已保存的项目', async () => {
    await saveProject(createProject('产品发布计划', '2026-03-02'))
    renderList()
    expect(await screen.findByText('产品发布计划')).toBeInTheDocument()
  })

  it('点击「新建计划」会创建并载入一个空项目', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(await screen.findByRole('button', { name: /新建计划/ }))

    await waitFor(() => expect(useProjectStore.getState().project).not.toBeNull())
    // 项目名走 i18n，且是当前语言
    expect(useProjectStore.getState().project?.name).toBe('未命名计划')
  })

  it('点击已有项目会把它载入 store', async () => {
    const saved = createProject('已存在的计划', '2026-03-02')
    await saveProject(saved)

    const user = userEvent.setup()
    renderList()
    await user.click(await screen.findByText('已存在的计划'))

    await waitFor(() => expect(useProjectStore.getState().project?.id).toBe(saved.id))
  })

  it('刷新后新建第二个项目不会覆盖第一个', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(await screen.findByRole('button', { name: /新建计划/ }))
    await waitFor(() => expect(useProjectStore.getState().project).not.toBeNull())
    const firstId = useProjectStore.getState().project!.id

    // 模拟页面刷新：组件卸载 + id 计数器归零 + store 清空
    cleanup()
    __resetIdCounterForTests()
    useProjectStore.setState({ project: null, undoStack: [], redoStack: [], lastError: null })

    renderList()
    await user.click(await screen.findByRole('button', { name: /新建计划/ }))
    await waitFor(() => expect(useProjectStore.getState().project).not.toBeNull())

    const secondId = useProjectStore.getState().project!.id
    expect(secondId).not.toBe(firstId)

    // 关键断言：两个项目都在
    expect(await listProjects()).toHaveLength(2)
  })
})

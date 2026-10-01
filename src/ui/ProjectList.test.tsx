import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { initCommands, __resetRegistryForTests } from '../commands/registry'
import { createProject } from '../domain/model/factories'
import { deleteAllProjects, saveProject } from '../persist/indexeddb'
import { useProjectStore } from '../store/projectStore'
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
  useProjectStore.setState({ project: null, undoStack: [], redoStack: [], lastError: null })
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
})

import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import type { VirtualItem } from '@tanstack/react-virtual'

import { createProject, createTask, __resetIdCounterForTests } from '../domain/model/factories'
import type { Project } from '../domain/model/types'
import { flattenVisibleRows } from './flattenRows'
import { DEFAULT_VISIBLE_COLUMNS, OUTLINE_COLUMNS } from './outlineColumns'
import { OutlineTable } from './OutlineTable'
import { ROW_HEIGHT } from './useSharedVirtualizer'
import { useViewStore, __resetViewStoreForTests } from '../store/viewStore'
import i18n from '../i18n'

let project: Project
let taskId: string

function columnsFrom(keys: string[]) {
  return OUTLINE_COLUMNS.filter((column) => keys.includes(column.key))
}

function renderTable(keys = DEFAULT_VISIBLE_COLUMNS) {
  const rows = flattenVisibleRows(project, new Set())
  const virtualItems: VirtualItem[] = rows.map((_, index) => ({
    index,
    key: index,
    start: index * ROW_HEIGHT,
    size: ROW_HEIGHT,
    end: (index + 1) * ROW_HEIGHT,
    lane: 0,
  }))
  return render(
    <MantineProvider>
      <OutlineTable
        project={project}
        rows={rows}
        virtualItems={virtualItems}
        schedules={{}}
        columns={columnsFrom(keys)}
        selectedTaskId={null}
        onSelect={() => {}}
        onToggleCollapse={() => {}}
      />
    </MantineProvider>,
  )
}

beforeEach(async () => {
  __resetIdCounterForTests()
  await i18n.changeLanguage('zh-CN')
  localStorage.clear()
  __resetViewStoreForTests()

  project = createProject('测试', '2026-03-02')
  const task = createTask({ name: '写文档', duration: 3 })
  project.tasks[task.id] = task
  project.rootIds = [task.id]
  taskId = task.id
})

describe('OutlineTable', () => {
  it('每个可见列出且只出一个表头单元格，文案走 i18n', () => {
    renderTable()

    expect(screen.getAllByTestId(/^outline-col-/)).toHaveLength(DEFAULT_VISIBLE_COLUMNS.length)
    expect(screen.getByTestId('outline-col-title')).toHaveTextContent('标题')
    expect(screen.getByTestId('outline-col-duration')).toHaveTextContent('工期')
    // 没开的列不出表头
    expect(screen.queryByTestId('outline-col-progress')).not.toBeInTheDocument()
  })

  /**
   * 表头与正文单元格**逐列对齐**的不变量：两者都读 `cellFlex(column)`，
   * 但「宽度算得一样」肉眼看不见 —— 这里钉住更根本的一条：两边的**列集合与顺序
   * 完全一致**。此前只有「表头数量 == DEFAULT_VISIBLE_COLUMNS.length」这种计数断言，
   * 反转表头顺序、或表头漏渲染最后一列，都能蒙混过关。
   *
   * 注意选择器：甘特左列的容器 testid 是 `outline-column`（ProjectView），
   * 它在 `col` 后面是 `u` 而不是 `-`，因此 `/^outline-col-/` 不会误匹配它。
   */
  it('表头列与首行单元格逐列对齐、顺序一致', () => {
    const { container } = renderTable()

    // 表头列 key（按渲染顺序）：`outline-col-<key>` → `<key>`
    const headerKeys = screen
      .getAllByTestId(/^outline-col-/)
      .map((cell) => cell.getAttribute('data-testid')!.slice('outline-col-'.length))

    // 首行单元格 key（按渲染顺序）：`outline-cell-<key>-<taskId>` → `<key>`
    const row = container.querySelector(`[data-testid="outline-row-${taskId}"]`)
    expect(row).not.toBeNull()
    const cellKeys = Array.from(
      row!.querySelectorAll('[data-testid^="outline-cell-"]'),
    ).map((cell) =>
      cell.getAttribute('data-testid')!.slice('outline-cell-'.length, -taskId.length - 1),
    )

    expect(cellKeys).toEqual(headerKeys)
    // 且确实有内容可比 —— 免得两边同为 [] 而「假绿」
    expect(headerKeys).toEqual(DEFAULT_VISIBLE_COLUMNS)
  })

  it('表头与行都渲染在表格容器里', () => {
    renderTable()
    expect(screen.getByTestId('outline-table')).toBeInTheDocument()
    expect(screen.getByTestId('outline-table-header')).toBeInTheDocument()
    expect(screen.getByTestId(`outline-row-${taskId}`)).toBeInTheDocument()
  })

  it('切到英文后表头文案跟随', async () => {
    await i18n.changeLanguage('en-US')
    renderTable()
    expect(screen.getByTestId('outline-col-title')).toHaveTextContent('Title')
    expect(screen.getByTestId('outline-col-start')).toHaveTextContent('Start')
  })
})

/**
 * 菜单是**浮层**交互。jsdom 里 Mantine 的浮层「不显形」（计算样式停在 display:none，
 * 见 Inspector.test.tsx 的 chooseOption 注释），但**展开后 DOM 是真实挂载的** ——
 * 所以这里用 fireEvent 打开菜单、再断言菜单项的 DOM 与状态是可行的。
 * 「能不能看得见」由 Task 7 的 e2e 验收。
 */
async function openMenu() {
  fireEvent.contextMenu(screen.getByTestId('outline-table-header'))
  // 展开后 Dropdown 才挂载；等一帧让 Transition 走完挂载
  await screen.findByTestId('column-menu')
}

describe('OutlineTable 的列菜单', () => {
  it('右键表头打开菜单，列出全部 27 列（11 可用 + 16 禁用）', async () => {
    renderTable()
    expect(screen.queryByTestId('column-menu')).not.toBeInTheDocument()

    await openMenu()

    expect(screen.getAllByTestId(/^column-menu-item-/)).toHaveLength(OUTLINE_COLUMNS.length)
    expect(screen.getAllByTestId(/^column-menu-item-/)).toHaveLength(27)
    // 菜单里没有跨项目依赖条目 —— 它不是列，注册表里根本没有这个 key
    expect(OUTLINE_COLUMNS.some((column) => column.key.includes('crossProject'))).toBe(false)
  })

  it('禁用列是 disabled，且被一个非禁用的宿主包着（Tooltip 要挂在它上面）', async () => {
    renderTable()
    await openMenu()

    expect(screen.getByTestId('column-menu-item-effort')).toBeDisabled()
    // 禁用的 <button> 不派发鼠标事件，Tooltip 必须挂在这个 span 上 ——
    // 它的存在就是「tooltip 有机会显示」的证据（文案本身由 e2e 断言）
    const host = screen.getByTestId('column-menu-disabledwrap-effort')
    expect(host.tagName).toBe('SPAN')
  })

  it('title 项被禁用（不可取消）', async () => {
    renderTable()
    await openMenu()

    expect(screen.getByTestId('column-menu-item-title')).toBeDisabled()
  })

  it('点击可用列切换显隐，并写回 store 与 localStorage', async () => {
    const user = userEvent.setup()
    renderTable()
    await openMenu()

    await user.click(screen.getByTestId('column-menu-item-progress'))
    expect(useViewStore.getState().visibleColumns).toContain('progress')
    expect(localStorage.getItem('planit.outlineColumns')).toContain('progress')

    await user.click(screen.getByTestId('column-menu-item-progress'))
    expect(useViewStore.getState().visibleColumns).not.toContain('progress')
  })

  // 「title 不可取消」这条不变量的判别力在菜单项的 disabled 断言与 viewStore 的
  // normalize 断言里，不在这里重复。
})

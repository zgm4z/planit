import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import type { VirtualItem } from '@tanstack/react-virtual'

import { createProject, createTask, __resetIdCounterForTests } from '../domain/model/factories'
import type { Project } from '../domain/model/types'
import { flattenVisibleRows } from './flattenRows'
import { DEFAULT_VISIBLE_COLUMNS, OUTLINE_COLUMNS } from './outlineColumns'
import { OutlineTable } from './OutlineTable'
import { ROW_HEIGHT } from './useSharedVirtualizer'
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

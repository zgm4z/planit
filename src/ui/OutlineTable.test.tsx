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

import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'

import type { AssignmentGroup, AssignmentLeaf } from '../shared/assignmentGroups'
import { ResourceAssignmentList, type ResourceAssignmentListProps } from './ResourceAssignmentList'
import i18n from '../../i18n'

const alice: AssignmentLeaf = { id: 'r-alice', name: '张三', kind: 'staff', assignedCount: 3 }
const bob: AssignmentLeaf = { id: 'r-bob', name: '李四', kind: 'staff', assignedCount: 0 }
const partial: AssignmentLeaf = { id: 'r-partial', name: '王五', kind: 'staff', assignedCount: 1 }
const group: AssignmentGroup = { id: 'g1', name: '施工组', members: [alice, bob], assignedCount: 3 }

function renderList(overrides: Partial<ResourceAssignmentListProps> = {}) {
  const onToggle = vi.fn()
  const onClear = vi.fn()
  render(
    <MantineProvider>
      <ResourceAssignmentList
        groups={[group]}
        ungrouped={[partial]}
        taskCount={3}
        onToggle={onToggle}
        onClear={onClear}
        hasAnyAssignment
        {...overrides}
      />
    </MantineProvider>,
  )
  return { onToggle, onClear }
}

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
})

describe('ResourceAssignmentList 三态', () => {
  it('全部任务都有 → 全选；部分有 → 半选；都没有 → 未选', () => {
    renderList()
    expect(screen.getByTestId('assignment-resource-r-alice')).toBeChecked()
    expect(screen.getByTestId('assignment-resource-r-partial')).toHaveAttribute(
      'data-indeterminate',
      'true',
    )
    expect(screen.getByTestId('assignment-resource-r-bob')).not.toBeChecked()
  })

  it('组头显示「N 人 · 已分配 M」', () => {
    renderList()
    expect(screen.getByTestId('assignment-group-g1')).toHaveTextContent('施工组')
    expect(screen.getByTestId('assignment-group-g1')).toHaveTextContent('2 人 · 已分配 3')
  })

  it('勾选一行回调 onToggle(resourceId)', async () => {
    const user = userEvent.setup()
    const { onToggle } = renderList()
    await user.click(screen.getByTestId('assignment-resource-r-bob'))
    expect(onToggle).toHaveBeenCalledWith('r-bob')
  })

  it('折叠组后成员不渲染，再展开回来', async () => {
    const user = userEvent.setup()
    renderList()
    await user.click(screen.getByTestId('assignment-group-toggle-g1'))
    expect(screen.queryByTestId('assignment-resource-r-alice')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('assignment-group-toggle-g1'))
    expect(screen.getByTestId('assignment-resource-r-alice')).toBeInTheDocument()
  })

  it('搜索按名过滤并自动展开命中的组', async () => {
    const user = userEvent.setup()
    renderList()
    // 先折叠组，再搜索 —— 过滤态下必须被强制展开
    await user.click(screen.getByTestId('assignment-group-toggle-g1'))
    await user.type(screen.getByTestId('assignment-search'), '张三')
    expect(screen.getByTestId('assignment-resource-r-alice')).toBeInTheDocument()
    expect(screen.queryByTestId('assignment-resource-r-bob')).not.toBeInTheDocument()
  })

  it('搜索无结果 → 空态文案（区别于「无资源」）', async () => {
    const user = userEvent.setup()
    renderList()
    await user.type(screen.getByTestId('assignment-search'), '不存在的名字')
    expect(screen.getByTestId('assignment-no-results')).toBeInTheDocument()
  })

  it('无资源 → 「还没有资源」空态', () => {
    renderList({ groups: [], ungrouped: [] })
    expect(screen.getByText('还没有资源')).toBeInTheDocument()
  })

  it('「清除分配」不可清时禁用；可清时点击回调 onClear', async () => {
    const user = userEvent.setup()
    // 第一次渲染：不可清 → 禁用
    renderList({ hasAnyAssignment: false })
    expect(screen.getByTestId('assignment-clear')).toBeDisabled()

    // 第二次渲染（RTL 不自动清理，DOM 里有两份）：可清 → 点它回调自己那份 onClear
    const { onClear } = renderList({ hasAnyAssignment: true })
    const buttons = screen.getAllByTestId('assignment-clear')
    await user.click(buttons[buttons.length - 1])
    expect(onClear).toHaveBeenCalled()
  })
})

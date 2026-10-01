import { useTranslation } from 'react-i18next'
import { Menu, Tooltip } from '@mantine/core'
import { IconCheck } from '@tabler/icons-react'
import type { VirtualItem } from '@tanstack/react-virtual'
import type { ComputedSchedule, Project, TaskId } from '../domain/model/types'
import type { FlatRow } from './flattenRows'
import { cellFlex, OUTLINE_COLUMNS, type OutlineColumn } from './outlineColumns'
import { useViewStore } from '../store/viewStore'
import { OutlineTree } from './OutlineTree'
import styles from './styles/ProjectView.module.scss'

interface OutlineTableProps {
  project: Project
  rows: FlatRow[]
  virtualItems: VirtualItem[]
  schedules: Record<TaskId, ComputedSchedule>
  /** 已按注册表顺序排好的可见列 */
  columns: OutlineColumn[]
  selectedTaskId: TaskId | null
  onSelect: (taskId: TaskId) => void
  onToggleCollapse: (taskId: TaskId) => void
}

/**
 * 大纲视图的全宽表格：sticky 表头 + 共用的行渲染（OutlineTree）。
 *
 * 表格容器 `width: max-content; min-width: 100%`（见 SCSS）—— 列的总宽超出视口时
 * 由外层滚动容器横向滚动，此时 `title` 列（表头与单元格）`position: sticky; left: 0`
 * 钉在左缘（spec §4.4）。
 */
export function OutlineTable({
  project,
  rows,
  virtualItems,
  schedules,
  columns,
  selectedTaskId,
  onSelect,
  onToggleCollapse,
}: OutlineTableProps) {
  const { t } = useTranslation()
  const visibleColumns = useViewStore((state) => state.visibleColumns)
  const toggleColumn = useViewStore((state) => state.toggleColumn)

  return (
    <div className={styles.outlineTable} data-testid="outline-table">
      {/* 表头菜单只由右键打开（Menu.ContextMenu），左键不触发。 */}
      <Menu closeOnItemClick={false} withinPortal data-testid="column-menu-root">
        {/* 右键表头任意处即打开菜单（Menu.ContextMenu 按光标定位）。
            必须是单个接受 ref 的元素 —— 因此包住整个表头，而不是逐个单元格包。 */}
        <Menu.ContextMenu>
          <div className={styles.outlineHeader} data-testid="outline-table-header">
            {columns.map((column) => (
              <div
                key={column.key}
                className={`${styles.outlineHeaderCell} ${
                  column.key === 'title' ? styles.outlineHeaderCellSticky : ''
                }`}
                style={{ flex: cellFlex(column) }}
                data-testid={`outline-col-${column.key}`}
              >
                {t(column.labelKey)}
              </div>
            ))}
          </div>
        </Menu.ContextMenu>

        <Menu.Dropdown data-testid="column-menu">
          <Menu.Label>{t('outline.menu.title')}</Menu.Label>

          {OUTLINE_COLUMNS.map((column) => {
            const isTitle = column.key === 'title'
            // 禁用列（依赖未实现的功能）+ title（不允许取消）都点不动，
            // 但都必须**显示**：用户要能看出「这里以后会有东西」（分批原则）
            const disabled = !column.enabled || isTitle
            const reasonKey = isTitle ? 'outline.menu.titleLocked' : column.disabledReasonKey
            const item = (
              <Menu.Item
                key={column.key}
                data-testid={`column-menu-item-${column.key}`}
                disabled={disabled}
                leftSection={
                  visibleColumns.includes(column.key) ? (
                    <IconCheck size={14} />
                  ) : (
                    <span style={{ width: 14 }} />
                  )
                }
                onClick={() => toggleColumn(column.key)}
              >
                {t(column.labelKey)}
              </Menu.Item>
            )

            if (!disabled) return item

            // Tooltip 要挂在一个非禁用的宿主上 —— 禁用的 <button> 不派发鼠标事件，
            // 直接给 Menu.Item 套 Tooltip 是看不见的（悬停永远不会触发）。
            return (
              <Tooltip
                key={column.key}
                label={t(reasonKey!)}
                position="right"
                withinPortal
                openDelay={200}
              >
                <span
                  data-testid={`column-menu-disabledwrap-${column.key}`}
                  style={{ display: 'block' }}
                >
                  {item}
                </span>
              </Tooltip>
            )
          })}
        </Menu.Dropdown>
      </Menu>

      <OutlineTree
        project={project}
        rows={rows}
        virtualItems={virtualItems}
        schedules={schedules}
        columns={columns}
        selectedTaskId={selectedTaskId}
        onSelect={onSelect}
        onToggleCollapse={onToggleCollapse}
      />
    </div>
  )
}

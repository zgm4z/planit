import { useTranslation } from 'react-i18next'
import type { VirtualItem } from '@tanstack/react-virtual'
import type { ComputedSchedule, Project, TaskId } from '../domain/model/types'
import type { FlatRow } from './flattenRows'
import type { OutlineColumn } from './outlineColumns'
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

/** 转成 CSS 的 flex 值（与 OutlineTree 同一规则 —— 表头与单元格必须逐列对齐） */
function cellFlex(column: OutlineColumn): string {
  return column.flex ? `1 1 ${column.width}px` : `0 0 ${column.width}px`
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

  return (
    <div className={styles.outlineTable} data-testid="outline-table">
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

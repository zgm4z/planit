import { useTranslation } from 'react-i18next'
import type { VirtualItem } from '@tanstack/react-virtual'
import type { Project, TaskId } from '../domain/model/types'
import type { FlatRow } from './flattenRows'
import { ROW_HEIGHT } from './useSharedVirtualizer'
import styles from './styles/ProjectView.module.scss'

interface OutlineTreeProps {
  project: Project
  rows: FlatRow[]
  virtualItems: VirtualItem[]
  selectedTaskId: TaskId | null
  onSelect: (taskId: TaskId) => void
  onToggleCollapse: (taskId: TaskId) => void
}

export function OutlineTree({
  project,
  rows,
  virtualItems,
  selectedTaskId,
  onSelect,
  onToggleCollapse,
}: OutlineTreeProps) {
  const { t } = useTranslation()

  return (
    <div className={styles.virtualLayer} style={{ height: rows.length * ROW_HEIGHT }}>
      {virtualItems.map((item) => {
        const row = rows[item.index]
        if (!row) return null

        const task = project.tasks[row.taskId]
        if (!task) return null

        const selected = row.taskId === selectedTaskId

        return (
          <div
            key={item.key}
            className={`${styles.outlineRow} ${selected ? styles.outlineRowSelected : ''}`}
            style={{ transform: `translateY(${item.start}px)`, height: item.size }}
            onClick={() => onSelect(row.taskId)}
            data-testid={`outline-row-${row.taskId}`}
          >
            <span
              className={styles.outlineRowInner}
              style={{ paddingLeft: 8 + row.depth * 16 }}
            >
              {row.hasChildren ? (
                <button
                  type="button"
                  className={styles.outlineToggle}
                  aria-label={t(row.collapsed ? 'outline.expand' : 'outline.collapse')}
                  onClick={(event) => {
                    event.stopPropagation()
                    onToggleCollapse(row.taskId)
                  }}
                >
                  {row.collapsed ? '▸' : '▾'}
                </button>
              ) : (
                <span style={{ width: 14 }} />
              )}

              {task.isMilestone && (
                <span className={styles.milestoneGlyph} aria-hidden>
                  ◆
                </span>
              )}

              <span
                className={`${styles.outlineName} ${row.hasChildren ? styles.outlineNameSummary : ''}`}
              >
                {task.name}
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

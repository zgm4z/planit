import { useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'

import { flattenVisibleRows } from './flattenRows'
import { OutlineTree } from './OutlineTree'
import { Toolbar } from './Toolbar'
import { useSharedVirtualizer, ROW_HEIGHT } from './useSharedVirtualizer'
import { useProjectStore } from '../store/projectStore'
import { useViewStore } from '../store/viewStore'
import { useTranslation } from 'react-i18next'
import styles from './styles/ProjectView.module.scss'

export function ProjectView() {
  const { t } = useTranslation()

  const project = useProjectStore((state) => state.project)
  const collapsedIds = useViewStore((state) => state.collapsedIds)
  const selectedTaskId = useViewStore((state) => state.selectedTaskId)
  const selectTask = useViewStore((state) => state.selectTask)
  const toggleCollapsed = useViewStore((state) => state.toggleCollapsed)
  const dayWidth = useViewStore((state) => state.dayWidth)

  const scrollRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(
    () => (project ? flattenVisibleRows(project, collapsedIds) : []),
    [project, collapsedIds],
  )

  // 两侧列消费同一份 virtualItems —— 行永远对齐
  const virtualItems = useSharedVirtualizer(scrollRef, rows.length)

  if (!project) return null

  const ganttWidth = Math.max(60, rows.length * 2) * dayWidth

  return (
    <div className={styles.view}>
      <Toolbar />

      <div className={styles.body}>
        <div className={styles.scroll} ref={scrollRef} data-testid="shared-scroll">
          <div
            className={styles.grid}
            style={{ '--gantt-width': `${ganttWidth}px` } as CSSProperties}
          >
            <div className={styles.corner} data-testid="outline-header">
              {t('outline.columnTitle')}
            </div>

            <div className={styles.ruler} data-testid="gantt-ruler">
              {/* 时间刻度尺在 Task 16 实现 */}
            </div>

            <div className={styles.outline} data-testid="outline-column">
              <OutlineTree
                project={project}
                rows={rows}
                virtualItems={virtualItems}
                selectedTaskId={selectedTaskId}
                onSelect={selectTask}
                onToggleCollapse={toggleCollapsed}
              />
            </div>

            <div className={styles.gantt} style={{ height: rows.length * ROW_HEIGHT }}>
              {/* 任务条与网格在 Task 16 实现 —— 这里先渲染与左列同源的虚拟行，
                  用于验证左右行严格对齐（data-gantt-row 供自动化断言取几何） */}
              <div className={styles.virtualLayer} style={{ height: rows.length * ROW_HEIGHT }}>
                {virtualItems.map((item) => {
                  const row = rows[item.index]
                  if (!row) return null

                  return (
                    <div
                      key={item.key}
                      className={styles.ganttRow}
                      style={{ transform: `translateY(${item.start}px)`, height: item.size }}
                      data-gantt-row={row.taskId}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Inspector 在 Task 19 接入 */}
      </div>
    </div>
  )
}

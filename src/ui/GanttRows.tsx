import type { VirtualItem } from '@tanstack/react-virtual'
import type { Calendar, ComputedSchedule, Project, TaskId } from '../domain/model/types'
import { TaskBar, type BarDragMode } from './TaskBar'
import type { TimelineScale } from './timeline'
import type { FlatRow } from './flattenRows'
import { ROW_HEIGHT } from './useSharedVirtualizer'
import styles from './styles/GanttPane.module.scss'

interface GanttRowsProps {
  project: Project
  calendar: Calendar
  rows: FlatRow[]
  virtualItems: VirtualItem[]
  schedules: Record<TaskId, ComputedSchedule>
  conflictIds: ReadonlySet<TaskId>
  scale: TimelineScale
  /** 拖拽期间的影子排期 */
  dragOverride: { taskId: TaskId; startDate: string; duration: number } | null
  onBarPointerDown: (event: React.PointerEvent, taskId: TaskId, mode: BarDragMode) => void
  onStartLink: (event: React.PointerEvent, taskId: TaskId, x: number, y: number) => void
}

/** 右侧任务条层。与 OutlineTree 消费同一份 virtualItems，因此行永远对齐 */
export function GanttRows({
  project,
  calendar,
  rows,
  virtualItems,
  schedules,
  conflictIds,
  scale,
  dragOverride,
  onBarPointerDown,
  onStartLink,
}: GanttRowsProps) {
  return (
    <div style={{ position: 'relative', height: rows.length * ROW_HEIGHT }} data-testid="gantt-rows">
      {virtualItems.map((item) => {
        const row = rows[item.index]
        if (!row) return null

        const task = project.tasks[row.taskId]
        const schedule = schedules[row.taskId]

        // 摘要任务不画条：其日期由子任务汇总，画出来会与子任务条重叠
        if (!task || !schedule || task.childIds.length > 0) return null

        return (
          <div
            key={item.key}
            className={styles.row}
            style={{
              top: 0,
              height: item.size,
              transform: `translateY(${item.start}px)`,
            }}
            data-gantt-row={row.taskId}
          >
            <TaskBar
              task={task}
              schedule={schedule}
              scale={scale}
              calendar={calendar}
              hasConflict={conflictIds.has(task.id)}
              override={dragOverride?.taskId === task.id ? dragOverride : undefined}
              onBarPointerDown={(event, mode) => onBarPointerDown(event, task.id, mode)}
              onStartLink={(event, x, y) => onStartLink(event, task.id, x, y)}
            />
          </div>
        )
      })}
    </div>
  )
}

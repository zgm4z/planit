import type { Calendar, ComputedSchedule, Task } from '../domain/model/types'
import { addWorkdays } from '../domain/calendar/workdays'
import { barRect, type TimelineScale } from './timeline'
import { ROW_HEIGHT } from './useSharedVirtualizer'
import styles from './styles/GanttPane.module.scss'

export type BarDragMode = 'move' | 'resizeStart' | 'resizeEnd'

/**
 * 任务条高度与里程碑边长。DependencyLayer（Task 17）算连线端点时必须用同一组常量，
 * 否则连线会落在任务条上下缘之外 —— 从这里 import，不要再写一份字面量。
 */
export const BAR_HEIGHT = 16
export const MILESTONE_SIZE = 12

interface TaskBarProps {
  task: Task
  schedule: ComputedSchedule
  scale: TimelineScale
  calendar: Calendar
  hasConflict: boolean
  /** 拖拽期间的影子排期，非空时覆盖真实排期 */
  override?: { startDate: string; duration: number }
  onBarPointerDown?: (event: React.PointerEvent, mode: BarDragMode) => void
  onStartLink?: (event: React.PointerEvent, fromX: number, fromY: number) => void
}

export function TaskBar({
  task,
  schedule,
  scale,
  calendar,
  hasConflict,
  override,
  onBarPointerDown,
  onStartLink,
}: TaskBarProps) {
  const displayStart = override?.startDate ?? schedule.earlyStart
  const displayDuration = override?.duration ?? task.duration

  // 拖拽期间工期可能刚被改过，结束日期必须按新工期重算，
  // 不能沿用引擎算出的旧 earlyFinish（resizeEnd 时开始日期没变，但工期变了）
  const displayFinish = override
    ? addWorkdays(displayStart, Math.max(0, displayDuration - 1), calendar)
    : schedule.earlyFinish

  if (task.isMilestone) {
    return (
      <div
        className={`${styles.milestone} ${schedule.isCritical ? styles.milestoneCritical : ''}`}
        style={{ left: scale.xOf(displayStart), top: (ROW_HEIGHT - MILESTONE_SIZE) / 2 }}
        title={`${task.name} · ${displayStart}`}
        data-task-id={task.id}
        data-testid={`task-milestone-${task.id}`}
        onPointerDown={(event) => onBarPointerDown?.(event, 'move')}
      />
    )
  }

  // 横向定位走 barRect() —— DependencyLayer 复用同一个函数，端点才不会错位
  const { x, width } = barRect(scale, displayStart, displayFinish)

  return (
    <div
      className={`${styles.bar} ${schedule.isCritical && !hasConflict ? styles.barCritical : ''} ${
        hasConflict ? styles.barConflict : ''
      }`}
      style={{ left: x, top: (ROW_HEIGHT - BAR_HEIGHT) / 2, width, height: BAR_HEIGHT }}
      title={`${task.name}\n${displayStart} → ${displayFinish}`}
      data-task-id={task.id}
      data-testid={`task-bar-${task.id}`}
      onPointerDown={(event) => onBarPointerDown?.(event, 'move')}
    >
      <div
        className={styles.barProgress}
        style={{ width: `${task.progress}%` }}
        data-testid={`task-bar-progress-${task.id}`}
      />

      <div
        className={`${styles.barHandle} ${styles.barHandleLeft}`}
        onPointerDown={(event) => onBarPointerDown?.(event, 'resizeStart')}
      />
      <div
        className={`${styles.barHandle} ${styles.barHandleRight}`}
        onPointerDown={(event) => onBarPointerDown?.(event, 'resizeEnd')}
      />

      {/* 连接柄：从它拖出依赖连线（Task 17 接线） */}
      <div
        aria-label="drag-to-link"
        style={{
          position: 'absolute',
          right: -5,
          top: '50%',
          width: 10,
          height: 10,
          marginTop: -5,
          borderRadius: '50%',
          background: 'var(--planit-accent-strong)',
          border: '2px solid #fff',
          cursor: 'crosshair',
          zIndex: 3,
        }}
        onPointerDown={(event) =>
          onStartLink?.(event, event.currentTarget.getBoundingClientRect().right, event.clientY)
        }
      />
    </div>
  )
}

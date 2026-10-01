import type { Calendar, ComputedSchedule, Task } from '../domain/model/types'
import { addWorkdays } from '../domain/calendar/workdays'
import {
  BAR_HEIGHT,
  MILESTONE_SIZE,
  barRect,
  milestoneRect,
  type TimelineScale,
} from './timeline'
import { ROW_HEIGHT } from './useSharedVirtualizer'
import styles from './styles/GanttPane.module.scss'

export type BarDragMode = 'move' | 'resizeStart' | 'resizeEnd'

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
    // 几何全部来自 milestoneRect()（外接盒），DependencyLayer 用的是同一个函数
    const rect = milestoneRect(scale, displayStart)

    return (
      <div
        className={`${styles.milestone} ${schedule.isCritical ? styles.milestoneCritical : ''} ${
          hasConflict ? styles.milestoneConflict : ''
        } ${override ? styles.milestoneGhost : ''}`}
        style={{
          // AABB 比方块大 √2 倍，把方块中心对齐到 AABB 中心
          left: rect.x + (rect.width - MILESTONE_SIZE) / 2,
          top: rect.y + (rect.height - MILESTONE_SIZE) / 2,
          width: MILESTONE_SIZE,
          height: MILESTONE_SIZE,
        }}
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
      // 关键与冲突可以并存：barConflict 用的是 outline，与 background 不冲突。
      // （isCritical 定义为 slack === 0，而冲突要求 slack < 0，二者互斥，
      //   但这里不为互斥写守卫 —— 将来放宽 isCritical 时守卫会静默吞掉关键色。）
      className={`${styles.bar} ${schedule.isCritical ? styles.barCritical : ''} ${
        hasConflict ? styles.barConflict : ''
      } ${override ? styles.barGhost : ''}`}
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

      {override && (
        <div className={styles.dragHint} data-testid={`drag-hint-${task.id}`}>
          {`${displayStart} → ${displayFinish} · ${displayDuration}d`}
        </div>
      )}

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
        onPointerDown={(event) => {
          // 取柄的**中心**而不是外缘：柄的圆心正好落在任务条右缘上，
          // 与 barRect 的右缘（也就是静态 FS 连线的起点）重合。
          // 用 getBoundingClientRect().right 会多出半个柄宽（5px），
          // 幽灵线就从柄外缘起步，与最终落笔的连线对不上。
          const rect = event.currentTarget.getBoundingClientRect()
          onStartLink?.(event, rect.left + rect.width / 2, event.clientY)
        }}
      />
    </div>
  )
}

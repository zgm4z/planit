import { useTranslation } from 'react-i18next'
import type { Calendar, ComputedSchedule, Task } from '../domain/model/types'
import { taskFinish } from '../domain/calendar/workdays'
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
  /** 影子态：半透明 + 虚线描边，表示「尚未提交」 */
  ghost?: boolean
  /** 是否显示浮动日期提示（只有被拖的那一根条需要） */
  showHint?: boolean
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
  ghost = false,
  showHint = false,
  onBarPointerDown,
  onStartLink,
}: TaskBarProps) {
  const { t } = useTranslation()
  const displayStart = override?.startDate ?? schedule.scheduledStart
  const displayDuration = override?.duration ?? task.duration

  // 拖拽期间工期可能刚被改过，结束日期必须按新工期重算，
  // 不能沿用引擎算出的旧排期结束日（resizeEnd 时开始日期没变，但工期变了）。
  // 走 domain 的 taskFinish —— 「开始日 + 工期 → 结束日」只能有一个实现。
  const displayFinish = override
    ? taskFinish(displayStart, displayDuration, calendar)
    : schedule.scheduledFinish

  if (task.kind === 'milestone') {
    // 几何全部来自 milestoneRect()（外接盒），DependencyLayer 用的是同一个函数
    const rect = milestoneRect(scale, displayStart)

    return (
      <div
        className={`${styles.milestone} ${schedule.isCritical ? styles.milestoneCritical : ''} ${
          hasConflict ? styles.milestoneConflict : ''
        } ${ghost ? styles.milestoneGhost : ''}`}
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
      } ${ghost ? styles.barGhost : ''}`}
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

      {showHint && (
        <div className={styles.dragHint} data-testid={`drag-hint-${task.id}`}>
          {t('gantt.dragHint', {
            start: displayStart,
            finish: displayFinish,
            days: displayDuration,
          })}
        </div>
      )}

      <div
        className={`${styles.barHandle} ${styles.barHandleLeft}`}
        data-testid={`bar-handle-left-${task.id}`}
        onPointerDown={(event) => onBarPointerDown?.(event, 'resizeStart')}
      />
      <div
        className={`${styles.barHandle} ${styles.barHandleRight}`}
        data-testid={`bar-handle-right-${task.id}`}
        onPointerDown={(event) => onBarPointerDown?.(event, 'resizeEnd')}
      />

      {/* 连接柄：从它拖出依赖连线（Task 17 接线）。
          整体放在任务条**外侧**（右缘右侧 1px 起）—— 原先它压在右把手上，
          只给把手留下约 3px 的可点区，用户几乎抓不到右把手。

          role/tabIndex：光有 aria-label 的裸 <div> 不参与可访问性树，
          读屏软件读不到这个控件。加 role="button" + tabIndex 让它可被识别与聚焦。
          键盘激活路径（Enter/Space 建边）尚未实现 —— 连线需要一个落点，
          属于独立于本次清理的交互设计，需要时另开任务。 */}
      <div
        role="button"
        tabIndex={0}
        aria-label={t('gantt.startLink')}
        data-testid={`link-handle-${task.id}`}
        style={{
          position: 'absolute',
          right: -11,
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
          // 幽灵线起点锚在**任务条右缘** —— 与 barRect 的右缘（静态 FS 连线的
          // 起点）重合。柄已挪到条外，不能再拿柄的中心当起点（会偏出 5px）。
          const bar = event.currentTarget.parentElement
          const x = bar
            ? bar.getBoundingClientRect().right
            : event.currentTarget.getBoundingClientRect().right
          onStartLink?.(event, x, event.clientY)
        }}
      />
    </div>
  )
}

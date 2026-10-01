import { useTranslation } from 'react-i18next'
import type {
  ComputedSchedule,
  LevelingResult,
  Project,
  ResourceId,
  TaskId,
} from '../../domain/model/types'
import { barRect, type TimelineScale } from '../gantt/timeline'
import { ROW_HEIGHT } from '../shared/useSharedVirtualizer'
import styles from '../styles/ProjectView.module.scss'

interface ResourceTimelineProps {
  project: Project
  resourceId: ResourceId
  schedules: Record<TaskId, ComputedSchedule>
  leveling: LevelingResult
  /** 与甘特视图**同一个**时间轴（ProjectView 已算好），横轴因此天然一致 */
  scale: TimelineScale
  totalDays: number
}

/**
 * 选中资源的**分配时间线**（spec §6.2）。
 *
 * 只读：不支持拖拽改期与连线 —— 改排期是甘特视图的职责。
 * 几何复用甘特的 `barRect`；超载日来自 `leveling.unresolved`（唯一数据源），
 * UI 一处都不重算负载。
 */
export function ResourceTimeline({
  project,
  resourceId,
  schedules,
  leveling,
  scale,
  totalDays,
}: ResourceTimelineProps) {
  const { t } = useTranslation()

  // 同一任务挂多条分配到同一资源时去重（一行一条任务）
  const taskIds = [
    ...new Set(
      Object.values(project.assignments)
        .filter((assignment) => assignment.resourceId === resourceId)
        .map((assignment) => assignment.taskId),
    ),
  ]
  // flatMap 让 TS 正确收窄（filter 不会把 `schedule: ComputedSchedule | undefined` 收掉）
  const bars = taskIds
    .flatMap((taskId) => {
      const task = project.tasks[taskId]
      const schedule = schedules[taskId]
      return task && schedule ? [{ taskId, task, schedule }] : []
    })
    .sort((a, b) =>
      a.schedule.scheduledStart < b.schedule.scheduledStart
        ? -1
        : a.schedule.scheduledStart > b.schedule.scheduledStart
          ? 1
          : a.taskId < b.taskId
            ? -1
            : 1,
    )

  const overloadDates = [...new Set(
    leveling.unresolved.filter((overload) => overload.resourceId === resourceId).map((o) => o.date),
  )].sort()

  if (bars.length === 0) {
    return (
      <div className={styles.resourceMain} data-testid="resource-timeline">
        <p className={styles.resourceTimelineTitle}>{t('resourceView.timelineTitle')}</p>
        <p className={styles.resourceEmpty}>{t('resourceView.timelineEmpty')}</p>
      </div>
    )
  }

  return (
    <div className={styles.resourceMain} data-testid="resource-timeline">
      <p className={styles.resourceTimelineTitle}>{t('resourceView.timelineTitle')}</p>
      <div
        className={styles.resourceTimelineBody}
        style={{ height: bars.length * ROW_HEIGHT, width: totalDays * scale.dayWidth }}
      >
        {/* 超载日：整列高亮。同一个 resourceId + date 只画一次 */}
        {overloadDates.map((date) => (
          <div
            key={date}
            className={styles.resourceOverloadBand}
            style={{ left: scale.xOf(date), width: scale.dayWidth }}
            data-testid={`resource-overload-${date}`}
            aria-hidden
          />
        ))}

        {bars.map((bar, index) => {
          const rect = barRect(scale, bar.schedule.scheduledStart, bar.schedule.scheduledFinish)
          return (
            <div
              key={bar.taskId}
              className={styles.resourceBar}
              style={{ left: rect.x, width: rect.width, top: index * ROW_HEIGHT + (ROW_HEIGHT - 18) / 2 }}
              data-testid={`resource-bar-${bar.taskId}`}
            >
              {bar.task.name}
            </div>
          )
        })}
      </div>
    </div>
  )
}

import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ComputedSchedule,
  LevelingResult,
  Project,
  ResourceId,
  TaskId,
} from '../../domain/model/types'
import { createCalendar } from '../../domain/model/factories'
import { barRect, type TimelineScale } from '../gantt/timeline'
import { TimeRuler } from '../gantt/TimeRuler'
import { nonworkBands } from '../shared/nonworkBands'
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
 *
 * 时间轴表头是**同一个 TimeRuler**、底纹是**同一个 day-grid / nonwork-band 令牌**
 * （甘特与资源视图共用一份实现，见 _tokens.scss 的注释）—— 于是这里能看出
 * **每一天一列**，超载带按天分格、分配条的落点可读。
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

  // 日历口径与甘特一致：底纹要用**用户可编辑的日历**判断哪天不上班。
  const calendar = useMemo(
    () => project.calendars[project.calendarId] ?? createCalendar(),
    [project],
  )
  const bands = useMemo(
    () => nonworkBands(scale.startDate, totalDays, scale.dayWidth, calendar),
    [scale.startDate, totalDays, scale.dayWidth, calendar],
  )

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

  const contentWidth = totalDays * scale.dayWidth

  return (
    <div className={styles.resourceMain} data-testid="resource-timeline">
      <p className={styles.resourceTimelineTitle}>{t('resourceView.timelineTitle')}</p>

      {/* 只有一个横向滚动口：刻度与画布一起滚，标题留在外面不跟着走。
          它也是 TimeRuler 月份标签 sticky 的锚点 —— 资源侧没有 sticky 左列，
          故给 TimeRuler 传 stickyLabelLeft="0"（钉在时间线自身左缘）。 */}
      <div className={styles.resourceTimelineScroll}>
        <div
          className={styles.resourceTimelineBody}
          style={{ width: contentWidth, '--day-width': `${scale.dayWidth}px` } as CSSProperties}
        >
          <div className={styles.resourceTimelineRuler} data-testid="resource-timeline-ruler">
            <TimeRuler scale={scale} totalDays={totalDays} stickyLabelLeft="0" />
          </div>

          <div
            className={styles.resourceTimelineGrid}
            style={{ height: bars.length * ROW_HEIGHT, width: contentWidth }}
            data-testid="resource-timeline-grid"
          >
            {/* 非工作日底纹：与甘特共用 nonwork-band（同一份观感） */}
            {bands.map((band) => (
              <div
                key={band.left}
                className={styles.resourceNonworkBand}
                style={{ left: band.left, width: band.width }}
                aria-hidden
              />
            ))}

            {/* 超载日：整列高亮。同一个 resourceId + date 只画一次。
                画布上有日网格（day-grid），琥珀带因此按天分格 —— 一眼能数出超载了几天。 */}
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
      </div>
    </div>
  )
}

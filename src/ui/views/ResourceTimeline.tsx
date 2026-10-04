import { memo, useMemo } from 'react'
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
 *
 * ── 为什么是 memo ────────────────────────────────────────────────────────
 * 资源视图滚动时，ResourceView 因虚拟化器每帧重渲染；但真正驱动本时间轴的
 * 六个 props（project / resourceId / schedules / leveling / scale / totalDays）
 * 在滚动中全部恒等。而本组件每次渲染都要遍历全部 assignments 再排序 ——
 * 大项目下是笔可观开销。memo 让它在滚动帧里整棵跳过。
 */
function ResourceTimelineComponent({
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

      {/* 日期轴表头：sticky top，纵向滚动时留在视口里（与甘特标尺同款）。
          它是 .resourceMain 的**直接子元素**（画布之外）—— 这样它的 containing block
          是整块主区（被 .resourceView 的 align-items:stretch 撑到与资源树等高），
          sticky 才能走完整个纵向滚动范围。若把它塞进下面的画布容器，containing block
          只有「画布那么高」：资源多、而选中资源分配少时，表头会在半途提前脱钉。
          宽度内联给 contentWidth，与画布逐列对齐。 */}
      <div
        className={styles.resourceTimelineRuler}
        style={{ width: contentWidth }}
        data-testid="resource-timeline-ruler"
      >
        <TimeRuler scale={scale} totalDays={totalDays} stickyLabelLeft="320px" />
      </div>

      {/* 横向滚动由 shared-scroll 承担（与甘特一致）—— 刻度与画布一起滚。
          月份标签 sticky 的锚点因此是 shared-scroll 的左缘，而资源树钉在那里（宽 320px），
          故把标签钉在**树右缘**：stickyLabelLeft="320px"（与 .resourceTree 的定宽同源），
          否则月名会滑到资源树底下。 */}
      <div className={styles.resourceTimelineScroll}>
        <div
          className={styles.resourceTimelineBody}
          style={{ width: contentWidth, '--day-width': `${scale.dayWidth}px` } as CSSProperties}
        >
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

/** memo 化（见上）。滚动帧里六个 props 恒等 ⇒ 整棵跳过。 */
export const ResourceTimeline = memo(ResourceTimelineComponent)

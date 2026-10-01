import { useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'

import { flattenVisibleRows } from './flattenRows'
import { GanttRows } from './GanttRows'
import { OutlineTree } from './OutlineTree'
import { TimeRuler } from './TimeRuler'
import { createScale } from './timeline'
import { Toolbar } from './Toolbar'
import { useSharedVirtualizer, ROW_HEIGHT } from './useSharedVirtualizer'
import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'
import { useViewStore } from '../store/viewStore'
import { useTranslation } from 'react-i18next'
import { addDays, formatDate, workdayIndex } from '../domain/calendar/workdays'
import styles from './styles/ProjectView.module.scss'
import ganttStyles from './styles/GanttPane.module.scss'

export function ProjectView() {
  const { t } = useTranslation()

  const project = useProjectStore((state) => state.project)
  const collapsedIds = useViewStore((state) => state.collapsedIds)
  const selectedTaskId = useViewStore((state) => state.selectedTaskId)
  const selectTask = useViewStore((state) => state.selectTask)
  const toggleCollapsed = useViewStore((state) => state.toggleCollapsed)
  const dayWidth = useViewStore((state) => state.dayWidth)
  const schedulesResult = useScheduleStore((state) => state.result)

  const scrollRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(
    () => (project ? flattenVisibleRows(project, collapsedIds) : []),
    [project, collapsedIds],
  )

  // 两侧列消费同一份 virtualItems —— 行永远对齐
  const virtualItems = useSharedVirtualizer(scrollRef, rows.length)

  const conflictIds = useMemo(
    () => new Set(schedulesResult.conflicts.map((c) => c.taskId)),
    [schedulesResult.conflicts],
  )

  const scale = useMemo(
    () => createScale(project?.startDate ?? '2026-01-01', dayWidth),
    [project?.startDate, dayWidth],
  )

  // 时间轴总跨度：至少覆盖所有任务，且不少于 60 天
  const totalDays = useMemo(() => {
    let lastDay = 60
    for (const schedule of Object.values(schedulesResult.schedules)) {
      lastDay = Math.max(lastDay, scale.daysFromStart(schedule.earlyFinish) + 7)
    }
    return lastDay
  }, [schedulesResult.schedules, scale])

  // 甘特图列宽必须与刻度的时间跨度一致 ——
  // 否则晚于 60 天的任务条与刻度会溢出列宽（横向滚动条也覆盖不到）
  const ganttWidth = totalDays * dayWidth

  // 周末底纹：时间轴按自然日铺开，非工作日整列压暗
  const weekendBands = useMemo(() => {
    const bands: { left: number; width: number }[] = []
    for (let day = 0; day < totalDays; day += 1) {
      if (workdayIndex(addDays(scale.startDate, day)) >= 5) {
        bands.push({ left: day * dayWidth, width: dayWidth })
      }
    }
    return bands
  }, [scale.startDate, totalDays, dayWidth])

  // 今日线：仅当今天落在时间轴范围内才渲染
  const todayX = useMemo(() => {
    const days = scale.daysFromStart(formatDate(new Date()))
    return days >= 0 && days < totalDays ? days * dayWidth : null
  }, [scale, totalDays, dayWidth])

  if (!project) return null

  return (
    <div className={styles.view}>
      <Toolbar />

      <div className={styles.body}>
        <div className={styles.scroll} ref={scrollRef} data-testid="shared-scroll">
          <div
            className={styles.grid}
            style={
              {
                '--gantt-width': `${ganttWidth}px`,
                '--day-width': `${dayWidth}px`,
              } as CSSProperties
            }
          >
            <div className={styles.corner} data-testid="outline-header">
              {t('outline.columnTitle')}
            </div>

            <div className={styles.ruler} data-testid="gantt-ruler">
              <TimeRuler scale={scale} totalDays={totalDays} />
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

            <div
              className={styles.gantt}
              style={{
                height: `${rows.length * ROW_HEIGHT}px`,
                // 每自然日一条竖线，构成背景网格
                backgroundImage:
                  'repeating-linear-gradient(90deg, transparent 0, transparent calc(var(--day-width) - 1px), var(--planit-border) calc(var(--day-width) - 1px), var(--planit-border) var(--day-width))',
              }}
              data-testid="gantt-pane"
            >
              {weekendBands.map((band) => (
                <div
                  key={band.left}
                  className={ganttStyles.weekendBand}
                  style={{ left: band.left, width: band.width }}
                  aria-hidden
                />
              ))}

              {todayX !== null && (
                <div className={ganttStyles.todayLine} style={{ left: todayX }} aria-hidden />
              )}

              <GanttRows
                project={project}
                calendar={project.calendars[project.calendarId]}
                rows={rows}
                virtualItems={virtualItems}
                schedules={schedulesResult.schedules}
                conflictIds={conflictIds}
                scale={scale}
                dragOverride={null}
                onBarPointerDown={() => {}}
                onStartLink={() => {}}
              />
            </div>
          </div>
        </div>

        {/* Inspector 在 Task 19 接入 */}
      </div>
    </div>
  )
}

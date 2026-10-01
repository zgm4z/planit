import { useCallback, useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'

import { flattenVisibleRows } from './flattenRows'
import { DependencyLayer } from './DependencyLayer'
import { GanttRows } from './GanttRows'
import { Inspector } from './Inspector'
import { OutlineTree } from './OutlineTree'
import { GANTT_OUTLINE_COLUMNS } from './outlineColumns'
import { TimeRuler } from './TimeRuler'
import { dragCommitCommands } from './barDrag'
import { BAR_HEIGHT, barRect, createScale, milestoneRect, type Rect } from './timeline'
import { Toolbar } from './Toolbar'
import { StatusBar } from './StatusBar'
import { CalendarSettings } from './CalendarSettings'
import { useBarDrag } from './useBarDrag'
import { useDependencyLink } from './useDependencyLink'
import { useSharedVirtualizer, ROW_HEIGHT } from './useSharedVirtualizer'
import { createCalendar } from '../domain/model/factories'
import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'
import { useViewStore } from '../store/viewStore'
import { useTranslation } from 'react-i18next'
import { addDays, formatDate, isWorkday } from '../domain/calendar/workdays'
import styles from './styles/ProjectView.module.scss'
import ganttStyles from './styles/GanttPane.module.scss'

export function ProjectView() {
  const { t } = useTranslation()

  const project = useProjectStore((state) => state.project)
  const dispatch = useProjectStore((state) => state.dispatch)
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
      lastDay = Math.max(lastDay, scale.daysFromStart(schedule.scheduledFinish) + 7)
    }
    return lastDay
  }, [schedulesResult.schedules, scale])

  // 甘特图列宽必须与刻度的时间跨度一致 ——
  // 否则晚于 60 天的任务条与刻度会溢出列宽（横向滚动条也覆盖不到）
  const ganttWidth = totalDays * dayWidth

  // 日历必须在下方的底纹之前取得：底纹要用**用户可编辑的日历**判断哪天不上班。
  // calendar 与 scale 一样要在 hook 里无条件取得。ProjectView 实际只在 store 里
  // 有 project 时挂载（见 App.tsx），`?? createCalendar()` 只是让类型收窄、
  // 并保证 hook 调用次数恒定。
  const calendar = useMemo(
    () => project?.calendars[project.calendarId] ?? createCalendar(),
    [project],
  )

  // 非工作日底纹：时间轴按自然日铺开，日历判定为非工作日的整列压暗。
  //
  // 不能用硬编码的 `workdayIndex(...) >= 5`（周一至周五）—— 那与用户可编辑的
  // 日历脱节：取消勾选周五后任务会跳过周五，底纹却仍只盖周六周日，
  // 界面自相矛盾。用 isWorkday(date, calendar) 的取反，则周规则与例外日期
  // （被设为假日的某个周三）都会被正确标出。
  const weekendBands = useMemo(() => {
    const bands: { left: number; width: number }[] = []
    for (let day = 0; day < totalDays; day += 1) {
      if (!isWorkday(addDays(scale.startDate, day), calendar)) {
        bands.push({ left: day * dayWidth, width: dayWidth })
      }
    }
    return bands
  }, [scale.startDate, totalDays, dayWidth, calendar])

  // 今日线：仅当今天落在时间轴范围内才渲染
  const todayX = useMemo(() => {
    const days = scale.daysFromStart(formatDate(new Date()))
    return days >= 0 && days < totalDays ? days * dayWidth : null
  }, [scale, totalDays, dayWidth])

  // 任务条/里程碑的绝对矩形（相对甘特图内容原点）。连线端点必须与 TaskBar
  // 用**同一个**几何函数算出来，否则会插到任务条外面：
  // 普通任务走 barRect，里程碑走 milestoneRect（菱形外接盒，不是 barRect）。
  const rectByTaskId = useMemo(() => {
    const map = new Map<string, Rect>()
    if (!project) return map

    rows.forEach((row, index) => {
      const task = project.tasks[row.taskId]
      const schedule = schedulesResult.schedules[row.taskId]
      // 摘要任务不画条，也就没有连线端点
      if (!task || !schedule || task.childIds.length > 0) return

      const rowTop = index * ROW_HEIGHT

      if (task.kind === 'milestone') {
        const rect = milestoneRect(scale, schedule.scheduledStart)
        map.set(row.taskId, { ...rect, y: rect.y + rowTop })
      } else {
        const bar = barRect(scale, schedule.scheduledStart, schedule.scheduledFinish)
        map.set(row.taskId, {
          x: bar.x,
          y: rowTop + (ROW_HEIGHT - BAR_HEIGHT) / 2,
          width: bar.width,
          height: BAR_HEIGHT,
        })
      }
    })

    return map
  }, [rows, project, schedulesResult.schedules, scale])

  const handleLink = useCallback(
    (fromTaskId: string, toTaskId: string) => {
      dispatch({
        type: 'dependency.create',
        label: 'commands.dependency.create',
        payload: { fromTaskId, toTaskId, type: 'FS', lag: 0 },
      })
    },
    [dispatch],
  )

  const link = useDependencyLink(handleLink)

  // 拖拽期间只更新影子预览；松手才 dispatch 命令 ——
  // 因此拖拽过程中 undoStack 长度必须保持不变。
  const drag = useBarDrag({
    project,
    calendar,
    dayWidth,
    onCommit: (taskId, mode, preview) => {
      // 命令序列来自 dragCommitCommands —— 与 buildHypothetical（影子预览）共用
      // 同一份定义，保证「影子显示的结果」就是「松手后落盘的结果」。
      for (const command of dragCommitCommands(mode, taskId, preview)) {
        dispatch(command)
      }
    },
  })

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
                schedules={schedulesResult.schedules}
                columns={GANTT_OUTLINE_COLUMNS}
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
                  data-testid="workday-band"
                  aria-hidden
                />
              ))}

              {todayX !== null && (
                <div className={ganttStyles.todayLine} style={{ left: todayX }} aria-hidden />
              )}

              <GanttRows
                project={project}
                calendar={calendar}
                rows={rows}
                virtualItems={virtualItems}
                schedules={schedulesResult.schedules}
                conflictIds={conflictIds}
                scale={scale}
                dragShadow={drag.shadow}
                onBarPointerDown={(event, taskId, mode) => {
                  // 按下的同时选中该任务 —— 单击（未越过 3px 阈值）只应选中，
                  // 不产生任何命令；拖拽也从「选中它」开始，符合直觉。
                  selectTask(taskId)
                  const schedule = schedulesResult.schedules[taskId]
                  if (!schedule) return
                  drag.begin(event, taskId, mode, schedule.scheduledStart, project.tasks[taskId].duration)
                }}
                onStartLink={(event, taskId, x, y) => link.begin(event, taskId, x, y)}
              />

              <DependencyLayer
                dependencies={Object.values(project.dependencies)}
                rectByTaskId={rectByTaskId}
                totalHeight={rows.length * ROW_HEIGHT}
                totalWidth={ganttWidth}
              />
            </div>
          </div>
        </div>

        {/* 右侧栏分成上下两段：Inspector 自负滚动，日历设置钉在底部。
            宽度与左边框由**这个容器**统一持有（唯一来源）—— Inspector 与
            CalendarSettings 都只填 100%，否则改宽度时要同时改三处，
            漏改一处就会静默错位。 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: 'var(--planit-inspector-width)',
            minHeight: 0,
            flexShrink: 0,
            borderLeft: '1px solid var(--planit-border)',
          }}
        >
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <Inspector />
          </div>
          <CalendarSettings />
        </div>
      </div>

      <StatusBar />

      {/* 拖拽中的幽灵线：固定定位，坐标为视口坐标。
          必须显式给 width/height：`<svg>` 是替换元素，光靠 inset:0 不会撑满，
          会退回 300×150 的固有尺寸 —— 而 SVG 根元素默认 overflow:hidden，
          起点在视口右侧的连线会被整个裁掉（元素仍在 DOM 里，几何断言也照样通过）。 */}
      {link.draft && (
        <svg
          width="100%"
          height="100%"
          style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 50 }}
          aria-hidden
          data-testid="link-draft"
        >
          <line
            x1={link.draft.fromX}
            y1={link.draft.fromY}
            x2={link.draft.toX}
            y2={link.draft.toY}
            stroke="var(--planit-accent)"
            strokeWidth={1.6}
            strokeDasharray="4 3"
          />
        </svg>
      )}
    </div>
  )
}

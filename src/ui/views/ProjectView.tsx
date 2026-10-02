import { useCallback, useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'
import { Drawer } from '@mantine/core'

import { flattenVisibleRows } from '../shared/flattenRows'
import { flattenResourceRows } from '../shared/flattenResources'
import { CalendarView } from './CalendarView'
import { ResourceView } from './ResourceView'
import { DependencyLayer } from '../gantt/DependencyLayer'
import { GanttRows } from '../gantt/GanttRows'
import { Inspector } from '../inspector/Inspector'
import { OutlineTree } from '../outline/OutlineTree'
import {
  GANTT_OUTLINE_COLUMNS,
  OUTLINE_COLUMNS,
  responsiveHiddenColumns,
} from '../outline/outlineColumns'
import { OutlineTable } from '../outline/OutlineTable'
import { TimeRuler } from '../gantt/TimeRuler'
import { dragCommitCommands } from '../gantt/barDrag'
import {
  BAR_HEIGHT,
  BAR_HEIGHT_CRITICAL,
  barRect,
  createScale,
  milestoneRect,
  type Rect,
} from '../gantt/timeline'
import { Toolbar } from '../shell/Toolbar'
import { StatusBar } from '../shell/StatusBar'
import { useBarDrag } from '../gantt/useBarDrag'
import { useDependencyLink } from '../gantt/useDependencyLink'
import { useLayoutMode } from '../shared/useBreakpoints'
import { nonworkBands } from '../shared/nonworkBands'
import { useSharedVirtualizer, ROW_HEIGHT } from '../shared/useSharedVirtualizer'
import { createCalendar } from '../../domain/model/factories'
import { useProjectStore } from '../../store/projectStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useViewStore } from '../../store/viewStore'
import { useTranslation } from 'react-i18next'
import { formatDate } from '../../domain/calendar/workdays'
import styles from '../styles/ProjectView.module.scss'
import ganttStyles from '../styles/GanttPane.module.scss'

/**
 * 右栏内容的纵向布局 —— **常驻面板与抽屉共用**（§7）。宽度与左边框**不在这里**：
 * 常驻面板由外层容器持有（见下），抽屉由 Mantine 的 Drawer 自己持有。
 */
const inspectorColumnStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
}

export function ProjectView() {
  const { t } = useTranslation()

  const project = useProjectStore((state) => state.project)
  const dispatch = useProjectStore((state) => state.dispatch)
  const collapsedIds = useViewStore((state) => state.collapsedIds)
  const selectedTaskId = useViewStore((state) => state.selectedTaskId)
  const selectTask = useViewStore((state) => state.selectTask)
  const toggleCollapsed = useViewStore((state) => state.toggleCollapsed)
  const dayWidth = useViewStore((state) => state.dayWidth)
  const activeView = useViewStore((state) => state.activeView)
  const visibleColumns = useViewStore((state) => state.visibleColumns)
  const collapsedResourceIds = useViewStore((state) => state.collapsedResourceIds)
  const schedulesResult = useScheduleStore((state) => state.result)

  const scrollRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(
    () => (project ? flattenVisibleRows(project, collapsedIds) : []),
    [project, collapsedIds],
  )

  // 资源树的扁平行：与任务树同一手法（前序 + 跳过折叠），但**另一个实体**（spec §6.1）。
  // 只在这里算一次，向下传给 ResourceView / 虚拟化器 —— 树与时间线消费同一份行数。
  const resourceRows = useMemo(
    () => (project ? flattenResourceRows(project, collapsedResourceIds) : []),
    [project, collapsedResourceIds],
  )

  const { isNarrow, isCompact } = useLayoutMode()

  // 可见列 —— 顺序由注册表决定，visibleColumns 只表达 membership。
  // 两个视图共用这一份，绝不各自 filter 一遍。
  //
  // §7 的响应式隐藏**叠加在用户偏好之上**，而不是改写它：`visibleColumns` 仍是
  // 用户在列菜单里配的那一份（并已落盘），窄屏只是**临时**再减掉几列。
  // 这样回到宽屏时，用户的列配置原封不动 —— 响应式**绝不**写回 store 或 localStorage。
  const outlineColumns = useMemo(() => {
    const hidden = new Set(responsiveHiddenColumns(isNarrow, isCompact))
    return OUTLINE_COLUMNS.filter(
      (column) => visibleColumns.includes(column.key) && !hidden.has(column.key),
    )
  }, [visibleColumns, isNarrow, isCompact])

  // 唯一的虚拟化器：调用次数必须恒定（hooks 规则），行数按视图取。
  // 四个视图共用**同一个** shared-scroll 节点（见下方 JSX）—— v0.3 的坑：
  // 换节点会让虚拟化器盯上一个已卸载的 DOM。
  // calendar 视图没有虚拟化行（月网格不是行列表），故 rowCount 取 0。
  const rowCount =
    activeView === 'resources' ? resourceRows.length : activeView === 'calendar' ? 0 : rows.length
  // 两侧列消费同一份 virtualItems —— 行永远对齐
  const virtualItems = useSharedVirtualizer(scrollRef, rowCount)

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
  // 算法在 shared/nonworkBands —— 甘特与资源分配时间线**共用同一份**（此前这段
  // 循环内联在这里，资源视图若再抄一遍就会静默漂移）。判定走领域日历的取反，
  // 而不是硬编码「周一至周五」，所以周规则与例外日期（被设为假日的某个周三）
  // 都会被正确标出。
  const weekendBands = useMemo(
    () => nonworkBands(scale.startDate, totalDays, dayWidth, calendar),
    [scale.startDate, totalDays, dayWidth, calendar],
  )

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
        // 关键条高 2px（§3.2），与 TaskBar 用同一条规则 —— 端点才会落在条的中线上。
        const barHeight = schedule.isCritical ? BAR_HEIGHT_CRITICAL : BAR_HEIGHT
        map.set(row.taskId, {
          x: bar.x,
          y: rowTop + (ROW_HEIGHT - barHeight) / 2,
          width: bar.width,
          height: barHeight,
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
        {/* 唯一的滚动容器：**同一个 DOM 节点**在两个视图间复用（只换 class 与 data-view），
            否则 useSharedVirtualizer 会盯上一个已卸载的节点。内容在甘特 grid 与
            大纲表格之间切换 —— 大纲视图里甘特面板的 DOM 整个不存在（不是宽度为 0）。 */}
        <div
          className={styles.scroll}
          ref={scrollRef}
          data-testid="shared-scroll"
          data-view={activeView}
        >
          {activeView === 'gantt' ? (
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
                  efforts={schedulesResult.efforts}
                  costs={schedulesResult.costs}
                  earnedValues={schedulesResult.earnedValues}
                  baselineDiffs={schedulesResult.baselineDiffs}
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
          ) : activeView === 'outline' ? (
            <OutlineTable
              project={project}
              rows={rows}
              virtualItems={virtualItems}
              schedules={schedulesResult.schedules}
              efforts={schedulesResult.efforts}
              costs={schedulesResult.costs}
              earnedValues={schedulesResult.earnedValues}
              baselineDiffs={schedulesResult.baselineDiffs}
              columns={outlineColumns}
              selectedTaskId={selectedTaskId}
              onSelect={selectTask}
              onToggleCollapse={toggleCollapsed}
            />
          ) : activeView === 'calendar' ? (
            <CalendarView />
          ) : (
            <ResourceView
              project={project}
              rows={resourceRows}
              virtualItems={virtualItems}
              schedules={schedulesResult.schedules}
              leveling={schedulesResult.leveling}
              scale={scale}
              totalDays={totalDays}
            />
          )}
        </div>

        {/* 右栏内容 = Inspector 一个整体（自负滚动）。
            v0.7：工作日历的**编辑**已迁出右栏，改由一等的「日历」视图承担
            （同一规则只能有一处可改 —— 见 spec §5）。右栏因此不再挂项目日历设置。
            **常驻面板与窄屏抽屉共用同一份内容** —— 两处各写一遍的话，将来给右栏
            加一块，漏改一处就会「宽屏有、窄屏没有」。 */}
        {isNarrow ? (
          // §7：< 1100 右栏改为抽屉（覆盖在右侧、带遮罩与关闭）。宽 300 与常驻一致。
          <Drawer
            opened={selectedTaskId !== null}
            onClose={() => selectTask(null)}
            position="right"
            size={300}
            padding={0}
            data-testid="inspector-drawer"
          >
            <div data-testid="inspector-drawer-body" style={inspectorColumnStyle}>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                <Inspector />
              </div>
            </div>
          </Drawer>
        ) : (
          // 常驻右栏：宽度与左边框由**这个容器**统一持有（唯一来源）。
          <div
            style={{
              ...inspectorColumnStyle,
              width: 'var(--planit-inspector-width)',
              flexShrink: 0,
              borderLeft: '1px solid var(--planit-border)',
            }}
          >
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <Inspector />
            </div>
          </div>
        )}
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
            stroke="var(--planit-work)"
            strokeWidth={1.6}
            strokeDasharray="4 3"
          />
        </svg>
      )}
    </div>
  )
}

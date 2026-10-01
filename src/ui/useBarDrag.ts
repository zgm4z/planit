import { useCallback, useEffect, useRef, useState } from 'react'
import type { Calendar, ComputedSchedule, Project, TaskId } from '../domain/model/types'
import { solve } from '../domain/scheduler'
import { addDays } from '../domain/calendar/workdays'
import {
  computeDragPreview,
  daysBetweenPixels,
  dragAnchorDate,
  type DragMode,
  type DragPreview,
} from './barDrag'

/** 小于这个像素位移视为点击，不产生任何数据变更 */
const CLICK_THRESHOLD_PX = 3

interface DragState {
  taskId: TaskId
  mode: DragMode
  startClientX: number
  originStartDate: string
  originDuration: number
  /** 是否已经越过点击阈值进入真正的拖拽 */
  moved: boolean
}

interface UseBarDragOptions {
  /** 调用方在 project 为 null 时也不会挂载，这里允许 null 只是为了让 hook 无条件调用 */
  project: Project | null
  calendar: Calendar
  dayWidth: number
  onCommit: (taskId: TaskId, mode: DragMode, preview: DragPreview) => void
}

export interface BarDragApi {
  /** 当前拖拽的影子排期，仅在拖拽过程中非空；松手提交后立即清空 */
  preview: ({ taskId: TaskId } & DragPreview) | null
  /**
   * 拖拽中被连带重排的**其他**任务（下游链路）的影子排期，非拖拽期间为 null。
   * 不含被拖任务本身 —— 那根条的影子由 `preview` 表达。
   */
  downstreamPreview: Record<TaskId, ComputedSchedule> | null
  begin: (
    event: React.PointerEvent,
    taskId: TaskId,
    mode: DragMode,
    originStartDate: string,
    originDuration: number,
  ) => void
}

/**
 * 任务条拖拽：拖拽期间只更新影子预览（`preview` + `downstreamPreview`），
 * 松手才通过 `onCommit` 提交命令。位移小于 3px 视为点击，不产生任何命令 ——
 * 因此**拖拽过程中撤销栈长度必须保持不变**。
 *
 * 下游链路的重排是**假设排期**：把被拖任务按影子档期塞进一份临时 project，
 * 跑一次纯函数 `solve`，得到「如果现在松手，别人会落在哪」。它只用于渲染
 * 半透明影子，不进 store、不进撤销栈。
 */
export function useBarDrag({ project, calendar, dayWidth, onCommit }: UseBarDragOptions): BarDragApi {
  const dragRef = useRef<DragState | null>(null)
  const previewRef = useRef<({ taskId: TaskId } & DragPreview) | null>(null)
  const [preview, setPreview] = useState<({ taskId: TaskId } & DragPreview) | null>(null)
  const [downstreamPreview, setDownstreamPreview] = useState<Record<TaskId, ComputedSchedule> | null>(
    null,
  )

  // onCommit 每次渲染都是新函数，用 ref 兜住，避免把它塞进 begin 的依赖数组
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  // 拖拽期间不会有 dispatch，project 引用是稳定的；用 ref 读取即可
  const projectRef = useRef(project)
  projectRef.current = project

  // 假设排期必须节流：1000 个任务时每次 pointermove 都 solve 会卡死主线程。
  // 每次 move 只登记「待重算」，由 rAF 保证每帧最多算一次。
  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef<{ taskId: TaskId; preview: DragPreview } | null>(null)

  const cancelDownstream = useCallback((): void => {
    pendingRef.current = null
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setDownstreamPreview(null)
  }, [])

  // 卸载时取消挂起的帧，避免对已卸载组件 setState
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  const scheduleDownstream = useCallback((taskId: TaskId, next: DragPreview): void => {
    pendingRef.current = { taskId, preview: next }
    if (rafRef.current !== null) return

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null

      const pending = pendingRef.current
      if (!pending) return

      try {
        const current = projectRef.current
        const dragged = current?.tasks[pending.taskId]
        if (!current || !dragged) {
          setDownstreamPreview(null)
          return
        }

        const hypothetical: Project = {
          ...current,
          tasks: {
            ...current.tasks,
            [pending.taskId]: {
              ...dragged,
              duration: pending.preview.duration,
              scheduling: {
                mode: 'constraint',
                type: 'startOn',
                date: pending.preview.startDate,
              },
            },
          },
        }

        const { schedules } = solve(hypothetical)

        const others: Record<TaskId, ComputedSchedule> = {}
        for (const [id, schedule] of Object.entries(schedules)) {
          if (id !== pending.taskId) others[id] = schedule
        }
        setDownstreamPreview(others)
      } catch {
        // 假设排期失败（临时 project 数据异常、成环等）时退化为**不显示**
        // 下游影子。绝不能因为一次预览计算失败而让整个拖拽崩掉或卡住。
        setDownstreamPreview(null)
      }
    })
  }, [])

  const begin = useCallback(
    (
      event: React.PointerEvent,
      taskId: TaskId,
      mode: DragMode,
      originStartDate: string,
      originDuration: number,
    ) => {
      // 只响应主键（左键 / 触摸 / 笔）。右键与中键不应启动拖拽 —— 它们
      // 会顺带触发右键菜单或中键滚动，与拖拽叠加后行为不可预期。
      if (event.button !== 0) return

      event.preventDefault()
      event.stopPropagation()

      dragRef.current = {
        taskId,
        mode,
        startClientX: event.clientX,
        originStartDate,
        originDuration,
        moved: false,
      }

      const setPreviewBoth = (next: ({ taskId: TaskId } & DragPreview) | null): void => {
        previewRef.current = next
        setPreview(next)
      }

      // 三条收尾路径可能先后触发（pointerup 之后浏览器隐式释放捕获，再补一个
      // lostpointercapture），用这个闸门保证只收一次、只提交一次。
      let finished = false

      const pointerId = event.pointerId
      const captureTarget = event.currentTarget as HTMLElement | null

      const stop = (): void => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleCancel)
        captureTarget?.removeEventListener('lostpointercapture', handleCancel)
      }

      const handleMove = (moveEvent: PointerEvent): void => {
        const state = dragRef.current
        if (!state) return

        const deltaPx = moveEvent.clientX - state.startClientX
        if (!state.moved && Math.abs(deltaPx) < CLICK_THRESHOLD_PX) return
        state.moved = true

        const origin = { startDate: state.originStartDate, duration: state.originDuration }

        // 落点日期 = 被抓住的那条边 + 像素位移换算出的天数。
        // 右把手抓的是右缘，锚点必须是结束日而不是开始日，否则 resizeEnd 会失效。
        const dropDate = addDays(
          dragAnchorDate(state.mode, origin, calendar),
          daysBetweenPixels(deltaPx, dayWidth),
        )

        const next = {
          taskId: state.taskId,
          ...computeDragPreview(state.mode, origin, dropDate, calendar),
        }

        setPreviewBoth(next)
        scheduleDownstream(state.taskId, next)
      }

      const handleUp = (): void => {
        if (finished) return
        finished = true

        const state = dragRef.current
        const latest = previewRef.current

        dragRef.current = null
        stop()
        cancelDownstream()

        // 只有真正拖动过、且影子排期与起点**确实不同**才提交：
        // - 单击（未越过阈值）绝不污染撤销栈
        // - 越过 3px 但不足一天的抖动，落点仍是同一日期 —— 提交它只会
        //   给撤销栈塞一条「看起来什么都没变」的记录，同样跳过
        if (
          state &&
          state.moved &&
          latest &&
          (latest.startDate !== state.originStartDate || latest.duration !== state.originDuration)
        ) {
          onCommitRef.current(state.taskId, state.mode, latest)
        }
        setPreviewBoth(null)
      }

      // 指针被系统取消（触摸打断、浏览器抢占手势），或捕获丢失（在浏览器
      // 窗口外松开鼠标 —— 此时既没有 pointerup 也没有 pointercancel）时收尾，
      // 否则影子预览与 window 监听会一直挂到下一次拖拽。
      const handleCancel = (): void => {
        if (finished) return
        finished = true
        dragRef.current = null
        stop()
        cancelDownstream()
        setPreviewBoth(null)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleCancel)

      // 指针捕获让窗口外松开也能收到 lostpointercapture 兜底。捕获失败
      // （元素已卸载等）不影响正确性 —— 退化为纯 window 监听。
      if (captureTarget) {
        try {
          captureTarget.setPointerCapture(pointerId)
          captureTarget.addEventListener('lostpointercapture', handleCancel)
        } catch {
          /* 捕获不可用时忽略：pointerup / pointercancel 两条路径仍覆盖常规场景 */
        }
      }
    },
    [calendar, dayWidth, scheduleDownstream, cancelDownstream],
  )

  return { preview, downstreamPreview, begin }
}

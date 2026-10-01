import { useCallback, useEffect, useRef, useState } from 'react'
import type { Calendar, Project, TaskId } from '../../domain/model/types'
import { addDays } from '../../domain/calendar/workdays'
import {
  buildShadowTasks,
  computeDragPreview,
  daysBetweenPixels,
  dragAnchorDate,
  type DragMode,
  type DragPreview,
  type ShadowTask,
} from './barDrag'

/** 小于这个像素位移视为点击，不产生任何数据变更 */
const CLICK_THRESHOLD_PX = 3

interface DragState {
  taskId: TaskId
  mode: DragMode
  /** 启动拖拽的那根指针；其他指针的 move 一律忽略 */
  pointerId: number
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

export interface DragShadow {
  /** 被拖的任务 */
  taskId: TaskId
  /** 每个任务的影子排期（**含被拖任务**） */
  tasks: Record<TaskId, ShadowTask>
}

export interface BarDragApi {
  /**
   * 渲染用的影子排期，**含被拖任务本身**；仅在拖拽过程中非空。
   * 它是「假设项目解出来的排期」，因此与松手后真正落盘的结果逐字段一致。
   */
  shadow: DragShadow | null
  begin: (
    event: React.PointerEvent,
    taskId: TaskId,
    mode: DragMode,
    originStartDate: string,
    originDuration: number,
  ) => void
}

/**
 * 任务条拖拽：拖拽期间只更新影子预览（`shadow`），松手才通过 `onCommit`
 * 提交命令。位移小于 3px 视为点击，不产生任何命令 —— 因此**拖拽过程中
 * 撤销栈长度必须保持不变**。
 *
 * 影子是**假设排期**：把被拖任务按该模式真正会提交的变更塞进一份临时 project，
 * 跑一次纯函数 `solve`。它只用于渲染，不进 store、不进撤销栈。
 *
 * 注意影子的几何**不**直接来自 `preview`：`preview` 只是日期算术，对
 * `finishOn` 之类的约束并不等于最终结果（详见 buildShadowTasks 的注释）。
 */
export function useBarDrag({ project, calendar, dayWidth, onCommit }: UseBarDragOptions): BarDragApi {
  const dragRef = useRef<DragState | null>(null)
  const previewRef = useRef<({ taskId: TaskId } & DragPreview) | null>(null)
  const [shadow, setShadow] = useState<DragShadow | null>(null)

  // onCommit 每次渲染都是新函数，用 ref 兜住，避免把它塞进 begin 的依赖数组
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  // 拖拽期间不会有 dispatch，project 引用是稳定的；用 ref 读取即可
  const projectRef = useRef(project)
  projectRef.current = project

  // 假设排期必须节流：1000 个任务时每次 pointermove 都 solve 会卡死主线程。
  // 每次 move 只登记「待重算」，由 rAF 保证每帧最多算一次。
  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef<{ taskId: TaskId; mode: DragMode; preview: DragPreview } | null>(null)

  const cancelShadow = useCallback((): void => {
    pendingRef.current = null
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setShadow(null)
  }, [])

  // 卸载时取消挂起的帧，避免对已卸载组件 setState
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  const scheduleShadow = useCallback(
    (taskId: TaskId, mode: DragMode, next: DragPreview): void => {
      pendingRef.current = { taskId, mode, preview: next }
      if (rafRef.current !== null) return

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null

        const pending = pendingRef.current
        if (!pending) return

        try {
          const current = projectRef.current
          if (!current?.tasks[pending.taskId]) {
            setShadow(null)
            return
          }

          // 假设项目必须与「松手后真正落盘的 project」一致，否则影子会骗人。
          // 按 mode 构造的逻辑集中在 buildHypothetical，与 dragCommitCommands 配对；
          // buildShadowTasks 再把「被拖条 + 下游条」一起解出来。
          setShadow({
            taskId: pending.taskId,
            tasks: buildShadowTasks(current, pending.taskId, pending.mode, pending.preview),
          })
        } catch {
          // 假设排期失败（临时 project 数据异常、成环等）时退化为**不显示**影子。
          // 绝不能因为一次预览计算失败而让整个拖拽崩掉或卡住。
          setShadow(null)
        }
      })
    },
    [],
  )

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
        pointerId: event.pointerId,
        startClientX: event.clientX,
        originStartDate,
        originDuration,
        moved: false,
      }

      // preview 只作为「松手时判断是否真的产生了变更」的依据，不再驱动渲染
      // （渲染一律走 shadow）。用 ref 即可，无需 state。
      const setLatestPreview = (next: ({ taskId: TaskId } & DragPreview) | null): void => {
        previewRef.current = next
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
        // 多指触摸时，只有启动拖拽的那根指针能驱动它
        if (moveEvent.pointerId !== state.pointerId) return

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

        setLatestPreview(next)
        scheduleShadow(state.taskId, state.mode, next)
      }

      const handleUp = (): void => {
        if (finished) return
        finished = true

        const state = dragRef.current
        const latest = previewRef.current

        dragRef.current = null
        stop()
        cancelShadow()

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
        setLatestPreview(null)
      }

      // 指针被系统取消（触摸打断、浏览器抢占手势），或捕获丢失（在浏览器
      // 窗口外松开鼠标 —— 此时既没有 pointerup 也没有 pointercancel）时收尾，
      // 否则影子预览与 window 监听会一直挂到下一次拖拽。
      const handleCancel = (): void => {
        if (finished) return
        finished = true
        dragRef.current = null
        stop()
        cancelShadow()
        setLatestPreview(null)
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
    [calendar, dayWidth, scheduleShadow, cancelShadow],
  )

  return { shadow, begin }
}

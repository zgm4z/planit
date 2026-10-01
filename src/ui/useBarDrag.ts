import { useCallback, useRef, useState } from 'react'
import type { Calendar, TaskId } from '../domain/model/types'
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
  calendar: Calendar
  dayWidth: number
  onCommit: (taskId: TaskId, mode: DragMode, preview: DragPreview) => void
}

export interface BarDragApi {
  /** 当前拖拽的影子排期，仅在拖拽过程中非空；松手提交后立即清空 */
  preview: ({ taskId: TaskId } & DragPreview) | null
  begin: (
    event: React.PointerEvent,
    taskId: TaskId,
    mode: DragMode,
    originStartDate: string,
    originDuration: number,
  ) => void
}

/**
 * 任务条拖拽：拖拽期间只更新影子预览（`preview`），松手才通过 `onCommit`
 * 提交命令。位移小于 3px 视为点击，不产生任何命令 —— 因此**拖拽过程中
 * 撤销栈长度必须保持不变**。
 */
export function useBarDrag({ calendar, dayWidth, onCommit }: UseBarDragOptions): BarDragApi {
  const dragRef = useRef<DragState | null>(null)
  const previewRef = useRef<({ taskId: TaskId } & DragPreview) | null>(null)
  const [preview, setPreview] = useState<({ taskId: TaskId } & DragPreview) | null>(null)

  // onCommit 每次渲染都是新函数，用 ref 兜住，避免把它塞进 begin 的依赖数组
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

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
        const dropDate = addDays(dragAnchorDate(state.mode, origin, calendar), daysBetweenPixels(deltaPx, dayWidth))

        setPreviewBoth({
          taskId: state.taskId,
          ...computeDragPreview(state.mode, origin, dropDate, calendar),
        })
      }

      const handleUp = (): void => {
        if (finished) return
        finished = true

        const state = dragRef.current
        const latest = previewRef.current

        dragRef.current = null
        stop()

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
    [calendar, dayWidth],
  )

  return { preview, begin }
}

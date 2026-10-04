import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { DAY_WIDTH_PRESETS } from '../../store/viewStore'
import { isEditableTarget } from '../shared/isEditableTarget'
import type { TimelineScale } from './timeline'

/** 拖 200px ≈ 放大 e 倍；左右对称（左拖 ×e、右拖 ÷e） */
export const DRAG_ZOOM_SENSITIVITY_PX = 200
/** 每像素 deltaY ≈ 0.2% 缩放；一格滚轮（|deltaY|≈100）≈ ×1.22 / ÷1.22 */
export const WHEEL_ZOOM_SENSITIVITY = 0.002
/** 键盘每次按键 ×1.25 / ÷1.25 */
export const KEYBOARD_ZOOM_FACTOR = 1.25
/** 滚轮 / 键盘连击停止多久后视为「手势结束」（ms）—— 防抖，避免多格滚轮之间闪断 */
export const ZOOM_GESTURE_IDLE_MS = 150

/** deltaPx = clientX - startClientX（左拖为负）。左拖 ⇒ 变宽。 */
export function dayWidthFromDrag(startDayWidth: number, deltaPx: number): number {
  return startDayWidth * Math.exp(-deltaPx / DRAG_ZOOM_SENSITIVITY_PX)
}

/** 归一化不同 deltaMode：0=像素、1=行、2=页 */
export function normalizeWheelDelta(event: Pick<WheelEvent, 'deltaMode' | 'deltaY'>): number {
  if (event.deltaMode === 1) return event.deltaY * 16
  if (event.deltaMode === 2) return event.deltaY * 400
  return event.deltaY
}

/** deltaY 为正（向下滚）⇒ 变窄；为负（向上滚）⇒ 变宽 */
export function dayWidthFromWheel(current: number, deltaY: number): number {
  return current * Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)
}

/** 手势期间依赖层的横向拉伸系数（设计 §8）。起点为 0 / 非有限数时退化为 1。 */
export function scaleXFor(dayWidth: number, gestureStartDayWidth: number): number {
  if (!Number.isFinite(dayWidth) || !Number.isFinite(gestureStartDayWidth)) return 1
  if (gestureStartDayWidth <= 0) return 1
  return dayWidth / gestureStartDayWidth
}

/** 时间轴原点（scale 的 x=0）在视口中的横坐标。甘特视图用甘特区左缘；退化时用滚动口左缘。 */
export function timelineOriginX(
  ganttPane: HTMLElement | null,
  scroll: HTMLElement | null,
): number {
  const el = ganttPane ?? scroll
  return el ? el.getBoundingClientRect().left : 0
}

/** 一次缩放的锚点：光标下的内容坐标（相对时间轴原点）与其对应日期 */
interface Anchor {
  contentX: number
  date: string
}

interface UseTimelineZoomOptions {
  dayWidth: number
  setDayWidth: (dayWidth: number) => void
  scale: TimelineScale
  scrollRef: RefObject<HTMLDivElement | null>
  ganttPaneRef: RefObject<HTMLDivElement | null>
}

export interface TimelineZoomApi {
  /** 是否正处于一次缩放手势中。依赖层据此冻结几何（设计 §8）。 */
  isZooming: boolean
  /** 手势开始时的 dayWidth（非手势中为 null）—— 依赖层冻结的基准 */
  gestureStartDayWidth: number | null
  /** 标尺容器的 onPointerDown —— 尺上左右拖拽缩放 */
  beginRulerDrag: (event: React.PointerEvent) => void
}

/**
 * 甘特时间轴的连续缩放手势（设计 §7）。三种触发：
 *   ① 尺上左右拖拽   ② Ctrl/Cmd + 滚轮（锚在光标）   ③ 键盘 Cmd/Ctrl +/-/0（锚在视口中心）
 *
 * 指针协议照 `useColumnResize`：`window` 监听 + `try/catch` 包 `setPointerCapture`
 * + 三条收尾路径（pointerup / pointercancel / lostpointercapture）+ 卸载 `stopRef`。
 *
 * 滚动位保持（设计 §7.0）：写入 `dayWidth` **之前**记录锚点，写入后由
 * `useLayoutEffect([dayWidth])` 施加 `scrollLeft` —— `--gantt-width` 的 DOM 更新在
 * 提交之后，必须等布局完成再设滚动位，否则会被浏览器按旧 `scrollWidth` 夹断。
 *
 * rAF 合并：滚轮一次手势可发几十条事件，一帧最多 `setDayWidth` 一次。
 */
export function useTimelineZoom({
  dayWidth,
  setDayWidth,
  scale,
  scrollRef,
  ganttPaneRef,
}: UseTimelineZoomOptions): TimelineZoomApi {
  // 事件回调里要读「最新」的 dayWidth / scale / setter —— 一律经 ref，避免把回调依赖搞脏
  const dayWidthRef = useRef(dayWidth)
  dayWidthRef.current = dayWidth
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const setDayWidthRef = useRef(setDayWidth)
  setDayWidthRef.current = setDayWidth

  const [isZooming, setIsZooming] = useState(false)
  const [gestureStartDayWidth, setGestureStartDayWidth] = useState<number | null>(null)

  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef<number | null>(null)
  const anchorRef = useRef<Anchor | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  const currentOriginX = useCallback(
    (): number => timelineOriginX(ganttPaneRef.current, scrollRef.current),
    [ganttPaneRef, scrollRef],
  )

  // 手势开始：置 isZooming，并在第一次进入时固定 gestureStartDayWidth（之后不变）
  const beginGesture = useCallback((): void => {
    setGestureStartDayWidth((prev) => (prev === null ? dayWidthRef.current : prev))
    setIsZooming(true)
  }, [])

  // 滚轮 / 键盘的「手势结束」防抖：150ms 静默后落回 false
  const endGestureSoon = useCallback((): void => {
    if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null
      setIsZooming(false)
      setGestureStartDayWidth(null)
    }, ZOOM_GESTURE_IDLE_MS)
  }, [])

  // rAF 合并的写入口。anchor 为 null 表示不改滚动位（拖拽整个手势复用起点锚点）
  const requestZoom = useCallback((next: number, anchor: Anchor | null): void => {
    pendingRef.current = next
    if (anchor !== null) anchorRef.current = anchor
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const w = pendingRef.current
      if (w === null) return
      setDayWidthRef.current(w)
    })
  }, [])

  // 写入 dayWidth 后（布局完成）施加锚点保持：
  //   scrollLeft' = scrollLeft + daysFromStart(anchor.date) × newDayWidth - anchor.contentX
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (anchor === null) return
    anchorRef.current = null
    const el = scrollRef.current
    if (!el) return
    const s = scaleRef.current
    el.scrollLeft = el.scrollLeft + s.daysFromStart(anchor.date) * dayWidth - anchor.contentX
  }, [dayWidth, scrollRef])

  // ② Ctrl/Cmd + 滚轮：**手动** addEventListener('wheel', …, { passive: false })
  //    —— React 的 onWheel 默认 passive，无法 preventDefault，浏览器会把 Ctrl+滚轮当页面缩放。
  useEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return

    const onWheel = (event: WheelEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return
      event.preventDefault() // 命中才拦：普通滚轮仍纵向滚动、Shift+滚轮仍横向滚动
      const base = pendingRef.current ?? dayWidthRef.current
      const next = dayWidthFromWheel(base, normalizeWheelDelta(event))
      const contentX = event.clientX - currentOriginX()
      const date = scaleRef.current.dateAt(contentX)
      beginGesture()
      endGestureSoon()
      requestZoom(next, { contentX, date })
    }

    scrollEl.addEventListener('wheel', onWheel, { passive: false })
    return () => scrollEl.removeEventListener('wheel', onWheel)
  }, [scrollRef, currentOriginX, beginGesture, endGestureSoon, requestZoom])

  // ③ 键盘：全局 window keydown，焦点在可编辑控件里时不接管
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      if (isEditableTarget(event.target)) return

      const base = pendingRef.current ?? dayWidthRef.current
      let next: number | null = null
      // '+' 需 Shift、某些布局下 key 为 '='；'-' 与 '_' 同理
      if (event.key === '+' || event.key === '=') next = base * KEYBOARD_ZOOM_FACTOR
      else if (event.key === '-' || event.key === '_') next = base / KEYBOARD_ZOOM_FACTOR
      else if (event.key === '0') next = DAY_WIDTH_PRESETS.day
      if (next === null) return

      event.preventDefault() // Ctrl/Cmd +/-/0 在浏览器里默认是页面缩放/复位
      const rect = scrollRef.current?.getBoundingClientRect()
      const clientX = rect ? rect.left + rect.width / 2 : currentOriginX()
      const contentX = clientX - currentOriginX()
      const date = scaleRef.current.dateAt(contentX)
      beginGesture()
      endGestureSoon()
      requestZoom(next, { contentX, date })
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [scrollRef, currentOriginX, beginGesture, endGestureSoon, requestZoom])

  // ① 尺上拖拽
  const beginRulerDrag = useCallback(
    (event: React.PointerEvent): void => {
      if (event.button !== 0) return
      const pointerId = event.pointerId
      const startClientX = event.clientX
      const startDayWidth = dayWidthRef.current
      const captureTarget = event.currentTarget as HTMLElement | null

      // 锚点在起点捕获一次，整个手势复用（稳定的「从按下处捏合」手感；
      // 若每帧以移动中的光标为锚，拖拽会被同时当成平移，手感发黏）。
      const contentX = startClientX - currentOriginX()
      const anchor: Anchor = { contentX, date: scaleRef.current.dateAt(contentX) }

      beginGesture()

      let finished = false
      const stop = (): void => {
        stopRef.current = null
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleCancel)
        captureTarget?.removeEventListener('lostpointercapture', handleLostCapture)
        setIsZooming(false)
        setGestureStartDayWidth(null)
      }
      stopRef.current = stop

      const handleMove = (moveEvent: PointerEvent): void => {
        if (moveEvent.pointerId !== pointerId) return
        // 以拖拽起点为基准的累计位移 —— 不是把增量累加进当前宽（那会越滚越偏）
        requestZoom(dayWidthFromDrag(startDayWidth, moveEvent.clientX - startClientX), anchor)
      }
      const finish = (): void => {
        if (finished) return
        finished = true
        stop()
      }
      const handleUp = (upEvent: PointerEvent): void => {
        if (upEvent.pointerId !== pointerId) return
        finish()
      }
      const handleCancel = (cancelEvent: PointerEvent): void => {
        if (cancelEvent.pointerId !== pointerId) return
        finish()
      }
      // lostpointercapture 是最后兜底：窗口外松开时既无 pointerup 也无 pointercancel。
      // 漏收会让监听粘着，故**刻意不设守卫**（与 useColumnResize 同）。
      const handleLostCapture = (): void => finish()

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleCancel)

      if (captureTarget) {
        try {
          captureTarget.setPointerCapture(pointerId)
          captureTarget.addEventListener('lostpointercapture', handleLostCapture)
        } catch {
          /* 捕获不可用（jsdom）时退化为纯 window 监听，不影响正确性 */
        }
      }
    },
    [currentOriginX, beginGesture, requestZoom],
  )

  // 卸载兜底：摘监听 + 取消挂起的 rAF / 防抖计时器
  useEffect(
    () => () => {
      stopRef.current?.()
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current)
    },
    [],
  )

  return { isZooming, gestureStartDayWidth, beginRulerDrag }
}

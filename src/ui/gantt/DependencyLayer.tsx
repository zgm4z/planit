import { memo } from 'react'
import type { Dependency, DependencyId, TaskId } from '../../domain/model/types'
import { anchorsFor, routePath } from './dependencyRouting'
import type { Rect } from './timeline'

interface DependencyLayerProps {
  dependencies: Dependency[]
  /**
   * taskId → 任务条的绝对矩形（相对甘特图内容原点，含纵向位置）。
   *
   * 由调用方用 `barRect` / `milestoneRect` 算好再传进来 —— 与 TaskBar 的定位
   * **同源**。本层不自己重算几何，避免两处算法漂移。
   */
  rectByTaskId: Map<TaskId, Rect>
  totalHeight: number
  totalWidth: number
}

/**
 * 依赖连线层。整层是一张覆盖在甘特图上的 SVG，
 * 用 `pointer-events:none` 让鼠标事件穿透到下面的任务条。
 *
 * ── 为什么 memo ──────────────────────────────────────────────────────────
 * 每一条依赖都要 `routePath` 出一段 SVG path（本项目 11,200 条，即 11,200 个
 * `<path>`）。这层的输出**只由 props 决定**：`rectByTaskId` 与
 * `totalHeight` / `totalWidth` 在 ProjectView 里都已 useMemo，滚动时不变；
 * `dependencies` 是调用方 `Object.values(...)` 的产物 —— 只要调用方把它也
 * memo 住（见 ProjectView），四个 props 在滚动帧里就全部恒等，memo 即可整层跳过。
 * 滚动时重算这 11,200 段路径纯属浪费（实测是甘特侧的一笔可观开销）。
 */
function DependencyLayerComponent({
  dependencies,
  rectByTaskId,
  totalHeight,
  totalWidth,
}: DependencyLayerProps) {
  const segments: { id: DependencyId; dep: Dependency; d: string }[] = []

  for (const dep of dependencies) {
    const fromRect = rectByTaskId.get(dep.fromTaskId)
    const toRect = rectByTaskId.get(dep.toTaskId)

    // 任一端没有矩形（被折叠、是摘要任务、或滚出可见行）就跳过这条线，
    // 否则会画到错误的行上
    if (!fromRect || !toRect) continue

    const { start, end } = anchorsFor(dep.type, fromRect, toRect)
    segments.push({ id: dep.id, dep, d: routePath(start, end) })
  }

  return (
    <svg
      width={totalWidth}
      height={totalHeight}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
        zIndex: 2,
        // SVG 根元素默认 overflow:hidden。原点处的里程碑其菱形外接盒左缘在
        // x = -2.485，会被 viewport 裁掉；本层是 pointer-events:none，放开无副作用。
        overflow: 'visible',
      }}
      aria-hidden
      data-testid="dependency-layer"
    >
      <defs>
        <marker
          id="dep-arrow"
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3.5"
          orient="auto"
        >
          <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--planit-text-muted)" />
        </marker>
      </defs>

      {segments.map((segment) => (
        <path
          key={segment.id}
          d={segment.d}
          fill="none"
          stroke="var(--planit-text-muted)"
          strokeWidth={1.4}
          markerEnd="url(#dep-arrow)"
          data-testid="dependency-path"
          data-dep-id={segment.id}
          data-dep-from={segment.dep.fromTaskId}
          data-dep-to={segment.dep.toTaskId}
          data-dep-type={segment.dep.type}
        />
      ))}
    </svg>
  )
}

/** memo 化（见上）。props 恒等时整层的 11,200 段路径不会重算。 */
export const DependencyLayer = memo(DependencyLayerComponent)

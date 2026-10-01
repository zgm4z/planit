import { useEffect, useState } from 'react'
import { COMPACT_LAYOUT_WIDTH, NARROW_LAYOUT_WIDTH } from './outlineColumns'

/**
 * 用 `matchMedia` 订阅一个媒体查询（spec §7 的响应式）。
 *
 * 为什么**不用 `window.innerWidth`**：单测跑在 jsdom 里，`innerWidth` 是个固定
 * 假值（1024），会让所有单测都落进「窄屏」分支，把一个纯桌面断言变成需要模拟
 * 视口的断言。而 `matchMedia` 在 vitest.setup.ts 里有一个**返回 `matches:false`**
 * 的最小桩 —— 于是单测天然落回「宽屏」这一支，与改动前的桌面行为一致。
 * 真实浏览器（含 e2e）里 matchMedia 走真实布局，行为正确。
 *
 * 同时也比 `innerWidth` 更准：它监听的是**媒体查询的命中**，与 CSS 用的是同一套
 * 断点判定，不会因为滚动条、缩放等因素与 CSS 产生 1px 的分歧。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    // 挂载时对齐一次：首次渲染与 effect 之间窗口可能已经变过
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

export interface LayoutMode {
  /** < 1100：右栏改抽屉、隐藏「备注 / ID / 优先级」、工具栏溢出 */
  isNarrow: boolean
  /** < 900：只剩「标题 / 开始 / 结束 / 工期」 */
  isCompact: boolean
}

/**
 * 当前布局档位（spec §7）。`isCompact` 蕴含 `isNarrow`（两个查询是嵌套的）。
 *
 * 断点数值从 `outlineColumns`（列与断点的权威、且刻意不依赖 React）取，避免
 * 「一处 1099、一处 1100」这类 off-by-one 在 CSS 与 JS 之间静默分歧。
 */
export function useLayoutMode(): LayoutMode {
  // `max-width: W-1` 表达「严格小于 W」，与 SCSS 里的 `max-width` 写法一致
  const isNarrow = useMediaQuery(`(max-width: ${NARROW_LAYOUT_WIDTH - 1}px)`)
  const isCompact = useMediaQuery(`(max-width: ${COMPACT_LAYOUT_WIDTH - 1}px)`)
  return { isNarrow, isCompact }
}

/**
 * 复选的纯计算层。**不碰 DOM、不碰 store** —— 只吃「可见行序 order + 当前集合 + 修饰键」，
 * 吐出新的集合与锚点。大纲树与资源树共用这一份（两棵树是不同实体，但**选区语义相同**）。
 *
 * 「按该次操作当下的可见行序算范围」就落在这里：`order` 由调用方按当前 `rows` 传入，
 * 折叠/展开后的 order 不同 → 同一个终点的范围不同。范围一经 settle 成集合即固化，
 * 与之后的 order 变化无关（那是调用方不再重算，不是这里的职责）。
 */

export interface SelectionMods {
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/** order 中 anchor..focus 的闭区间；任一端点不在 order 里返回 [] */
export function selectionRange(order: readonly string[], anchor: string, focus: string): string[] {
  const a = order.indexOf(anchor)
  const b = order.indexOf(focus)
  if (a < 0 || b < 0) return []
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return order.slice(lo, hi + 1)
}

/** 保序地加入 / 移除一个 id */
export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((current) => current !== id) : [...ids, id]
}

/**
 * 点击 → 新选中态。三种语义的唯一实现（大纲 / 甘特 / 资源树都调它）：
 *   Shift（且有锚点）→ 以锚点为起点的连续范围，锚点保留；
 *   Ctrl/Cmd        → 切换该行；加入时锚点=被点项，移除锚点时落到剩余末元素；
 *   普通            → 收敛为单选。
 */
export function resolveClickSelection(
  order: readonly string[],
  current: readonly string[],
  anchor: string | null,
  clicked: string,
  mods: SelectionMods,
): { ids: string[]; anchor: string | null } {
  if (mods.shiftKey && anchor !== null) {
    const range = selectionRange(order, anchor, clicked)
    if (range.length > 0) return { ids: range, anchor }
  }
  if (mods.ctrlKey || mods.metaKey) {
    const ids = toggleId(current, clicked)
    // 加入该行 → 锚点跟随到被点项。
    if (ids.includes(clicked)) return { ids, anchor: clicked }
    // 移除该行 → 锚点若仍在集合里**必须保留**（被移除的可能只是中间的非锚点项）；
    // 只有当被移除的正是锚点时才回落到剩余末元素，集合清空则置空。
    const nextAnchor =
      anchor !== null && ids.includes(anchor) ? anchor : ids.length > 0 ? ids[ids.length - 1] : null
    return { ids, anchor: nextAnchor }
  }
  return { ids: [clicked], anchor: clicked }
}

/**
 * Shift+↑/↓：以锚点为一端、当前焦点（离锚点最远的已选项）为另一端，向 delta 扩一格。
 * 到 order 边界后返回当前区间（不越界）。
 */
export function extendRange(
  order: readonly string[],
  anchor: string,
  ids: readonly string[],
  delta: 1 | -1,
): string[] {
  const a = order.indexOf(anchor)
  if (a < 0) return [...ids]

  let focus = a
  for (const id of ids) {
    const i = order.indexOf(id)
    if (i < 0) continue
    if (Math.abs(i - a) > Math.abs(focus - a)) focus = i
  }

  const next = Math.min(order.length - 1, Math.max(0, focus + delta))
  const lo = Math.min(a, next)
  const hi = Math.max(a, next)
  return order.slice(lo, hi + 1)
}

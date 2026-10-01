/**
 * 布局断点（spec §7，与 Mantine 的 `$breakpoint-md: 900px` 对齐）。
 *
 * **这是 1100 / 900 这两个数值在全项目唯一的一份定义。** 它们属于**布局层**，
 * 与「大纲列」无关 —— 因此放在 `shared/`，而不是某个功能包（曾经错放在
 * `outline/outlineColumns.ts`，导致 `shared/useBreakpoints.ts` 反向依赖 `outline`）。
 *
 * 为什么必须只有一份：`useLayoutMode()` 把它们翻成媒体查询，`global.scss` 把它们
 * 镜像成 `@media (max-width: ...)`。一旦某处漂移（一处 1099、一处 1100），CSS 的
 * 命中与 JS 的判断就会静默分歧，表现为「工具栏收了、列没藏」这类只有肉眼能发现的
 * bug。这正是本项目 v0.2 栽过的「同一条规则两份实现」那一类病 —— 新加响应式逻辑时，
 * 先回到这里。
 *
 * `NARROW`：< 1100 —— 右栏改抽屉、左列 280、隐藏「备注 / ID / 优先级」、工具栏溢出。
 * `COMPACT`：< 900 —— 只剩「标题 / 开始 / 结束 / 工期」，左列 240。
 */
export const NARROW_LAYOUT_WIDTH = 1100
export const COMPACT_LAYOUT_WIDTH = 900



/**
 * 资源树的列描述。与任务列的 `outlineColumns.ts` **同一手法**（注册表 + width + labelKey），
 * 但**另一份**：列的面孔不同（类型 / 资源），取值不是 `getOutlineCellValue` 能给的
 * （那个函数只认 `Task`）。见 spec §6.1。
 */
export type ResourceColumnKey = 'kind' | 'name'

export interface ResourceColumn {
  key: ResourceColumnKey
  /**
   * 列宽（px）。`name` 用 flex:1 吃剩余宽度。
   *
   * 对 `measured` 列，这个值是**测量完成前的兜底**，不是最终宽度 —— 真正的宽度由
   * 运行时测量得到（见 `ResourceTree` 的测量元素与 `resourceColumnWidthVar`）。
   */
  width: number
  labelKey: string
  flex?: boolean
  /**
   * 该列的宽度**不是写死的常量，而是运行时按内容测量**（当前语言下最宽的标签）。
   *
   * 为什么 `kind` 列必须这样：资源树把「类型」渲染成**文字**（`resource.kind_*`），
   * 而三语标签长度差很大 —— 中文「群组」2 字 ≈ 26px，日文「グループ」4 字，
   * 英文「Equipment」9 字 ≈ 63px。此前把它与任务树的 `kind` 列一样写死 28px，
   * 那是给任务树的**单字符字形**（▤/◆/▪）定的宽，塞文字进去就在字形中间被切断
   * （「群组」渲染成「群纟」）—— 这正是要修的缺陷。见 spec §6.1。
   */
  measured?: boolean
}

export const RESOURCE_COLUMNS: readonly ResourceColumn[] = [
  // 28 只是测量完成前的兜底（`useLayoutEffect` 在首次绘制前就跑，用户看不到它）
  { key: 'kind', width: 28, labelKey: 'resourceView.columns.kind', measured: true },
  { key: 'name', width: 240, labelKey: 'resourceView.columns.name', flex: true },
]

// `RESOURCE_KINDS` 的唯一实现在 `domain/model/`（三层共用），此处只转出，
// 让本模块的消费者仍能从列描述里拿到它。
export { RESOURCE_KINDS } from '../../domain/model/resourceKinds'

/**
 * 某列「由运行时测量决定宽度」时用的 CSS 变量名。
 *
 * 变量名从列 key 派生（`--planit-resource-kind-width`），这样 `ResourceTree` 写值
 * 与 `resourceCellFlex` 读值是**同一个字符串**，不会各写一份而漂移。
 */
export function resourceColumnWidthVar(column: ResourceColumn): string {
  return `--planit-resource-${column.key}-width`
}

/**
 * 与 `outlineColumns.cellFlex` 同一条不变量：表头与单元格读同一个 flex 值。
 *
 * `measured` 列改读 CSS 变量 —— 变量由 `ResourceTree` 挂到树根、按当前语言测量后写入。
 * **每一行的 `kind` 单元格与表头都读同一个变量**，于是四行共享同一个宽度，
 * 名字列的起始 x 逐行对齐（这是「动态」二字的唯一正确含义：不是 `flex: 0 0 auto`
 * 那种按各自标签算宽的做法 —— 那样日文/英文各行宽度不同、列会错位）。
 */
export function resourceCellFlex(column: ResourceColumn): string {
  if (column.measured) return `0 0 var(${resourceColumnWidthVar(column)}, ${column.width}px)`
  return column.flex ? `1 1 ${column.width}px` : `0 0 ${column.width}px`
}

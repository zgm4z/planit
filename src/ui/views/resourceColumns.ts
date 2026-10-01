/**
 * 资源树的列描述。与任务列的 `outlineColumns.ts` **同一手法**（注册表 + width + labelKey），
 * 但**另一份**：列的面孔不同（类型 / 资源），取值不是 `getOutlineCellValue` 能给的
 * （那个函数只认 `Task`）。见 spec §6.1。
 */
export type ResourceColumnKey = 'kind' | 'name'

export interface ResourceColumn {
  key: ResourceColumnKey
  /** 列宽（px）。`name` 用 flex:1 吃剩余宽度 */
  width: number
  labelKey: string
  flex?: boolean
}

export const RESOURCE_COLUMNS: readonly ResourceColumn[] = [
  { key: 'kind', width: 28, labelKey: 'resourceView.columns.kind' },
  { key: 'name', width: 240, labelKey: 'resourceView.columns.name', flex: true },
]

/** 与 `outlineColumns.cellFlex` 同一条不变量：表头与单元格读同一个 flex 值 */
export function resourceCellFlex(column: ResourceColumn): string {
  return column.flex ? `1 1 ${column.width}px` : `0 0 ${column.width}px`
}

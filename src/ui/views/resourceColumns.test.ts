import { describe, it, expect } from 'vitest'
import {
  RESOURCE_COLUMNS,
  RESOURCE_KINDS,
  resourceCellFlex,
  resourceColumnWidthVar,
} from './resourceColumns'
import zhCN from '../../i18n/locales/zh-CN.json'
import enUS from '../../i18n/locales/en-US.json'
import jaJP from '../../i18n/locales/ja-JP.json'

const kindColumn = RESOURCE_COLUMNS.find((column) => column.key === 'kind')!
const nameColumn = RESOURCE_COLUMNS.find((column) => column.key === 'name')!

describe('资源列：kind 列的宽度由运行时测量决定', () => {
  it('kind 列标了 measured，且它的 flex 读 CSS 变量（不是写死像素）', () => {
    expect(kindColumn.measured).toBe(true)
    // 关键：必须是 var(...)，不是 `0 0 28px` —— 写死 28px 正是本次要修的缺陷
    // （它只能装下单字符的任务树字形，装不下「群组」两个字）。
    expect(resourceCellFlex(kindColumn)).toBe(
      '0 0 var(--planit-resource-kind-width, 28px)',
    )
  })

  it('CSS 变量名从列 key 派生 —— 写值（ResourceTree）与读值（resourceCellFlex）同一个字符串', () => {
    expect(resourceColumnWidthVar(kindColumn)).toBe('--planit-resource-kind-width')
    expect(resourceCellFlex(kindColumn)).toContain(resourceColumnWidthVar(kindColumn))
  })

  it('name 列仍是 flex:1（吃剩余宽度），未受影响', () => {
    expect(nameColumn.measured).toBeFalsy()
    expect(resourceCellFlex(nameColumn)).toBe('1 1 240px')
  })

  it('fallback 值就是列定义里的 width（两处不会各写一份而漂移）', () => {
    expect(resourceCellFlex(kindColumn)).toContain(`${kindColumn.width}px`)
  })
})

/** 三语 i18n 里 `resource.kind_*` 的取值集合 */
function kindKeysFromLabels(node: unknown): string[] {
  return Object.keys(node as Record<string, unknown>)
    .filter((key) => key.startsWith('kind_'))
    .map((key) => key.slice('kind_'.length))
    .sort()
}

describe('RESOURCE_KINDS 与文案一一对应（测量样本不能漏掉任何一种类型）', () => {
  it('集合等于 zh / en / ja 的 resource.kind_* 键（少一个 → 那种类型的列宽量不到）', () => {
    const expected = [...RESOURCE_KINDS].sort()
    expect(kindKeysFromLabels(zhCN.resource)).toEqual(expected)
    expect(kindKeysFromLabels(enUS.resource)).toEqual(expected)
    expect(kindKeysFromLabels(jaJP.resource)).toEqual(expected)
  })
})

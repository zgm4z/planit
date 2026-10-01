import { describe, it, expect } from 'vitest'
import zhCN from '../i18n/locales/zh-CN.json'
import enUS from '../i18n/locales/en-US.json'
import jaJP from '../i18n/locales/ja-JP.json'
import { DEFAULT_OPEN_GROUPS, INSPECTOR_GROUPS, isInspectorGroupKey } from './inspectorGroups'

/** 收集一棵字典树的全部「叶子字符串」路径 —— 用来比对三语的键集合 */
function leafKeys(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix]
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
      leafKeys(value, prefix ? `${prefix}.${key}` : key),
    )
  }
  return []
}

// 带 `inspector` 前缀：注册表里的 labelKey / reasonKey 是全路径
// （与 outlineColumns.ts 的 'outline.columns.kind' 同口径），所以叶子键也要带前缀才能比对。
const zhKeys = leafKeys(zhCN.inspector, 'inspector').sort()
const enKeys = leafKeys(enUS.inspector, 'inspector').sort()
const jaKeys = leafKeys(jaJP.inspector, 'inspector').sort()

/**
 * v0.2 新增、但**从未补过 i18n** 的 7 条命令标签 —— 本版 Inspector 第一次用它们，
 * 撤销气泡（Toolbar 里 `t(command.label)`）会显示裸 key，所以必须一并补齐。
 * `task.setNote` 在 v0.3 已补，不在此列。
 */
const NEW_COMMAND_KEYS = [
  'task.setSchedulingOrder',
  'task.setPriority',
  'task.setDelay',
  'task.setAllowSplitting',
  'project.setDirection',
  'project.setStartDate',
  'project.setEndDate',
] as const

describe('INSPECTOR_GROUPS', () => {
  it('恰好 7 组，顺序与 spec §3 一致（任务信息 / 日程安排 / 基线 / 相关性 / 分配的资源 / 资源分配 / 预计的工作量）', () => {
    expect(INSPECTOR_GROUPS.map((group) => group.key)).toEqual([
      'info',
      'schedule',
      'baseline',
      'relations',
      'assignments',
      'allocation',
      'expectedEffort',
    ])
  })

  it('每个 key 唯一', () => {
    const keys = INSPECTOR_GROUPS.map((group) => group.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('默认展开 = 任务信息 / 日程安排 / 基线 / 相关性 / 分配的资源（spec §5），且不持久化', () => {
    expect(DEFAULT_OPEN_GROUPS).toEqual(['info', 'schedule', 'baseline', 'relations', 'assignments'])
  })

  it('不变式：默认展开的 ⟺ 非占位组（本版真正能改的四组对三个占位组）', () => {
    for (const group of INSPECTOR_GROUPS) {
      expect(DEFAULT_OPEN_GROUPS.includes(group.key), group.key).toBe(!group.placeholder)
    }
  })

  it('占位组必须有 reasonKey，非占位组不允许有', () => {
    for (const group of INSPECTOR_GROUPS) {
      if (group.placeholder) {
        expect(group.reasonKey, `${group.key} 缺 reasonKey`).toBeTruthy()
      } else {
        expect(group.reasonKey, `${group.key} 不该有 reasonKey`).toBeUndefined()
      }
    }
  })

  it('每组的 labelKey 与 reasonKey 都在 zh-CN 的 inspector 叶子键里', () => {
    for (const group of INSPECTOR_GROUPS) {
      expect(zhKeys, `${group.key} 的 labelKey 不存在`).toContain(group.labelKey)
      if (group.reasonKey) expect(zhKeys).toContain(group.reasonKey)
    }
  })
})

describe('isInspectorGroupKey', () => {
  it('认识的 key 通过，其余一律拒绝', () => {
    expect(isInspectorGroupKey('info')).toBe(true)
    expect(isInspectorGroupKey('expectedEffort')).toBe(true)
    expect(isInspectorGroupKey('ghost')).toBe(false)
    expect(isInspectorGroupKey(42)).toBe(false)
    expect(isInspectorGroupKey(null)).toBe(false)
  })
})

describe('inspector 的三语文案', () => {
  it('zh / en / ja 的 inspector 叶子键集合完全相等 —— 缺一个翻译就会红（不出现裸 key）', () => {
    expect(enKeys).toEqual(zhKeys)
    expect(jaKeys).toEqual(zhKeys)
  })

  it('叶子键数量足够多（新增的几十个字段文案确实落盘了）', () => {
    expect(zhKeys.length).toBeGreaterThan(60)
  })

  it('commands 块的三语键集合一致，且 v0.2 的 7 条命令标签都补齐了', () => {
    const zhCmd = leafKeys(zhCN.commands).sort()
    expect(leafKeys(enUS.commands).sort()).toEqual(zhCmd)
    expect(leafKeys(jaJP.commands).sort()).toEqual(zhCmd)

    for (const key of NEW_COMMAND_KEYS) {
      expect(zhCmd, `zh 缺 ${key}`).toContain(key)
      expect(leafKeys(enUS.commands)).toContain(key)
      expect(leafKeys(jaJP.commands)).toContain(key)
    }
  })
})

import { describe, it, expect } from 'vitest'
import zhCN from './locales/zh-CN.json'
import enUS from './locales/en-US.json'
import jaJP from './locales/ja-JP.json'

type Dict = Record<string, unknown>

/** 递归收集「点分路径」键，用于跨语言同一性断言（漏翻一整个子树也能被抓住） */
function flattenKeys(value: Dict, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return child && typeof child === 'object' && !Array.isArray(child)
      ? flattenKeys(child as Dict, path)
      : [path]
  })
}

const REQUIRED_OUTLINE_EDIT_KEYS = [
  'outline.edit.aria',
  'outline.edit.invalidNumber',
  'outline.edit.disabled.group',
  'outline.edit.disabled.manualDuration',
  'outline.edit.disabled.milestone',
  'outline.edit.disabled.fixedDuration',
  'outline.edit.disabled.noSchedule',
]

describe('i18n 语料', () => {
  it('三语键集合完全一致（无漏翻）', () => {
    const zh = [...flattenKeys(zhCN)].sort()
    expect([...flattenKeys(enUS)].sort()).toEqual(zh)
    expect([...flattenKeys(jaJP)].sort()).toEqual(zh)
  })

  it('内联编辑的 key 三语齐全', () => {
    for (const dict of [zhCN, enUS, jaJP]) {
      const keys = new Set(flattenKeys(dict))
      for (const key of REQUIRED_OUTLINE_EDIT_KEYS) expect(keys.has(key), key).toBe(true)
    }
  })
})

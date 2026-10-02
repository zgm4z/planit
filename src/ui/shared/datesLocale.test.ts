import { describe, it, expect } from 'vitest'

import { toDayjsLocale } from './datesLocale'

describe('toDayjsLocale（i18n 语言 → dayjs locale，两套 locale 的桥）', () => {
  it('三种受支持语言都映射到 dayjs 的 locale 串', () => {
    expect(toDayjsLocale('zh-CN')).toBe('zh-cn')
    expect(toDayjsLocale('en-US')).toBe('en')
    expect(toDayjsLocale('ja-JP')).toBe('ja')
  })

  it('未知 / undefined 退回默认语言（zh-CN）的映射，不抛', () => {
    expect(toDayjsLocale(undefined)).toBe('zh-cn')
    expect(toDayjsLocale('fr-FR')).toBe('zh-cn')
  })
})

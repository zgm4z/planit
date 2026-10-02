import { describe, it, expect } from 'vitest'

import {
  DEFAULT_FINISH_TIME,
  DEFAULT_START_TIME,
  ensureDateTime,
  formatDateTime,
  isDateTimeStr,
  parseDateTime,
  toDateStr,
  toDateTime,
} from './dateTime'

describe('toDateStr（全仓唯一的归一化入口）', () => {
  it('带时刻 → 日期', () => {
    expect(toDateStr('2026-09-14T09:00')).toBe('2026-09-14')
  })
  it('纯日期原样返回（幂等）', () => {
    expect(toDateStr('2026-09-14')).toBe('2026-09-14')
  })
  it('空串原样返回', () => {
    expect(toDateStr('')).toBe('')
  })
})

describe('toDateTime', () => {
  it('默认补上班时刻', () => {
    expect(toDateTime('2026-09-14')).toBe('2026-09-14T09:00')
    expect(DEFAULT_START_TIME).toBe('09:00')
  })
  it('可指定时刻（下班）', () => {
    expect(toDateTime('2026-09-14', DEFAULT_FINISH_TIME)).toBe('2026-09-14T18:00')
  })
  it('带时刻的输入先归一再加默认时刻（不保留原时刻 —— 语义是「日期 + 显式时刻」）', () => {
    expect(toDateTime('2026-09-14T14:30')).toBe('2026-09-14T09:00')
  })
})

describe('isDateTimeStr（落盘闸门）', () => {
  it('只接受完整的 YYYY-MM-DDTHH:mm', () => {
    expect(isDateTimeStr('2026-09-14T09:00')).toBe(true)
    expect(isDateTimeStr('2026-09-14')).toBe(false)
    expect(isDateTimeStr('2026-09-14T9:00')).toBe(false)
    expect(isDateTimeStr('2026-09-14T09:00:00')).toBe(false)
    expect(isDateTimeStr('')).toBe(false)
  })
})

describe('ensureDateTime', () => {
  it('已带时刻 → 原样（保留用户选的 14:30）', () => {
    expect(ensureDateTime('2026-09-14T14:30')).toBe('2026-09-14T14:30')
  })
  it('纯日期 → 补默认时刻', () => {
    expect(ensureDateTime('2026-09-14')).toBe('2026-09-14T09:00')
  })
  it('空串 → 空串（UI 的「未设」哨兵，与 DateField 的 value 契约一致）', () => {
    expect(ensureDateTime('')).toBe('')
  })
})

describe('parseDateTime / formatDateTime 往返（本地时区，无 UTC 漂移）', () => {
  it('往返稳定', () => {
    expect(formatDateTime(parseDateTime('2026-09-14T14:30'))).toBe('2026-09-14T14:30')
  })
  it('跨日边界不差一天', () => {
    expect(formatDateTime(parseDateTime('2026-12-31T23:59'))).toBe('2026-12-31T23:59')
    expect(formatDateTime(parseDateTime('2026-01-01T00:00'))).toBe('2026-01-01T00:00')
  })
})

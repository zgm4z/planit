import type { DateStr } from './model/types'

/** YYYY-MM-DD 与 Date 互转，全部按本地时区解释，避免 UTC 偏移导致差一天 */

export function parseDate(iso: DateStr): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function formatDate(date: Date): DateStr {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDays(iso: DateStr, n: number): DateStr {
  const date = parseDate(iso)
  date.setDate(date.getDate() + n)
  return formatDate(date)
}

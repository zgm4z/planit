import type { DateStr } from '../../domain/model/types'
import { addDays, formatDate, parseDate } from '../../domain/dateUtils'

/**
 * 以 `anchor` 所在月生成 **6×7 = 42 格**的月网格（周一起始），返回长度 42 的数组。
 * 补白格为 `null`（上月末 / 下月初）。首格 = 本月 1 日所在周的周一。
 *
 * 纯函数：只依赖 dateUtils，不碰 i18n / React —— 单测不必初始化语言。
 *
 * 「属于 anchor 所在月」一律用 `YYYY-MM` 字符串比较（**不要**用 `getMonth()`：`addDays`
 * 跨年时月份会绕回去，12 月的网格会被判成 1 月）。
 */
export function monthMatrix(anchor: DateStr): (DateStr | null)[] {
  const base = parseDate(anchor)
  const firstOfMonth = new Date(base.getFullYear(), base.getMonth(), 1)
  // 周一 = 0 … 周日 = 6（与 Calendar.workingDays 的索引顺序一致）
  const offset = (firstOfMonth.getDay() + 6) % 7
  const start = addDays(formatDate(firstOfMonth), -offset)
  const yearMonth = anchor.slice(0, 7)

  const cells: (DateStr | null)[] = []
  for (let i = 0; i < 42; i += 1) {
    const date = addDays(start, i)
    cells.push(date.slice(0, 7) === yearMonth ? date : null)
  }
  return cells
}

/** 月份位移（上一月 / 下一月）。锚定到该月 1 日，避免 31 日 +1 月溢出到下下月 */
export function shiftMonth(anchor: DateStr, delta: number): DateStr {
  const base = parseDate(anchor)
  return formatDate(new Date(base.getFullYear(), base.getMonth() + delta, 1))
}

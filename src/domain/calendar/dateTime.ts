import type { DateStr, DateTimeStr } from '../model/types'
import { formatDate, parseDate } from '../dateUtils'

/**
 * 带时刻的日期串与纯日期的**唯一**归一化/构造模块。
 *
 * 为什么必须集中在一处：`DateStr` 与 `DateTimeStr` 都是 `string` 的别名，
 * **互相可赋值** —— 编译期拦不住混用（spec §3.4）。混用的后果是**静默**的：
 * `'2026-09-14T09:00' < '2026-09-14'` 为假、`parseDate` 会得到 `Invalid Date`
 * （`dateUtils.ts:5-8` 做 `split('-').map(Number)`，`Number('14T09:00') = NaN`）。
 * 故全仓的切片 / 比较 / 构造**只从本模块走**（`dateTime.guard.test.ts` 守卫）。
 *
 * 本项目为此栽过多次（`deriveKind` / `computeProjectSummary` / `Σunits` /
 * `findActiveBaseline`）—— 「同一规则两份实现」是本仓库最高频的缺陷类型。
 */

/** `YYYY-MM-DDTHH:mm`（本地时区、无秒）—— 与 `parseDateTime` / `formatDateTime` 同口径 */
export const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 上班时刻：项目 / 任务约束 / 资源可用期的下界默认 */
export const DEFAULT_START_TIME = '09:00'
/** 下班时刻：项目结束 / 基准日 / 资源可用期的上界默认 */
export const DEFAULT_FINISH_TIME = '18:00'

/**
 * 带时刻 → 纯日期。**幂等**：对纯日期原样返回，对空串原样返回。
 * 引擎与几何的每一条边界都调它（见计划 Task 2）。
 */
export function toDateStr(value: string): DateStr {
  const head = value.slice(0, 10)
  return DATE_RE.test(head) ? head : value
}

/** 纯日期 + 显式时刻 → 带时刻。`date` 若已带时刻会被先归一（时刻取 `time`，不保留原时刻）。 */
export function toDateTime(date: DateStr, time: string = DEFAULT_START_TIME): DateTimeStr {
  return `${toDateStr(date)}T${time}`
}

/** 落盘闸门：只接受完整的 `YYYY-MM-DDTHH:mm`（半截输入留在控件草稿里，不落盘）。 */
export function isDateTimeStr(value: string): boolean {
  return DATE_TIME_RE.test(value)
}

/**
 * 补全为带时刻：已带时刻则原样（保留用户选的 `14:30`），纯日期补 `fallbackTime`，
 * 空串原样返回（`''` 是 UI 的「未设」哨兵，与 `DateField` 的 `value` 契约一致）。
 */
export function ensureDateTime(
  value: string,
  fallbackTime: string = DEFAULT_START_TIME,
): DateTimeStr {
  if (value === '') return ''
  return isDateTimeStr(value) ? value : toDateTime(toDateStr(value), fallbackTime)
}

/** 带时刻 → `Date`（**本地时区**，绝不经 UTC —— 与 `dateUtils` 的既有约定一致）。 */
export function parseDateTime(dt: DateTimeStr): Date {
  const date = parseDate(toDateStr(dt))
  // 从第 11 位起取 `HH:mm`；非法输入（非日期或非时刻）退化为当日 00:00，绝不产生 Invalid Date。
  const [hh, mm] = dt.slice(11, 16).split(':').map(Number)
  date.setHours(Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0, 0, 0)
  return date
}

/** `Date` → 带时刻（本地时区，秒被抹掉）。 */
export function formatDateTime(date: Date): DateTimeStr {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${formatDate(date)}T${hh}:${mm}`
}

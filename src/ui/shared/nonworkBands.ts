import type { Calendar, DateStr } from '../../domain/model/types'
import { addDays, isWorkday } from '../../domain/calendar/workdays'

/** 时间轴上一段整列的横向占位（相对时间轴原点的左偏移 + 宽度），单位 px */
export interface TimelineBand {
  left: number
  width: number
}

/**
 * 非工作日整列的横向占位 —— 甘特底纹与资源分配时间线**共用这一份**。
 *
 * 为什么走领域日历而不是硬编码「周一至周五」：底纹必须与**用户可编辑的日历**一致。
 * 用户取消勾选周五、或把某个周三设为假日时，引擎会跳过那天，底纹若仍只盖周六周日，
 * 界面就自相矛盾。`isWorkday(date, calendar)` 的取反把周规则与例外日期一并覆盖。
 *
 * 为什么放 `shared/` 而不是 `views/`：它**就是**为跨视图共用而生（甘特区与资源时间线
 * 是同一种东西，不该各写一遍 —— 本项目栽过「同一概念两份实现」多次）。放 `shared/`
 * 还满足包依赖守卫：本函数只吃标量（起始日 / 总天数 / 日宽 / 日历），**不** import
 * `gantt/timeline` 的 `TimelineScale` —— 否则 `shared` 会反向依赖 `gantt`，触发
 * `packageDeps.test.ts` 的红色。
 */
export function nonworkBands(
  startDate: DateStr,
  totalDays: number,
  dayWidth: number,
  calendar: Calendar,
): TimelineBand[] {
  const bands: TimelineBand[] = []
  for (let day = 0; day < totalDays; day += 1) {
    if (!isWorkday(addDays(startDate, day), calendar)) {
      bands.push({ left: day * dayWidth, width: dayWidth })
    }
  }
  return bands
}

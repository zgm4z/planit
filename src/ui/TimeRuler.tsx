import { addDays } from '../domain/calendar/workdays'
import type { TimelineScale } from './timeline'
import styles from './styles/GanttPane.module.scss'

interface TimeRulerProps {
  scale: TimelineScale
  totalDays: number
}

interface RulerTick {
  x: number
  label: string
  /** 月份锚点：字重 / 字色 / 分隔线都强一档，让「这是几月」一眼可读（§1.3 §4） */
  month: boolean
}

/**
 * 顶部时间刻度。刻度疏密随缩放档位变化 ——
 * 日视图逐日标注，周视图每 7 天，月视图每 30 天，
 * 避免缩小时生成上千个 DOM 节点。
 *
 * 层级（§1.3 §4）：原先每一格都是同字重同字色的灰字，没有月份锚点。
 * 现在**月份首格**用 `YYYY-MM` + 字重 600 + `--text-strong` + 强分隔线，
 * 其余格只出日号（`DD`）+ `--text-faint`。一天的宽度撑不下全日期，
 * 因此日视图用日号、月份锚点用 `YYYY-MM`，二者都符合 §1.3 的日期口径。
 */
export function TimeRuler({ scale, totalDays }: TimeRulerProps) {
  const step = scale.dayWidth >= 24 ? 1 : scale.dayWidth >= 10 ? 7 : 30
  const ticks: RulerTick[] = []
  let prevMonth = ''

  for (let day = 0; day < totalDays; day += step) {
    const date = addDays(scale.startDate, day)
    const month = date.slice(0, 7) // YYYY-MM
    const isMonthAnchor = month !== prevMonth
    prevMonth = month

    // 月视图的每一格本就是月首，用 YYYY-MM；周视图出 MM-DD；日视图出 DD
    const label = step === 30 ? month : step === 7 ? date.slice(5) : isMonthAnchor ? month : date.slice(8)

    ticks.push({ x: day * scale.dayWidth, label, month: isMonthAnchor })
  }

  return (
    <div style={{ position: 'relative', height: '100%' }} data-testid="gantt-ruler-ticks">
      {ticks.map((tick) => (
        <div
          key={tick.x}
          className={`${styles.rulerTick} ${tick.month ? styles.rulerTickMonth : ''}`}
          style={{ left: tick.x }}
        >
          {tick.label}
        </div>
      ))}
    </div>
  )
}

import { addDays } from '../../domain/calendar/workdays'
import type { TimelineScale } from './timeline'
import styles from '../styles/GanttPane.module.scss'

interface TimeRulerProps {
  scale: TimelineScale
  totalDays: number
}

/** 上行的一个月份带：横跨该月内落在时间轴范围里的全部列 */
interface MonthBand {
  left: number
  width: number
  label: string
}

/** 下行的一个日号刻度 */
interface DayTick {
  x: number
  label: string
}

/**
 * 月份带放不下月名时省略它的最小宽度（px）。
 *
 * `YYYY-MM` 在 `--fs-micro`（10px）+ 字距 0.06em 下约 44px，加左右内边距约 10px。
 * 放不下就**省略月名**（宁可空着）—— 绝不让月名溢出到相邻日列上去。
 */
const MIN_MONTH_LABEL_WIDTH = 56

/**
 * 顶部时间刻度。**两行**（OmniPlan / MS Project 的标准做法）：
 *
 * - 上行：月份带（`2026-09`、`2026-10`…），`--fs-micro` + 字距，`--bg-subtle` 底，
 *   **横跨该月的全部列**（高 14px）。
 * - 下行：日号（`14`、`15`…），`--fs-xs` + tabular-nums（高 18px）。
 *
 * 此前是**一行**：月份标签用不透明底板占掉约两格宽，把紧随其后的日号（14、15）
 * 盖掉了 —— 项目从 14 号开始，14/15 却消失。两行从结构上消除了这种遮盖：
 * 月份带只在上行、日号只在下行，二者不可能重叠。
 *
 * 日号的疏密随缩放档位变化（逐日 / 每周 / 每月），避免缩小时生成上千个 DOM 节点。
 */
export function TimeRuler({ scale, totalDays }: TimeRulerProps) {
  const step = scale.dayWidth >= 24 ? 1 : scale.dayWidth >= 10 ? 7 : 30

  // ── 上行：月份带 ──
  // 按「月」切片，每片宽度 = 该月在本时间轴范围内的自然日数 × dayWidth。
  // 相邻带左右相接、不重叠，因此不会盖住任何一列。
  const months: MonthBand[] = []
  /** 每个月的首日（含项目起始日）在时间轴上的偏移 —— 月视图的日号刻度就落在这里 */
  const monthStarts: number[] = []
  let segMonth = ''
  let segStart = 0
  for (let day = 0; day < totalDays; day += 1) {
    const month = addDays(scale.startDate, day).slice(0, 7) // YYYY-MM
    if (month !== segMonth) {
      if (segMonth) {
        months.push({
          left: segStart * scale.dayWidth,
          width: (day - segStart) * scale.dayWidth,
          label: segMonth,
        })
      }
      segMonth = month
      segStart = day
      monthStarts.push(day)
    }
  }
  if (segMonth) {
    months.push({
      left: segStart * scale.dayWidth,
      width: (totalDays - segStart) * scale.dayWidth,
      label: segMonth,
    })
  }

  // ── 下行：日号 ──
  // 月视图（step 30）若仍「每 30 天」出格，刻度会落在月中（09-14、10-14…），
  // 两个刻度都写「14」、且与上行的月分隔线错位 —— 没有参考价值。
  // 改为**落在每月首日**：刻度线与月份带的左右边界重合，日号读作「01」，与上行呼应。
  const ticks: DayTick[] =
    step === 30
      ? monthStarts.map((day) => ({
          x: day * scale.dayWidth,
          label: addDays(scale.startDate, day).slice(8),
        }))
      : Array.from({ length: Math.ceil(totalDays / step) }, (_, i) => {
          const day = i * step
          return { x: day * scale.dayWidth, label: addDays(scale.startDate, day).slice(8) }
        })

  return (
    <div className={styles.rulerInner} data-testid="gantt-ruler-ticks">
      <div className={styles.rulerMonths}>
        {months.map((band) => (
          <div
            key={band.left}
            className={styles.rulerMonthBand}
            style={{ left: band.left, width: band.width }}
            data-testid="ruler-month-band"
            data-month={band.label}
          >
            {/* 月名单独包一层，好让它能 sticky（钉在甘特区左缘）——
                直接 sticky 在带自身上做不到：带要按 left/width 绝对定位占位。
                放不下月名的窄月（< MIN_MONTH_LABEL_WIDTH）仍然留空，不钉。 */}
            {band.width >= MIN_MONTH_LABEL_WIDTH && (
              <span className={styles.rulerMonthLabel} data-testid="ruler-month-label">
                {band.label}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className={styles.rulerDays}>
        {ticks.map((tick) => (
          <div
            key={tick.x}
            className={styles.rulerDayTick}
            style={{ left: tick.x }}
            data-testid="ruler-day-tick"
          >
            {tick.label}
          </div>
        ))}
      </div>
    </div>
  )
}

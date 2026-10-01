import { addDays } from '../domain/calendar/workdays'
import type { TimelineScale } from './timeline'
import styles from './styles/GanttPane.module.scss'

interface TimeRulerProps {
  scale: TimelineScale
  totalDays: number
}

/**
 * 顶部时间刻度。刻度疏密随缩放档位变化 ——
 * 日视图逐日标注，周视图每 7 天，月视图每 30 天，
 * 避免缩小时生成上千个 DOM 节点。
 */
export function TimeRuler({ scale, totalDays }: TimeRulerProps) {
  const step = scale.dayWidth >= 24 ? 1 : scale.dayWidth >= 10 ? 7 : 30
  const ticks: { x: number; label: string }[] = []

  for (let day = 0; day < totalDays; day += step) {
    const date = addDays(scale.startDate, day)
    ticks.push({
      x: day * scale.dayWidth,
      label: step === 1 ? date.slice(5) : date,
    })
  }

  return (
    <div style={{ position: 'relative', height: '100%' }} data-testid="gantt-ruler-ticks">
      {ticks.map((tick) => (
        <div key={tick.x} className={styles.rulerTick} style={{ left: tick.x }}>
          {tick.label}
        </div>
      ))}
    </div>
  )
}

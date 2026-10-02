import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { Calendar } from '../../domain/model/types'
import { HOURS, WEEKDAY_KEYS, workBlockOfDay } from '../shared/normalHours'
import styles from '../styles/ProjectView.module.scss'

interface NormalHoursGridProps {
  calendar: Calendar
}

/**
 * 「正常时数」的**只读**可视化：星期几（横）× 小时（纵）网格，
 * 上班时段画成一块绿（`[START_HOUR, START_HOUR + hoursPerDay)`）。
 *
 * ## 为什么它一格都不可交互
 *
 * `Calendar` 模型**只有** `workingDays: boolean[7]` 与 `hoursPerDay: number`，
 * **没有「几点到几点」**。点一个格子表达「把上班时刻改到这一格」在本模型里
 * 没有落点 —— 点了没反应。ROADMAP 反复写的红线是「点了没反应比明确禁用更糟」
 * （「绝不假装能用」），故这里**刻意**：格子不可点、不可拖、无 hover 反馈，
 * 整块网格以 `role="img"` 暴露给辅助技术（读作「一张只读的图」，而不是 168 个格子）。
 *
 * 编辑入口仍是旁边的 7 个工作日复选框 + 每日工时输入（模型的数据源）—— 网格是
 * 它们的**投影**，不是另一份数据。
 *
 * ## 为什么纵轴铺满 24 小时（判断点 1）
 *
 * 裁到「有意义的范围」（如 06–20）会在 `hoursPerDay` 较大时**截断绿块** ——
 * 那是对数据说谎（§3.3「绝不假装能用」）。模型对工时上限无约束，故只有铺满
 * 00–23 才能在任何合法配置下如实呈现。行高取得紧凑（`--hour-row`），
 * 使 24 行整体仍在一屏可读的高度内。
 *
 * ## 与 ResourceTimeline 的网格
 *
 * **没有复用它的实现**，也不该复用：`ResourceTimeline` 是「一天一列、横轴 = 时间」
 * 的时间轴（`day-grid` 竖线 + `nonworkBands` 整列底纹，几何全在 x 上）；本网格是
 * **星期 × 小时矩阵**（横轴是星期、纵轴是小时），两者只是「都长得像网格」。
 * 硬把 `nonworkBands` / `day-grid` 套过来，只会得到一份按「天序号」算列宽的
 * 错位几何。真正承袭的是它的**做法**：只读、用 `--planit-*` 令牌、绿块挂在网格
 * 之上（它是绝对定位的条，这里是跨行的块），以及「同一概念只有一份实现」——
 * 这条推导因此收在 `shared/normalHours.ts` 一处。
 */
export function NormalHoursGrid({ calendar }: NormalHoursGridProps) {
  const { t } = useTranslation()

  return (
    <div
      className={styles.normalHoursGrid}
      data-testid="calendar-normal-hours-grid"
      // 整块读作一张图：`role="img"` 让屏幕阅读器只念 aria-label，
      // 不逐个念 168 个空格子，也不把格子误当成可聚焦的控件。
      role="img"
      aria-label={t('calendarView.normalHoursGridLabel')}
    >
      {/* 左上角空位（小时轴与星期轴交汇处） */}
      <div className={styles.normalHoursCorner} aria-hidden />

      {/* 横轴：星期几。顺序 = workingDays 的索引序（周一打头，判断点 2）。 */}
      {WEEKDAY_KEYS.map((key) => (
        <div key={key} className={styles.normalHoursDay}>
          {t(`calendar.weekdays.${key}`)}
        </div>
      ))}

      {/* 纵轴：00–23。等宽数字（§1.3），等宽是为了让「09」与「10」左右对齐。 */}
      <div className={styles.normalHoursHourAxis}>
        {HOURS.map((hour) => (
          <div key={hour} className={styles.normalHoursHour}>
            {String(hour).padStart(2, '0')}
          </div>
        ))}
      </div>

      {/* 七列，每列 24 格。绿块是列内的绝对定位覆盖层 —— 它跨行盖过格线，
          所以读起来是**一整块**（参照里那种实心绿），而不是 9 个小方块。 */}
      {WEEKDAY_KEYS.map((key, dayIndex) => {
        const block = workBlockOfDay(calendar, dayIndex)
        return (
          <div key={key} className={styles.normalHoursDayCol} data-day={dayIndex}>
            {HOURS.map((hour) => (
              <div
                key={hour}
                className={styles.normalHoursCell}
                data-testid={`calendar-normal-hours-cell-${dayIndex}-${hour}`}
              />
            ))}
            {block && (
              <div
                className={styles.normalHoursBlock}
                data-testid={`calendar-normal-hours-block-${dayIndex}`}
                data-from={block.from}
                data-to={block.to}
                // 只给两个**数**，像素几何由 SCSS 用 --hour-row 算 ——
                // 免得 JS 与 CSS 各持一份「一行多少 px」的真相。
                style={
                  {
                    '--from': String(block.from),
                    '--rows': String(block.to - block.from),
                  } as CSSProperties
                }
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

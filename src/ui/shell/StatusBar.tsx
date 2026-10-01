import { useTranslation } from 'react-i18next'

import { useProjectStore } from '../../store/projectStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { computeProjectSummary } from '../shared/projectSummary'
import { formatDate } from '../shared/format'
import styles from '../styles/Chrome.module.scss'

/**
 * 状态栏（§1.2 / §1.3 / §2.1）。
 *
 * 三层信息按 §1.2 拉开：
 *   · **信号**：关键任务数 —— 全栏唯一用色的一项（--critical）。
 *   · **元数据**：项目周期、工作日数、冲突数之外的其余项 —— 11px / --text-muted。
 * 旧版是一行等重的灰字，读不出「哪个数字才是我该关心的」。
 *
 * 数字与日期一律走 formatDate（§1.3：YYYY-MM-DD），容器带 tabular-nums
 * —— 计数变化时整栏不发生左右抖动。
 */
export function StatusBar() {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)
  const result = useScheduleStore((state) => state.result)

  if (!project) return null

  // 跨度 / 工作日换算走唯一的一份实现（projectSummary），与项目面板共用
  const summary = computeProjectSummary(project, result.schedules)

  if (!summary) {
    return (
      <div className={styles.statusbar} data-testid="status-bar">
        <span className={styles.meta}>{t('statusBar.empty')}</span>
      </div>
    )
  }

  // 关键任务数仍按叶子任务统计 —— 摘要任务的关键标记是从子任务继承来的，重复计数会翻倍
  const criticalCount = Object.values(project.tasks)
    .filter((task) => task.childIds.length === 0)
    .map((task) => result.schedules[task.id])
    .filter((schedule): schedule is NonNullable<typeof schedule> => Boolean(schedule))
    .filter((schedule) => schedule.isCritical).length

  const start = formatDate(summary.start) ?? '—'
  const finish = formatDate(summary.finish) ?? '—'

  return (
    <div className={styles.statusbar} data-testid="status-bar">
      <span className={styles.meta} data-testid="status-span">
        {t('statusBar.span', { start, finish })}
      </span>
      <span className={styles.dot} aria-hidden>
        ·
      </span>
      <span className={styles.meta} data-testid="status-workdays">
        {t('statusBar.totalWorkdays', { count: summary.totalWorkdays })}
      </span>
      <span className={styles.dot} aria-hidden>
        ·
      </span>
      {/* 信号：唯一用色项 */}
      <span className={styles.signal} data-testid="status-critical">
        {t('statusBar.criticalCount', { count: criticalCount })}
      </span>
      {result.conflicts.length > 0 && (
        <>
          <span className={styles.dot} aria-hidden>
            ·
          </span>
          <span className={styles.conflict} data-testid="status-conflicts">
            {t('statusBar.conflictCount', { count: result.conflicts.length })}
          </span>
        </>
      )}
    </div>
  )
}

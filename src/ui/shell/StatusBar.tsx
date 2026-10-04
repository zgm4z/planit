import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useProjectStore } from '../../store/projectStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { computeProjectSummary, countCriticalLeafTasks } from '../shared/projectSummary'
import { formatDate } from '../shared/format'
import styles from '../styles/Chrome.module.scss'

/**
 * 「计算中」指示器出现前的延迟（毫秒）。
 *
 * 求解已移到 worker（主线程不阻塞），但仍要**告诉用户「有活儿在跑」**。
 * 然而纯 CPM 只要 ~2ms —— 每个操作都闪一下提示是噪音。故延迟 300ms 才出现：
 * 快求解一闪而过（用户根本看不到），只有真正耗时的求解才显示。
 */
export const COMPUTING_INDICATOR_DELAY_MS = 300

/** 把布尔信号延迟一段时间再「上线」（下线立即）——用于「快就不要闪」。 */
function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!active) {
      setShown(false)
      return
    }
    const timer = setTimeout(() => setShown(true), delayMs)
    return () => clearTimeout(timer)
  }, [active, delayMs])

  return shown
}

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
 *
 * 「计算中」指示器（求解在 worker 里跑时出现）：**最弱的一层** —— 与元数据同色、
 * 靠右、`role="status"`（polite，不打断读屏）。它不遮不拦、不吃点击，且延迟出现
 * （见 COMPUTING_INDICATOR_DELAY_MS），所以快求解不会闪。
 *
 * ── 为什么是 memo 包一层 ──────────────────────────────────────────────────
 * 状态栏**不收任何 props**，数据全靠 zustand 订阅。而它恰好挂在 ProjectView 里，
 * 与虚拟化器同一个组件 —— 滚动时虚拟化器把可见区间存成内部 state，ProjectView
 * **每帧重渲染**，于是状态栏也跟着每帧重跑（连同上面那次全项目扫描）。
 * 它自己的订阅值在滚动中并不变，纯属被父组件带着走。
 *
 * `memo` 恰好解决这一点：无 props ⇒ 父组件重渲染时 props 恒等 ⇒ 整棵子树跳过；
 * 而它自身的 store 订阅（project / result / computing）一旦变化仍会照常重渲染 ——
 * 包括「计算中」指示器的延迟出现。所以这不是「牺牲实时性换性能」。
 */
function StatusBarComponent() {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)
  const result = useScheduleStore((state) => state.result)
  const computing = useScheduleStore((state) => state.computing)
  const showComputing = useDelayedFlag(computing, COMPUTING_INDICATOR_DELAY_MS)

  if (!project) return null

  // 跨度 / 工作日换算走唯一的一份实现（projectSummary），与项目面板共用。
  // 两次扫描都按 (project, schedules) 记忆化 —— 即便本组件因别的原因重跑，
  // 入参不变也不会重算（见 projectSummary 的注释）。
  const summary = computeProjectSummary(project, result.schedules)

  // 关键任务数按叶子统计（摘要任务的关键标记是从子任务继承来的，重复计数会翻倍）。
  // 与摘要同一处记忆化：两者都是全项目扫描、入参相同。
  const criticalCount = countCriticalLeafTasks(project, result.schedules)

  const start = formatDate(summary?.start) ?? '—'
  const finish = formatDate(summary?.finish) ?? '—'

  return (
    <div className={styles.statusbar} data-testid="status-bar">
      {summary ? (
        <>
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
        </>
      ) : (
        <span className={styles.meta}>{t('statusBar.empty')}</span>
      )}

      {/* 计算中：非阻塞、非模态，不吞点击。role=status 为 polite 播报 */}
      {showComputing && (
        <>
          {summary && (
            <span className={styles.dot} aria-hidden>
              ·
            </span>
          )}
          <span className={styles.computing} role="status" data-testid="status-computing">
            {t('statusBar.computing')}
          </span>
        </>
      )}
    </div>
  )
}

/**
 * memo 化的状态栏。**不要**把它换成直接渲染 StatusBarComponent ——
 * 那会重新引入「滚动时每帧重跑两次全项目扫描」的缺陷（见上）。
 * 组件名保留为 `StatusBar`，其余调用方 / 测试无需感知 memo。
 */
export const StatusBar = memo(StatusBarComponent)

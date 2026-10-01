import { useId } from 'react'
import { Accordion, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { findActiveBaseline } from '../../domain/model/baseline'
import type { SchedulingDirection } from '../../domain/model/types'
import { useProjectStore } from '../../store/projectStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { CalendarSettings } from './CalendarSettings'
import { DateField, FieldRow, GAP_BLOCK, GAP_INNER, StatList, StatRow } from './InspectorFields'
import { formatDate, formatDays } from '../shared/format'
import { computeProjectSummary } from '../shared/projectSummary'
import styles from '../styles/Inspector.module.scss'

/**
 * 项目面板（spec §4）的默认展开分组（§3.5）：**主分组**（时间线 / 摘要）默认展开，
 * **次要分组**（格式 / 工作日历）默认收起 —— 收起态仍显示分组名与 ▼，用户知道那里
 * 有东西，只是先不占屏。
 */
const PROJECT_OPEN_GROUPS = ['timeline', 'summary']

/**
 * 项目面板（spec §4）。宽度由 ProjectView 的右侧栏容器统一持有，这里只填满它。
 *
 * 方向语义（偏差 4）：
 *   forward  —— startDate 是正推起点（可编辑）；endDate 是可选期限（也可编辑）
 *   backward —— endDate 是逆推终点（可编辑）；startDate 是引擎推导值 → 只读
 *
 * 信息架构（对齐 OmniPlan 的「项目」检查器）：
 *   名称（不分组，置顶）—— 它是「这份排期叫什么」，属于面板身份而非某个分组
 *   ▼ 时间线   排期方向 · 开始日期 · 结束日期 · 基准日
 *   ▼ 摘要     项目跨度 · 总工作日 · 任务数
 *   ▼ 格式     货币 · 投入单位转换
 *   ▼ 工作日历 工作日 · 例外日期
 *
 * 排版（§3.4）：字段一律走 FieldRow —— 标签固定在左列、值填满右列，只读事实右对齐。
 * 分组用 Accordion（与任务面板同构，§3.5），组内 6px、组间 24px。
 *
 * 工作日历（CalendarSettings）是**项目级配置**，与排期方向 / 基准日同类，
 * 因此归「工作日历」分组 —— 它不再常驻右栏底部（见 CalendarSettings 的 IA 注释）。
 */
export function ProjectInspector() {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)!
  const dispatch = useProjectStore((state) => state.dispatch)
  const breakCoalescing = useProjectStore((state) => state.breakCoalescing)
  const result = useScheduleStore((state) => state.result)

  // 属性行要把 <label> 关联到控件 —— id 在这里生成，同时交给 FieldRow 与控件。
  const nameId = useId()
  const directionId = useId()
  const hoursId = useId()

  const backward = project.schedulingDirection === 'backward'
  const calendar = project.calendars[project.calendarId]
  const summary = computeProjectSummary(project, result.schedules)

  // backward 下开始日期是派生值：所有叶子 scheduledStart 的最小值
  const derivedStart = summary?.start ?? project.startDate

  // ── 基线事实（项目级）─────────────────────────────────────────────────
  // 菜单「项目 > 保存基线 / 删除当前基线」的**落点**：打开项目默认不选中任务、
  // 右栏停在本 Tab，而基线的操作界面只在「任务」Tab —— 这里若无这一行，用户点完
  // 菜单界面纹丝不动，正是「点了没反应比明确禁用更糟」。
  //
  // 数据源与菜单的两条命令**同源**：都走 findActiveBaseline（唯一的活动基线判定），
  // 条数直接取 project.baselines —— 绝不在这里另写一份「有没有基线」的规则。
  const baselines = project.baselines
  const activeBaseline = findActiveBaseline(project)

  // 三种事实（§3.3）：
  //   没有基线            → null → 由 StatRow 的 unset 渲染说明性文字「未设置基线」
  //                        （能说出原因就给原因，比一个 `—` 有用）
  //   有基线且有活动基线   → 活动基线名；多条时附条数 —— 一眼看出「有几条、哪条在用」
  //   有基线但选了「不对比」→ 说明「共 N 条、未选对比」，同样不能空着
  const baselineValue =
    baselines.length === 0
      ? null
      : activeBaseline
        ? baselines.length > 1
          ? t('inspector.project.baselineCount', {
              name: activeBaseline.name,
              count: baselines.length,
            })
          : activeBaseline.name
        : t('inspector.project.baselineNoneActive', { count: baselines.length })

  // 放在变量里是因为摘要为空 / 非空两个分支都要用它（空态也得看得见基线事实）。
  const baselineRow = (
    <StatRow
      label={t('inspector.project.baselineLabel')}
      value={baselineValue}
      unset={t('inspector.baseline.noBaseline')}
      testId="project-baseline"
    />
  )

  return (
    <Stack gap={GAP_BLOCK}>
      {/* 名称：不分组、置顶。它标识「这是哪个项目」，不属于时间线 / 摘要任何一组。 */}
      <FieldRow label={t('inspector.project.name')} controlId={nameId}>
        <TextInput
          id={nameId}
          value={project.name}
          onBlur={breakCoalescing}
          onChange={(event) =>
            dispatch({
              type: 'project.rename',
              label: 'commands.project.rename',
              payload: { name: event.target.value },
              coalesceKey: 'project.rename',
            })
          }
        />
      </FieldRow>

      <Accordion
        multiple
        variant="default"
        defaultValue={PROJECT_OPEN_GROUPS}
        className={styles.accordion}
        classNames={{
          item: styles.accItem,
          control: styles.accControl,
          label: styles.accLabel,
          panel: styles.accPanel,
        }}
      >
        <Accordion.Item value="timeline">
          <Accordion.Control>{t('inspector.project.groupTimeline')}</Accordion.Control>
          <Accordion.Panel>
            <Stack gap={GAP_INNER}>
              <FieldRow label={t('inspector.project.direction')} controlId={directionId}>
                <Select
                  id={directionId}
                  value={project.schedulingDirection}
                  data={[
                    { value: 'forward', label: t('inspector.project.directionForward') },
                    { value: 'backward', label: t('inspector.project.directionBackward') },
                  ]}
                  onChange={(value) =>
                    value &&
                    dispatch({
                      type: 'project.setDirection',
                      label: 'commands.project.setDirection',
                      payload: { direction: value as SchedulingDirection },
                    })
                  }
                />
              </FieldRow>

              <DateField
                label={t('inspector.project.startDate')}
                value={backward ? derivedStart : project.startDate}
                disabled={backward}
                onBlur={breakCoalescing}
                onChange={(next) =>
                  dispatch({
                    type: 'project.setStartDate',
                    label: 'commands.project.setStartDate',
                    payload: { startDate: next },
                    coalesceKey: 'project.setStartDate',
                  })
                }
              />
              {backward && (
                <Text fz="xs" c="dimmed">
                  {t('inspector.project.startDerivedHint')}
                </Text>
              )}

              <DateField
                label={t('inspector.project.endDate')}
                value={project.endDate ?? ''}
                clearable
                onBlur={breakCoalescing}
                onChange={(next) =>
                  dispatch({
                    type: 'project.setEndDate',
                    label: 'commands.project.setEndDate',
                    // 清空 = 无期限（forward）/ 退回正推完成日（backward）
                    payload: { endDate: next || undefined },
                    coalesceKey: 'project.setEndDate',
                  })
                }
              />

              {/* 基准日（挣值的「到某日为止」）：项目级设置。输入框驱动 → 合并键
                  `project.setStatusDate` + onBlur 打断合并。说明紧随其后（组内 6px）。 */}
              <DateField
                label={t('inspector.project.statusDate')}
                testId="project-status-date"
                value={project.statusDate ?? ''}
                clearable
                onBlur={breakCoalescing}
                onChange={(next) =>
                  dispatch({
                    type: 'project.setStatusDate',
                    label: 'commands.project.setStatusDate',
                    // 清空 = 未设基准日（PV / SV 不可算）—— 必须给 undefined，不能留空串
                    payload: { statusDate: next || undefined },
                    coalesceKey: 'project.setStatusDate',
                  })
                }
              />
              <Text fz="xs" c="dimmed">
                {t('inspector.project.statusDateHint')}
              </Text>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* 摘要：**只读事实块**。日期一律 formatDate（YYYY-MM-DD），数字一律
            formatDays —— 组件里不再出现第二份四舍五入。每行是 FieldRow（值右对齐）。 */}
        <Accordion.Item value="summary">
          <Accordion.Control>{t('inspector.project.summary')}</Accordion.Control>
          <Accordion.Panel>
            {summary ? (
              <StatList>
                <StatRow
                  label={t('inspector.project.spanLabel')}
                  value={t('inspector.project.spanValue', {
                    start: formatDate(summary.start) ?? '—',
                    finish: formatDate(summary.finish) ?? '—',
                  })}
                  testId="project-summary-span"
                />
                <StatRow
                  label={t('inspector.project.workdaysLabel')}
                  value={t('outline.cell.days', { count: formatDays(summary.totalWorkdays) ?? '—' })}
                  testId="project-summary-workdays"
                />
                <StatRow
                  label={t('inspector.project.taskCountLabel')}
                  value={formatDays(summary.taskCount) ?? '—'}
                  testId="project-summary-tasks"
                />
                {/* 基线事实：与上三行同栅格。它是**项目级**的，不随摘要算不算得出来
                    而消失 —— 所以两个分支都渲染（空项目也能保存基线，得看得到反应）。 */}
                {baselineRow}
              </StatList>
            ) : (
              <StatList>
                {/* 算不出来（§3.3）：一个可排的任务都没有 → 弱化 — */}
                <Text
                  fz="sm"
                  data-testid="project-summary-empty"
                  style={{ color: 'var(--planit-text-faint)' }}
                >
                  —
                </Text>
                {baselineRow}
              </StatList>
            )}
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="format">
          <Accordion.Control>{t('inspector.project.format')}</Accordion.Control>
          <Accordion.Panel>
            <Stack gap={GAP_INNER}>
              {/* §3.3：货币是一个**未配置**的值 —— 用说明性文字（「未指定」）而不是 `—`，
                  它告诉用户这里为什么空。版本注记由下方 hint 承担（分批原则：渲染出来
                  并注明「尚未排期」，而不是删掉）。 */}
              <StatRow
                label={t('inspector.project.currency')}
                value={null}
                unset={t('inspector.project.currencyUnset')}
                testId="project-currency"
              />
              <Text fz="xs" c="dimmed">
                {t('inspector.project.currencyHint')}
              </Text>

              <FieldRow label={t('inspector.project.unitConversion')} controlId={hoursId}>
                <NumberInput
                  id={hoursId}
                  min={1}
                  value={calendar.hoursPerDay}
                  onBlur={breakCoalescing}
                  onChange={(value) =>
                    dispatch({
                      type: 'calendar.setHoursPerDay',
                      label: 'commands.calendar.setHoursPerDay',
                      payload: { hoursPerDay: Number(value) || 1 },
                      coalesceKey: 'calendar.setHoursPerDay',
                    })
                  }
                />
              </FieldRow>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* 工作日历：**项目配置**（工作日 / 例外日期）。归「项目」Tab 的最后一个分组，
            详见 CalendarSettings 顶部的归属说明。 */}
        <Accordion.Item value="calendar">
          <Accordion.Control data-testid="project-group-calendar">
            {t('inspector.project.groupCalendar')}
          </Accordion.Control>
          <Accordion.Panel>
            <CalendarSettings />
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  )
}

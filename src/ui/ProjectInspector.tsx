import { NumberInput, Select, Stack, Text, TextInput } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import type { SchedulingDirection } from '../domain/model/types'
import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'
import { CalendarSettings } from './CalendarSettings'
import { DateField, GAP_BLOCK, GAP_FIELD, Section, StatList, StatRow } from './InspectorFields'
import { formatDate, formatDays } from './format'
import { computeProjectSummary } from './projectSummary'

/**
 * 项目面板（spec §4）。宽度由 ProjectView 的右侧栏容器统一持有，这里只填满它。
 *
 * 方向语义（偏差 4）：
 *   forward  —— startDate 是正推起点（可编辑）；endDate 是可选期限（也可编辑）
 *   backward —— endDate 是逆推终点（可编辑）；startDate 是引擎推导值 → 只读
 *
 * 排版（§2.1）：可编辑字段按「区块」分组，块内 16px、块间 24px；摘要是一个
 * **只读事实块**（平排的规格表），与上方带边框的控件形成对照 —— 方块 = 可改，平排 = 事实。
 *
 * 本面板末尾挂入 **CalendarSettings**（工作日 / 例外日期）：工作日历是**项目级配置**，
 * 与排期方向、基准日同类，因此与它们并列在「项目」Tab —— 不再常驻右栏底部。
 */
export function ProjectInspector() {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)!
  const dispatch = useProjectStore((state) => state.dispatch)
  const breakCoalescing = useProjectStore((state) => state.breakCoalescing)
  const result = useScheduleStore((state) => state.result)

  const backward = project.schedulingDirection === 'backward'
  const calendar = project.calendars[project.calendarId]
  const summary = computeProjectSummary(project, result.schedules)

  // backward 下开始日期是派生值：所有叶子 scheduledStart 的最小值
  const derivedStart = summary?.start ?? project.startDate

  return (
    <Stack gap={GAP_BLOCK}>
      <Stack gap={GAP_FIELD}>
        <TextInput
          label={t('inspector.project.name')}
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

        <Select
          label={t('inspector.project.direction')}
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
      </Stack>

      <Stack gap={GAP_FIELD}>
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
      </Stack>

      {/* 摘要：**只读事实块**。日期一律 formatDate（YYYY-MM-DD），
          数字一律 formatDays / formatPlain —— 组件里不再出现第二份四舍五入。
          标题体例：与「工作日 / 例外日期」（CalendarSettings）及任务面板 Accordion 头
          共用同一角色（§1.2「区块标题」：lg / 600 + 下沿），因此直接用共用的 <Section>
          （产出 <h3>，不是 <p>）。它此前是 micro / 大写 / 弱化的**列头**档，与同面板的
          「工作日」撞出两套层级 —— 一个面板只应有一套区块标题。 */}
      <Section title={t('inspector.project.summary')}>
        {summary ? (
          <StatList>
            {/* 一律拼成「标签：值」的单行事实 —— 数字过 formatDate / formatDays
                （日期保持 YYYY-MM-DD，数值不再各自 Math.round） */}
            <Text fz="sm" c="dimmed" data-testid="project-summary-span">
              {t('inspector.project.span', {
                start: formatDate(summary.start) ?? '—',
                finish: formatDate(summary.finish) ?? '—',
              })}
            </Text>
            <Text fz="sm" c="dimmed" data-testid="project-summary-workdays">
              {t('inspector.project.totalWorkdays', {
                count: formatDays(summary.totalWorkdays) ?? '—',
              })}
            </Text>
            <Text fz="sm" c="dimmed" data-testid="project-summary-tasks">
              {t('inspector.project.taskCount', { count: formatDays(summary.taskCount) ?? '—' })}
            </Text>
          </StatList>
        ) : (
          // 算不出来（§3.3）：一个可排的任务都没有 → 弱化 —
          <Text fz="sm" data-testid="project-summary-empty" style={{ color: 'var(--planit-text-faint)' }}>
            —
          </Text>
        )}
      </Section>

      {/* 基准日（挣值的「到某日为止」）：项目级设置，落在项目面板（偏差 3 / 偏差 7）。
          输入框驱动 → 合并键 `project.setStatusDate` + onBlur 打断合并。 */}
      <Stack gap={GAP_FIELD}>
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

      <Section title={t('inspector.project.format')}>
        {/* §3.3：货币曾是一个**禁用的空 Select** —— 典型的「用控件表达数据」。
            改为只读事实块的一行（标签 + 弱化的 `—`），版本注记仍由下方 hint 承担
            （分批原则：渲染出来并注明「尚未排期」，而不是删掉）。 */}
        <Stack gap={GAP_FIELD}>
          <Stack gap={GAP_FIELD}>
            <StatList>
              <StatRow
                label={t('inspector.project.currency')}
                value={null}
                testId="project-currency"
              />
            </StatList>
            <Text fz="xs" c="dimmed">
              {t('inspector.project.currencyHint')}
            </Text>
          </Stack>

          <NumberInput
            label={t('inspector.project.unitConversion')}
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
        </Stack>
      </Section>

      {/* 工作日历：**项目配置**，与上面的 名称 / 排期方向 / 基准日 / 格式 并列。
          IA 修正 —— 它此前被钉在右栏底部（所有 Tab 之下的公共位置），切到「资源」
          Tab 时底下仍挂着项目日历设置，属信息架构错位。现在它归「项目」Tab。
          详见 CalendarSettings 顶部的归属说明（含对「全局设置应常驻」那条论证的回应）。 */}
      <CalendarSettings />
    </Stack>
  )
}

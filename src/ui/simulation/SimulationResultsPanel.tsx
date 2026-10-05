import { Stack, Title, Text, Group, Badge, Paper, Grid } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import type { SimulationResult } from '../../domain/simulation/simulationTypes'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from 'recharts'

interface SimulationResultsPanelProps {
  result: SimulationResult
}

/**
 * 蒙特卡洛模拟结果可视化面板
 */
export function SimulationResultsPanel({ result }: SimulationResultsPanelProps) {
  const { t } = useTranslation()

  const { projectStats, histogram, iterations } = result

  // 准备直方图数据
  const histogramData = histogram.frequencies.map((count, i) => {
    const binStart = histogram.bins[i]
    const binEnd = histogram.bins[i + 1]
    return {
      range: `${binStart.toFixed(1)}-${binEnd.toFixed(1)}`,
      binStart,
      binEnd,
      count,
      percentage: ((count / iterations) * 100).toFixed(1),
    }
  })

  // 准备百分位数据（用于参考线）
  const percentiles = [
    { value: projectStats.p10, label: 'P10', color: '#38BDF8' },
    { value: projectStats.p50, label: 'P50 (中位数)', color: '#6EE7B7' },
    { value: projectStats.p90, label: 'P90', color: '#F97316' },
  ]

  return (
    <Stack gap="xl">
      {/* 标题 */}
      <Group justify="space-between">
        <Title order={3}>{t('simulation.resultsTitle', '模拟结果')}</Title>
        <Badge size="lg" variant="light">
          {iterations.toLocaleString()} {t('simulation.iterations', '次迭代')}
        </Badge>
      </Group>

      {/* 关键指标卡片 */}
      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
          <Paper p="md" withBorder>
            <Text size="sm" c="dimmed" mb="xs">
              {t('simulation.meanDuration', '平均工期')}
            </Text>
            <Title order={2}>{projectStats.mean.toFixed(1)}</Title>
            <Text size="xs" c="dimmed">
              {t('simulation.days', '天')}
            </Text>
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
          <Paper p="md" withBorder>
            <Text size="sm" c="dimmed" mb="xs">
              {t('simulation.medianDuration', '中位数工期')}
            </Text>
            <Title order={2}>{projectStats.median.toFixed(1)}</Title>
            <Text size="xs" c="dimmed">
              {t('simulation.days', '天')}
            </Text>
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
          <Paper p="md" withBorder>
            <Text size="sm" c="dimmed" mb="xs">
              {t('simulation.stdDev', '标准差')}
            </Text>
            <Title order={2}>{projectStats.std.toFixed(1)}</Title>
            <Text size="xs" c="dimmed">
              {t('simulation.days', '天')}
            </Text>
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
          <Paper p="md" withBorder>
            <Text size="sm" c="dimmed" mb="xs">
              {t('simulation.p10', 'P10 (乐观)')}
            </Text>
            <Title order={2} c="blue.5">
              {projectStats.p10.toFixed(1)}
            </Title>
            <Text size="xs" c="dimmed">
              10% {t('simulation.chanceEarlier', '概率更早完成')}
            </Text>
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
          <Paper p="md" withBorder>
            <Text size="sm" c="dimmed" mb="xs">
              {t('simulation.p50', 'P50 (中位数)')}
            </Text>
            <Title order={2} c="teal.5">
              {projectStats.p50.toFixed(1)}
            </Title>
            <Text size="xs" c="dimmed">
              50% {t('simulation.chanceEarlier', '概率更早完成')}
            </Text>
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
          <Paper p="md" withBorder>
            <Text size="sm" c="dimmed" mb="xs">
              {t('simulation.p90', 'P90 (保守)')}
            </Text>
            <Title order={2} c="orange.5">
              {projectStats.p90.toFixed(1)}
            </Title>
            <Text size="xs" c="dimmed">
              90% {t('simulation.chanceEarlier', '概率更早完成')}
            </Text>
          </Paper>
        </Grid.Col>
      </Grid>

      {/* 工期分布直方图 */}
      <Paper p="md" withBorder>
        <Title order={4} mb="md">
          {t('simulation.distributionChart', '工期分布直方图')}
        </Title>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={histogramData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis
              dataKey="range"
              label={{
                value: t('simulation.durationDays', '工期（天）'),
                position: 'insideBottom',
                offset: -5,
              }}
            />
            <YAxis
              label={{
                value: t('simulation.frequency', '频次'),
                angle: -90,
                position: 'insideLeft',
              }}
            />
            <Tooltip
              content={({ payload }) => {
                if (!payload || payload.length === 0) return null
                const data = payload[0].payload
                return (
                  <Paper p="xs" withBorder shadow="md">
                    <Text size="sm" fw={600}>
                      {data.range} {t('simulation.days', '天')}
                    </Text>
                    <Text size="sm">
                      {t('simulation.frequency', '频次')}: {data.count}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {data.percentage}%
                    </Text>
                  </Paper>
                )
              }}
            />
            <Legend />
            <Bar
              dataKey="count"
              fill="#3B82F6"
              name={t('simulation.frequency', '频次')}
              radius={[4, 4, 0, 0]}
            />

            {/* 百分位参考线 */}
            {percentiles.map((p) => (
              <ReferenceLine
                key={p.label}
                x={histogramData.find(
                  (d) => p.value >= d.binStart && p.value < d.binEnd
                )?.range}
                stroke={p.color}
                strokeWidth={2}
                strokeDasharray="3 3"
                label={{
                  value: p.label,
                  position: 'top',
                  fill: p.color,
                  fontSize: 12,
                }}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>

        {/* 图例说明 */}
        <Group mt="md" gap="xl" justify="center">
          {percentiles.map((p) => (
            <Group key={p.label} gap="xs">
              <div
                style={{
                  width: 16,
                  height: 3,
                  backgroundColor: p.color,
                  borderRadius: 2,
                }}
              />
              <Text size="sm" c="dimmed">
                {p.label}: {p.value.toFixed(1)} {t('simulation.days', '天')}
              </Text>
            </Group>
          ))}
        </Group>
      </Paper>

      {/* 范围说明 */}
      <Paper p="md" withBorder>
        <Title order={4} mb="sm">
          {t('simulation.rangeExplanation', '工期范围说明')}
        </Title>
        <Stack gap="xs">
          <Group>
            <Badge color="blue" variant="light">
              {t('simulation.minMax', '最小-最大')}
            </Badge>
            <Text size="sm">
              {projectStats.min.toFixed(1)} - {projectStats.max.toFixed(1)}{' '}
              {t('simulation.days', '天')}
            </Text>
          </Group>
          <Text size="sm" c="dimmed" pl="md">
            {t(
              'simulation.minMaxDesc',
              '所有模拟迭代中的最短和最长工期'
            )}
          </Text>

          <Group mt="xs">
            <Badge color="teal" variant="light">
              P10 - P90
            </Badge>
            <Text size="sm">
              {projectStats.p10.toFixed(1)} - {projectStats.p90.toFixed(1)}{' '}
              {t('simulation.days', '天')}
            </Text>
          </Group>
          <Text size="sm" c="dimmed" pl="md">
            {t(
              'simulation.p1090Desc',
              '80% 的情况下，项目工期会落在这个范围内'
            )}
          </Text>
        </Stack>
      </Paper>
    </Stack>
  )
}

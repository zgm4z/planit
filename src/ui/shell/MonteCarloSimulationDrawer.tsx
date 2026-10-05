import { useState, useEffect } from 'react'
import { Button, Drawer, NumberInput, Stack, Text, Title, Paper, Progress } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import type { SimulationConfig, SimulationResult } from '../../domain/simulation/simulationTypes'
import { useSimulationWorker } from '../../domain/simulation/useSimulationWorker'
import { useProjectStore } from '../../store/projectStore'
import { SimulationResultsPanel } from '../simulation/SimulationResultsPanel'

interface MonteCarloSimulationDrawerProps {
  opened: boolean
  onClose: () => void
}

export function MonteCarloSimulationDrawer({ opened, onClose }: MonteCarloSimulationDrawerProps) {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)
  const { runSimulation: runWorkerSimulation, cancel } = useSimulationWorker()

  const [config, setConfig] = useState<SimulationConfig>({
    iterations: 1000,
    confidenceLevel: 0.95,
  })

  const [result, setResult] = useState<SimulationResult | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // 清理：关闭时取消正在运行的模拟
  useEffect(() => {
    if (!opened) {
      cancel()
      setRunning(false)
      setProgress(0)
      setError(null)
    }
  }, [opened, cancel])

  const handleRun = () => {
    if (!project) return

    setRunning(true)
    setProgress(0)
    setError(null)
    setResult(null)

    // 从项目任务生成不确定性参数
    // 使用 PERT 公式：optimistic = duration * 0.7, pessimistic = duration * 1.5
    const uncertainties = Object.entries(project.tasks).map(([taskId, task]) => ({
      taskId,
      optimistic: task.duration * 0.7,
      mostLikely: task.duration,
      pessimistic: task.duration * 1.5,
    }))

    runWorkerSimulation(project, uncertainties, config, {
      onProgress: (p) => {
        setProgress(p)
      },
      onResult: (simulationResult) => {
        setResult(simulationResult)
        setRunning(false)
        setProgress(100)
      },
      onError: (err) => {
        setError(err)
        setRunning(false)
        setProgress(0)
      },
    })
  }

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={t('simulation.title')}
      position="right"
      size="xl"
    >
      <Stack gap="lg">
        {/* 配置区 */}
        <Paper p="md" withBorder>
          <Stack gap="md">
            <Title order={4}>{t('simulation.config.title')}</Title>

            <NumberInput
              label={t('simulation.config.iterations')}
              description={t('simulation.config.iterationsHelp')}
              value={config.iterations}
              onChange={(value) => setConfig({ ...config, iterations: Number(value) || 1000 })}
              min={100}
              max={10000}
              step={100}
            />

            <NumberInput
              label={t('simulation.config.confidenceLevel')}
              description={t('simulation.config.confidenceLevelHelp')}
              value={(config.confidenceLevel ?? 0.95) * 100}
              onChange={(value) => setConfig({ ...config, confidenceLevel: (Number(value) || 95) / 100 })}
              min={50}
              max={99}
              step={1}
              suffix="%"
            />

            <Button
              onClick={handleRun}
              loading={running}
              fullWidth
            >
              {running ? t('simulation.actions.running') : t('simulation.actions.run')}
            </Button>

            {running && (
              <Progress value={progress} size="sm" animated />
            )}

            {error && (
              <Text c="red" size="sm">{error}</Text>
            )}
          </Stack>
        </Paper>

        {/* 结果可视化看板 */}
        {result && <SimulationResultsPanel result={result} />}

        {!result && !running && (
          <Paper p="md" withBorder>
            <Text c="dimmed" ta="center">{t('simulation.results.noResults')}</Text>
          </Paper>
        )}
      </Stack>
    </Drawer>
  )
}

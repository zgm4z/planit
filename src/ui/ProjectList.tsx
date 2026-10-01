import { useEffect, useState } from 'react'
import { Alert, Button, Card, Center, Stack, Text, UnstyledButton, Group } from '@mantine/core'
import { IconPlus, IconAlertCircle } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { createProject, seedIdCounterFromIds } from '../domain/model/factories'
import { listProjects, loadProject, saveProject, type ProjectSummary } from '../persist/indexeddb'
import { useProjectStore } from '../store/projectStore'
import { LanguageSwitcher } from './LanguageSwitcher'

export function ProjectList() {
  const { t, i18n } = useTranslation()
  const [summaries, setSummaries] = useState<ProjectSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const loadIntoStore = useProjectStore((state) => state.loadProject)

  useEffect(() => {
    listProjects()
      .then(setSummaries)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  async function handleCreate(): Promise<void> {
    // 页面刷新后 id 计数器已归零。先播种已有项目的 id，
    // 否则新项目会拿到与既有项目相同的 id，并在 IndexedDB 里静默覆盖它
    try {
      const existing = await listProjects()
      seedIdCounterFromIds(existing.map((summary) => summary.id))
    } catch {
      // 读不到列表时不阻塞新建 —— 最坏是 id 冲突，但不该因此让用户建不了项目
    }

    // 项目名走 i18n —— 用户看到什么语言，新建的计划就叫什么
    const project = createProject(t('projectList.untitled'))
    try {
      await saveProject(project)
    } catch {
      // 存盘失败不阻塞进入编辑器。内存中照样可用，
      // 顶部的警告条由 App 里 startAutoSave 的 onError 负责提示
    }
    loadIntoStore(project)
  }

  async function handleOpen(id: string): Promise<void> {
    try {
      const project = await loadProject(id)
      if (!project) {
        setError(t('projectList.notFound'))
        return
      }
      loadIntoStore(project)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Center mih="100vh" bg="var(--planit-bg-app)">
      <Card w={560} padding="xl" radius="lg" withBorder shadow="md">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <div style={{ minWidth: 0 }}>
            <Text fw={650} fz={20}>
              {t('app.name')}
            </Text>
            <Text c="dimmed" fz="sm">
              {t('app.tagline')}
            </Text>
          </div>
          {/* 语言切换在列表页也必须可达 —— Task 15 起 Toolbar 里会再有一处 */}
          <LanguageSwitcher />
        </Group>

        <Button
          fullWidth
          mt="lg"
          onClick={() => void handleCreate()}
          leftSection={<IconPlus size={16} />}
        >
          {t('projectList.new')}
        </Button>

        {error && (
          <Alert mt="md" color="red" icon={<IconAlertCircle size={16} />}>
            {error}
          </Alert>
        )}

        {summaries.length === 0 ? (
          <Text c="dimmed" fz="sm" ta="center" mt="lg">
            {t('projectList.empty')}
          </Text>
        ) : (
          <Stack gap={4} mt="lg">
            {summaries.map((summary) => (
              <UnstyledButton
                key={summary.id}
                onClick={() => void handleOpen(summary.id)}
                p="sm"
                style={{ borderRadius: 'var(--mantine-radius-md)' }}
                className="planit-project-item"
              >
                <Group justify="space-between" wrap="nowrap">
                  <div style={{ minWidth: 0 }}>
                    <Text fw={550} truncate>
                      {summary.name}
                    </Text>
                    <Text c="dimmed" fz={11}>
                      {t('projectList.updatedAt', {
                        time: new Date(summary.updatedAt).toLocaleString(i18n.resolvedLanguage),
                      })}
                    </Text>
                  </div>
                </Group>
              </UnstyledButton>
            ))}
          </Stack>
        )}
      </Card>
    </Center>
  )
}

import { useEffect } from 'react'
import { Group, MantineProvider, Paper, Stack, Text, Title } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { useTranslation } from 'react-i18next'

import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'

import { theme } from './theme'
import { LanguageSwitcher } from './LanguageSwitcher'
import { useProjectStore } from '../store/projectStore'
import styles from './styles/App.module.scss'

export default function App() {
  const { t, i18n } = useTranslation()
  const project = useProjectStore((state) => state.project)

  // 让 <html lang> 跟随当前语言 —— 否则屏幕阅读器会用错误的语音朗读，
  // 搜索引擎也会误判页面语言
  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? 'zh-CN'
  }, [i18n.resolvedLanguage])

  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="top-right" />
      <div className={styles.shell} data-testid="app-shell">
        <Paper p="md" radius="md" withBorder>
          <Stack gap="xs">
            <Group justify="space-between" wrap="nowrap">
              <Title order={3}>{t('app.name')}</Title>
              <LanguageSwitcher />
            </Group>
            <Text c="dimmed" data-testid="app-tagline">
              {t('app.tagline')}
            </Text>
            <Text data-testid="current-project">
              {project?.name ?? t('projectList.untitled')}
            </Text>
          </Stack>
        </Paper>
      </div>
    </MantineProvider>
  )
}

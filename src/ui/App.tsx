import { useEffect, useState } from 'react'
import { Alert, MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'

import { theme } from './theme'
import { ProjectList } from './ProjectList'
import { ProjectView } from './ProjectView'
import { initCommands } from '../commands/registry'
import { startAutoSave } from '../persist/autoSave'
import { useProjectStore } from '../store/projectStore'
import { initializeSchedules } from '../store/scheduleStore'
import { useTranslation } from 'react-i18next'

// 模块加载时注册一次命令。放在组件外，避免 StrictMode 下重复注册
initCommands()

export default function App() {
  const { t, i18n } = useTranslation()
  const project = useProjectStore((state) => state.project)
  const lastError = useProjectStore((state) => state.lastError)
  const clearError = useProjectStore((state) => state.clearError)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)

  // 让 <html lang> 跟随当前语言 —— 否则屏幕阅读器会用错误的语音朗读，
  // 搜索引擎也会误判页面语言
  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? 'zh-CN'
  }, [i18n.resolvedLanguage])

  // project 变化后重算排期（undo/redo 也会走到这里）
  useEffect(() => {
    initializeSchedules()
  }, [project])

  // 启动自动存盘。返回的清理函数会在卸载时把挂起的快照冲掉
  useEffect(() => startAutoSave((message) => setStorageWarning(message)), [])

  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="top-right" />

      {storageWarning && (
        <Alert color="red" radius={0}>
          {t('errors.storageUnavailable', { message: storageWarning })}
        </Alert>
      )}
      {lastError && (
        <Alert color="red" radius={0} withCloseButton onClose={clearError}>
          {lastError}
        </Alert>
      )}

      {project ? <ProjectView /> : <ProjectList />}
    </MantineProvider>
  )
}

import { useEffect, useState } from 'react'
import { Alert, MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { DatesProvider } from '@mantine/dates'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import '@mantine/dates/styles.css'
import dayjs from 'dayjs'
// dayjs 的 locale 必须**显式注册**才可用（en 是内建，无需 import）。
// 注册是副作用 import，放在 App 入口 —— 与 DatesProvider 同处，改语言不会漏装。
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/ja'

import { theme } from './shared/theme'
import { toDayjsLocale } from './shared/datesLocale'
import { ProjectList } from './views/ProjectList'
import { ProjectView } from './views/ProjectView'
import { initCommands } from '../commands/registry'
import { startAutoSave } from '../persist/autoSave'
import { useProjectStore } from '../store/projectStore'
import { useTranslation } from 'react-i18next'

// 模块加载时注册一次命令。放在组件外，避免 StrictMode 下重复注册
initCommands()

export default function App() {
  const { t, i18n } = useTranslation()
  // i18next 的语言码 → dayjs 的 locale 串（两套 locale 的桥，见 shared/datesLocale.ts）。
  // App 已在追踪 resolvedLanguage，故它变化时本组件重渲染 → DatesProvider 跟着换语言。
  const datesLocale = toDayjsLocale(i18n.resolvedLanguage ?? undefined)
  // dayjs 的**全局** locale 也要跟着切：Mantine 的日历内部用 dayjs 取月份 / 星期名，
  // 而它读的是全局 locale（DatesProvider 的 locale 只透传给组件树）。同值重复调用
  // 是无副作用的幂等操作，故放在渲染期安全。
  dayjs.locale(datesLocale)
  const project = useProjectStore((state) => state.project)
  const lastError = useProjectStore((state) => state.lastError)
  const clearError = useProjectStore((state) => state.clearError)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)

  // 让 <html lang> 跟随当前语言 —— 否则屏幕阅读器会用错误的语音朗读，
  // 搜索引擎也会误判页面语言
  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? 'zh-CN'
  }, [i18n.resolvedLanguage])

  // 排期的重算**不在这里** —— scheduleStore 订阅了 projectStore，
  // project 每次变更（含 loadProject / undo / redo）都会在那里重算一次。
  // 在这里再触发一次会让 solve() 白跑一遍。

  // 启动自动存盘。返回的清理函数会在卸载时把挂起的快照冲掉
  useEffect(() => startAutoSave((message) => setStorageWarning(message)), [])

  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      {/* 日期组件的语言与「一周起始日」由 DatesProvider 统一注入：
          locale 走 dayjs 的那一套串（与 i18next 的不是同一个，见 datesLocale.ts）；
          firstDayOfWeek=1（周一）与 Calendar.workingDays 的索引约定、monthMatrix 的
          周一起始一致 —— 三处必须同一个口径，否则「工作日」的排列会静默错位。 */}
      <DatesProvider settings={{ locale: datesLocale, firstDayOfWeek: 1 }}>
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
      </DatesProvider>
    </MantineProvider>
  )
}

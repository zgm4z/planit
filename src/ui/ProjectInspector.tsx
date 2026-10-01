import { Stack, TextInput } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { useProjectStore } from '../store/projectStore'

/**
 * 项目面板（spec §4）。本任务只落「名称」，Task 6 补方向 / 起止 / 摘要 / 格式 / 单位换算。
 * 它让「未选中任务时右栏永远有内容」成立 —— 修掉 v0.1 Task 20 提过的右栏塌陷。
 */
export function ProjectInspector() {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)!
  const dispatch = useProjectStore((state) => state.dispatch)
  const breakCoalescing = useProjectStore((state) => state.breakCoalescing)

  return (
    <Stack gap="sm">
      <TextInput
        label={t('inspector.project.name')}
        value={project.name}
        // 失焦 = 这次编辑结束，下一次改名另起一条撤销记录
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
    </Stack>
  )
}

import { ActionIcon, Group, Tooltip, Text, SegmentedControl } from '@mantine/core'
import {
  IconPlus,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowLeft,
  IconIndentIncrease,
  IconIndentDecrease,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'
import { useViewStore, type ZoomLevel } from '../store/viewStore'
import { canIndent, canOutdent } from './outlineActions'
import { LanguageSwitcher } from './LanguageSwitcher'

export function Toolbar() {
  const { t } = useTranslation()

  const project = useProjectStore((state) => state.project)
  const projectName = project?.name ?? ''
  const dispatch = useProjectStore((state) => state.dispatch)
  const undo = useProjectStore((state) => state.undo)
  const redo = useProjectStore((state) => state.redo)
  const closeProject = useProjectStore((state) => state.closeProject)
  const undoDepth = useProjectStore((state) => state.undoStack.length)
  const redoDepth = useProjectStore((state) => state.redoStack.length)
  const nextUndoLabel = useProjectStore(
    (state) => state.undoStack[state.undoStack.length - 1]?.command.label,
  )

  const zoom = useViewStore((state) => state.zoom)
  const setZoom = useViewStore((state) => state.setZoom)
  const selectedTaskId = useViewStore((state) => state.selectedTaskId)
  const scheduleError = useScheduleStore((state) => state.error)

  // 可用性判断与命令层守卫一致：不可达的操作直接禁用，而不是让用户点了没反应
  const indentEnabled = project ? canIndent(project, selectedTaskId) : false
  const outdentEnabled = project ? canOutdent(project, selectedTaskId) : false

  return (
    <Group
      h={48}
      px="md"
      gap="sm"
      wrap="nowrap"
      style={{ borderBottom: '1px solid var(--planit-border)', background: 'var(--planit-bg-surface)' }}
    >
      <Tooltip label={t('toolbar.backToList')}>
        <ActionIcon
          variant="subtle"
          aria-label={t('toolbar.backToList')}
          data-testid="back-to-list"
          onClick={closeProject}
        >
          <IconArrowLeft size={16} />
        </ActionIcon>
      </Tooltip>

      <Text fw={600} fz="lg" truncate maw={240}>
        {projectName}
      </Text>

      <Tooltip label={t('toolbar.newTask')}>
        <ActionIcon
          variant="light"
          aria-label={t('toolbar.newTask')}
          data-testid="new-task"
          onClick={() =>
            dispatch({
              type: 'task.create',
              label: 'commands.task.create',
              payload: { name: t('toolbar.newTask') },
            })
          }
        >
          <IconPlus size={16} />
        </ActionIcon>
      </Tooltip>

      {/* 缩进 / 反缩进：作用于当前选中的任务。两条命令都没有 coalesceKey，
          因此每次点击天然各成一条撤销记录，不需要额外的合并屏障。 */}
      <Tooltip label={t('toolbar.indentHint')}>
        <ActionIcon
          variant="subtle"
          disabled={!indentEnabled}
          aria-label={t('toolbar.indent')}
          data-testid="indent"
          onClick={() =>
            selectedTaskId &&
            dispatch({
              type: 'task.indent',
              label: 'commands.task.indent',
              payload: { taskId: selectedTaskId },
            })
          }
        >
          <IconIndentIncrease size={16} />
        </ActionIcon>
      </Tooltip>

      <Tooltip label={t('toolbar.outdentHint')}>
        <ActionIcon
          variant="subtle"
          disabled={!outdentEnabled}
          aria-label={t('toolbar.outdent')}
          data-testid="outdent"
          onClick={() =>
            selectedTaskId &&
            dispatch({
              type: 'task.outdent',
              label: 'commands.task.outdent',
              payload: { taskId: selectedTaskId },
            })
          }
        >
          <IconIndentDecrease size={16} />
        </ActionIcon>
      </Tooltip>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <SegmentedControl
          size="xs"
          value={zoom}
          onChange={(value) => setZoom(value as ZoomLevel)}
          data={[
            { value: 'day', label: t('toolbar.zoom.day') },
            { value: 'week', label: t('toolbar.zoom.week') },
            { value: 'month', label: t('toolbar.zoom.month') },
          ]}
        />

        <Tooltip
          label={
            nextUndoLabel
              ? // 分隔符（全角/半角冒号）跟着语言走，不能硬编码「：」——
                // 那样英文界面会渲染成 "Undo：Change duration"
                t('toolbar.undoWithLabel', { label: t(nextUndoLabel) })
              : t('toolbar.undo')
          }
        >
          <ActionIcon
            variant="subtle"
            disabled={undoDepth === 0}
            aria-label={t('toolbar.undo')}
            onClick={undo}
          >
            <IconArrowBackUp size={16} />
          </ActionIcon>
        </Tooltip>

        <Tooltip label={t('toolbar.redo')}>
          <ActionIcon variant="subtle" disabled={redoDepth === 0} aria-label={t('toolbar.redo')} onClick={redo}>
            <IconArrowForwardUp size={16} />
          </ActionIcon>
        </Tooltip>

        <LanguageSwitcher />
      </div>

      {scheduleError && (
        <Text c="red" fz="xs">
          {scheduleError}
        </Text>
      )}
    </Group>
  )
}

import { ActionIcon, Group, Tooltip, Text, SegmentedControl } from '@mantine/core'
import {
  IconPlus,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowLeft,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'
import { useViewStore, type ZoomLevel } from '../store/viewStore'
import { LanguageSwitcher } from './LanguageSwitcher'

export function Toolbar() {
  const { t } = useTranslation()

  const projectName = useProjectStore((state) => state.project?.name ?? '')
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
  const scheduleError = useScheduleStore((state) => state.error)

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

        <Tooltip label={nextUndoLabel ? `${t('toolbar.undo')}：${t(nextUndoLabel)}` : t('toolbar.undo')}>
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

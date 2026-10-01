import { useState } from 'react'
import { ActionIcon, Box, Button, Checkbox, Group, Text, TextInput } from '@mantine/core'
import { IconTrash } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { useProjectStore } from '../store/projectStore'

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

export function CalendarSettings() {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)
  const dispatch = useProjectStore((state) => state.dispatch)
  const [draftDate, setDraftDate] = useState('')

  if (!project) return null

  const calendar = project.calendars[project.calendarId]
  const exceptions = Object.entries(calendar.exceptions).sort(([a], [b]) => (a < b ? -1 : 1))

  function addHoliday(): void {
    if (!draftDate) return
    dispatch({
      type: 'calendar.addException',
      label: 'commands.calendar.addException',
      payload: { calendarId: calendar.id, date: draftDate, exception: { kind: 'holiday' } },
    })
    setDraftDate('')
  }

  return (
    <Box
      // 宽度由 ProjectView 的右侧栏容器统一持有（唯一来源），这里只填满它。
      w="100%"
      p="md"
      style={{ borderTop: '1px solid var(--planit-border)', flexShrink: 0 }}
      data-testid="calendar-settings"
    >
      <Text fz="xs" fw={650} c="dimmed" tt="uppercase" mb="xs">
        {t('calendar.title')}
      </Text>

      <Group gap="xs" mb="sm">
        {WEEKDAY_KEYS.map((key, index) => (
          <Checkbox
            key={key}
            size="xs"
            label={t(`calendar.weekdays.${key}`)}
            checked={calendar.workingDays[index]}
            // Checkbox 的 onChange 贴近原生 input：给的是事件，不是值。
            // 用 event.currentTarget.checked（与 NumberInput/Select 不同）。
            onChange={(event) => {
              const next = [...calendar.workingDays] as typeof calendar.workingDays
              next[index] = event.currentTarget.checked
              dispatch({
                type: 'calendar.setWorkingDays',
                label: 'commands.calendar.setWorkingDays',
                payload: { calendarId: calendar.id, workingDays: next },
              })
            }}
          />
        ))}
      </Group>

      <Text fz="xs" fw={650} c="dimmed" tt="uppercase" mb="xs">
        {t('calendar.exceptions')}
      </Text>

      <Group gap="xs" mb="xs" wrap="nowrap">
        <TextInput
          size="xs"
          type="date"
          aria-label={t('calendar.exceptions')}
          value={draftDate}
          // TextInput 同样是事件：用 event.currentTarget.value。
          onChange={(event) => setDraftDate(event.currentTarget.value)}
          style={{ flex: 1 }}
        />
        <Button size="xs" variant="light" onClick={addHoliday}>
          {t('calendar.addHoliday')}
        </Button>
      </Group>

      {exceptions.map(([date, exception]) => (
        <Group key={date} gap="xs" wrap="nowrap">
          <Text fz="xs" style={{ flex: 1 }}>
            {date}
          </Text>
          <Text fz="xs" c="dimmed">
            {exception.kind === 'holiday' ? t('calendar.holiday') : t('calendar.custom')}
          </Text>
          <ActionIcon
            size="sm"
            variant="subtle"
            color="red"
            aria-label={date}
            onClick={() =>
              dispatch({
                type: 'calendar.removeException',
                label: 'commands.calendar.removeException',
                payload: { calendarId: calendar.id, date },
              })
            }
          >
            <IconTrash size={12} />
          </ActionIcon>
        </Group>
      ))}
    </Box>
  )
}

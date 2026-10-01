import { Menu, ActionIcon, Tooltip } from '@mantine/core'
import { IconLanguage, IconCheck } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '../i18n'

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()

  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <Tooltip label={t('toolbar.language')}>
          <ActionIcon
            variant="subtle"
            aria-label={t('toolbar.language')}
            data-testid="language-switcher"
          >
            <IconLanguage size={16} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>

      <Menu.Dropdown>
        {SUPPORTED_LANGUAGES.map((lang) => (
          <Menu.Item
            key={lang.code}
            data-testid={`language-option-${lang.code}`}
            leftSection={
              i18n.resolvedLanguage === lang.code ? <IconCheck size={14} /> : <span style={{ width: 14 }} />
            }
            onClick={() => void i18n.changeLanguage(lang.code)}
          >
            {lang.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}

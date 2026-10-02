import { DEFAULT_LANGUAGE } from '../../i18n'

/**
 * `react-i18next` 的语言码 → **dayjs** 的 locale 串。
 *
 * 两套 locale 是两回事：i18next 用 `zh-CN` / `en-US` / `ja-JP`，Mantine 的
 * `DatesProvider` 的 `locale` 要 dayjs 的 `zh-cn` / `en` / `ja`。这个映射是它们之间
 * 唯一的一座桥 —— 别在组件里各写一份 `if (lang === 'zh-CN')`，否则 Mantine 的
 * 日历文案与 i18next 的界面文案会在某次语言增删后悄悄错位。
 *
 * 注意：dayjs 的 locale 还要**注册**才可用（`import 'dayjs/locale/zh-cn'`），
 * 注册发生在 App 入口 —— 本模块只负责「哪个串」，不负责「装了没有」。
 */
const MAP: Record<string, string> = {
  'zh-CN': 'zh-cn',
  'en-US': 'en',
  'ja-JP': 'ja',
}

/** 未知 / undefined 退回默认语言（与 i18n 的 fallbackLng 同源，见 `src/i18n/index.ts`） */
export function toDayjsLocale(language: string | undefined): string {
  return MAP[language ?? ''] ?? MAP[DEFAULT_LANGUAGE] ?? 'en'
}

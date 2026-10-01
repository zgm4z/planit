/**
 * 文案原则（v0.6 确立，源自 `docs/superpowers/plans/2026-10-01-v0.6-resource-leveling.md` 偏差 8）：
 *
 * **面向用户的文案里，只有当某个功能确实落在路线图 `docs/superpowers/ROADMAP.md`
 * 中某个真实存在的版本上时，才写那个版本号；否则一律写「尚未排期」。**
 *
 * 由来：v0.2 的占位文案把「资源平衡」写成「将在 v0.6 提供」、把「预计工作量」
 * 写成「将在 v0.6 / v1.0 提供」。前者到 v0.6 落地后从未来时变成过期标注；后者
 * 的 v1.0 其实并不确定覆盖它（v1.0 spec 自称该块「可能拆成 v1.1」）。给用户看
 * 一个会过期的版本号，比老实说「尚未排期」更糟 —— 它会在版本发布后变成谎言。
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import zhCN from './locales/zh-CN.json'
import enUS from './locales/en-US.json'
import jaJP from './locales/ja-JP.json'

export const SUPPORTED_LANGUAGES = [
  { code: 'zh-CN', label: '中文' },
  { code: 'en-US', label: 'English' },
  { code: 'ja-JP', label: '日本語' },
] as const

export const LANGUAGE_STORAGE_KEY = 'planit.language'

/**
 * 默认语言。工具栏的溢出指示器用它判断「被收进菜单的控件是否处于非默认状态」——
 * 语言不是默认中文时，指示器要点亮（见 Toolbar 的 OverflowMenu）。
 * 与 fallbackLng 同一个值，避免两处各写一份 'zh-CN' 而漂移。
 */
export const DEFAULT_LANGUAGE = 'zh-CN'

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': { translation: zhCN },
      'en-US': { translation: enUS },
      'ja-JP': { translation: jaJP },
    },
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES.map((lang) => lang.code),
    // 只认完整的语言标签（zh-CN 而非 zh-Hans-CN），避免检测器产生我们没有的变体
    load: 'currentOnly',
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
  })

export default i18n

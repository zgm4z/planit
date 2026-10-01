import { useEffect } from 'react'
import { ActionIcon, Menu, SegmentedControl, Text, Tooltip } from '@mantine/core'
import { IconArrowLeft, IconDotsVertical, IconCheck } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { useProjectStore } from '../../store/projectStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useViewStore, type ActiveView, type ZoomLevel } from '../../store/viewStore'
import { MenuBar } from './MenuBar'
import { LanguageSwitcher } from './LanguageSwitcher'
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from '../../i18n'
import { useLayoutMode } from '../shared/useBreakpoints'
import styles from '../styles/Chrome.module.scss'

/**
 * TopBar（§1.1 / §2.1 / §6 / §7 / §10）。
 *
 * 分工（§10.1）——**操作进菜单，显示模式留右侧**：
 *   [身份 8] 返回 · 项目名          —— 名字是 18px/600 的标题，与图标同组
 *   [菜单栏 16] 文件 编辑 视图 任务 项目 资源
 *   [弹性空档 —— 把「怎么看」的控件推到右缘]
 *   [视图 6] 甘特图 / 任务列表
 *   [组间 16]
 *   [缩放 6] 日 / 周 / 月
 *   [组间 16]
 *   [设置] 语言                     —— 全局偏好
 *
 * 为什么 ＋ 新建 / 缩进 / 反缩进 / 撤销 / 重做**不再是图标按钮**：它们是「做一件事」，
 * 归菜单栏（§10.2）。撤销/重做进「编辑」菜单本就是桌面应用的惯例。代价是新建任务
 * 多一次点击 —— 但显示类控件（视图切换、缩放）**留在原地**，因为把高频的「怎么看」
 * 收进菜单才是真的变慢。这一取一舍就是 §10.1 的分工。
 *
 * 「相关的靠近、无关的拉开」仍由间距表达：组内 6px，跨组 16px。
 *
 * §7 窄屏（< 1100）：缩放与语言收进「更多」溢出菜单 —— 溢出入口带**可感知指示器**
 * （⋯ 图标 + tooltip，非默认状态时点亮小圆点），见 OverflowMenu。菜单栏不清空
 * （它是操作入口，不是次要控件），项目名此时会自行截断。
 */
export function Toolbar() {
  const { t } = useTranslation()
  // §7 的断点来自唯一一份定义（outlineColumns 的 1100 / 900，由 useLayoutMode 消费）——
  // 不在工具栏里再写一个 1100，否则 JS 的媒体查询会与 CSS / 列注册表产生 off-by-one 分歧。
  const { isNarrow: narrow } = useLayoutMode()

  const project = useProjectStore((state) => state.project)
  const projectName = project?.name ?? ''
  const undo = useProjectStore((state) => state.undo)
  const redo = useProjectStore((state) => state.redo)
  const closeProject = useProjectStore((state) => state.closeProject)

  const zoom = useViewStore((state) => state.zoom)
  const setZoom = useViewStore((state) => state.setZoom)
  const activeView = useViewStore((state) => state.activeView)
  const setActiveView = useViewStore((state) => state.setActiveView)
  const scheduleError = useScheduleStore((state) => state.error)

  // 撤销 / 重做的键盘快捷键。绑上之后「编辑」菜单里标 ⌘Z / ⇧⌘Z 才是诚实的
  // （§10.3.3：没有绑定就不该标）。输入框里不抢 Ctrl+Z，见下面的守卫。
  useUndoRedoShortcuts(undo, redo)

  return (
    <div className={styles.toolbar} data-testid="toolbar">
      {/* 身份组：返回 + 项目名（§1.1 的 18px / 600 标题） */}
      <div className={styles.identity}>
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

        <Text className={styles.projectName} truncate maw={280}>
          {projectName}
        </Text>
      </div>

      {/* 操作菜单栏（§10）：文件 编辑 视图 任务 项目 资源 */}
      <MenuBar />

      <div className={styles.spacer} />

      {/* 视图切换：两个并列的视图，不是同一布局的两种宽度（spec §1）。
          label 用 span 包一层带 data-testid —— e2e 靠它点击，不依赖文案。 */}
      <div className={styles.group}>
        <SegmentedControl
          size="xs"
          value={activeView}
          onChange={(value) => setActiveView(value as ActiveView)}
          data-testid="view-switcher"
          data={[
            { value: 'gantt', label: <span data-testid="view-option-gantt">{t('toolbar.view.gantt')}</span> },
            { value: 'outline', label: <span data-testid="view-option-outline">{t('toolbar.view.outline')}</span> },
          ]}
        />
      </div>

      {/* 缩放组：只影响甘特图的横向密度，与视图切换是两回事，故拉开 16px。
          窄屏收进溢出菜单。（菜单里另有一份，见 MenuBar 的「视图」——菜单是完整的
          操作清单，这条是留在条上的**快速通道**。） */}
      {!narrow && (
        <div className={styles.group}>
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
        </div>
      )}

      {/* 设置组：语言（+ 窄屏溢出菜单）。全局偏好，与显示类控件刻意拉开 16px。 */}
      {narrow ? (
        <OverflowMenu zoom={zoom} setZoom={setZoom} />
      ) : (
        <div className={styles.group}>
          <LanguageSwitcher />
        </div>
      )}

      {scheduleError && (
        <Text className={styles.conflict} role="alert">
          {scheduleError}
        </Text>
      )}
    </div>
  )
}

/**
 * 绑定 Ctrl/Cmd+Z → 撤销，Ctrl/Cmd+Shift+Z → 重做（§10.3.3）。
 *
 * 焦点在输入框 / 可编辑区域里时**不接管**：用户改了一半的备注或工期，此刻按
 * Ctrl+Z 想撤的是「刚才敲的字」，而不是「上一条命令」——抢过来会毁掉输入。
 * （Mantine 的 TextInput / NumberInput / DateInput 都渲染成原生 <input>，
 * 一并覆盖。）
 */
function useUndoRedoShortcuts(undo: () => void, redo: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // 只认单选修饰键的组合，避免与 Ctrl+Alt+Z 之类的系统/输入法快捷键打架
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      if (event.key.toLowerCase() !== 'z') return
      if (isEditableTarget(event.target)) return

      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])
}

/** 焦点是否落在可编辑控件里（输入框 / 文本域 / 下拉 / contenteditable） */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * 窄屏溢出菜单（§7）：把缩放档位与语言收进一个菜单。
 *
 * 编辑组（新建 / 缩进 / 反缩进 / 撤销 / 重做）**不在这里**了 —— 它们已归菜单栏的
 * 任务 / 编辑菜单，任何视口下都能从那里够到，收进溢出菜单只会多一份重复。
 *
 * 溢出指示器（§7 / §9 响应式）——**「此处还有内容」必须可感知**：
 *   1) 图标用 IconDotsVertical（⋯）—— 它是跨平台公认的「更多 / 溢出」约定符号；
 *      并保留 tooltip（`toolbar.more`）作为文字兜底。
 *   2) 当**被收进菜单的控件里有非默认值**时（缩放不是「日」、语言不是默认中文），
 *      右上角点亮一个小圆点 —— 否则用户会以为自己的设置丢了。
 */
function OverflowMenu({
  zoom,
  setZoom,
}: {
  zoom: ZoomLevel
  setZoom: (zoom: ZoomLevel) => void
}) {
  const { t, i18n } = useTranslation()

  const zoomLevels: ZoomLevel[] = ['day', 'week', 'month']

  // 被收进菜单的控件里存在「非默认状态」吗？—— 用于点亮溢出指示器。
  //   · 缩放：默认「日」（viewStore 的初值 dayWidth = day）。
  //   · 语言：默认中文（i18n 的 fallbackLng / DEFAULT_LANGUAGE）。resolvedLanguage
  //     在 init 前可能为 undefined，用 ?? 兜成默认，避免误亮。
  const hasNonDefault =
    zoom !== 'day' || (i18n.resolvedLanguage ?? DEFAULT_LANGUAGE) !== DEFAULT_LANGUAGE

  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <Tooltip label={t('toolbar.more')}>
          <ActionIcon
            variant="subtle"
            aria-label={t('toolbar.more')}
            data-testid="toolbar-overflow"
            // data-* 而不是内联样式：CSS Module 里按属性选择器点亮角标（见 Chrome.module.scss
            // 的 .overflow）。值为 'true' 时出现，false/undefined 时属性整体不输出。
            data-has-hidden={hasNonDefault || undefined}
            className={styles.overflow}
          >
            <IconDotsVertical size={16} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Label>{t('toolbar.zoomLabel')}</Menu.Label>
        {zoomLevels.map((level) => (
          <Menu.Item
            key={level}
            data-testid={`zoom-option-${level}`}
            leftSection={
              zoom === level ? <IconCheck size={14} /> : <span style={{ width: 14 }} aria-hidden />
            }
            onClick={() => setZoom(level)}
          >
            {t(`toolbar.zoom.${level}`)}
          </Menu.Item>
        ))}

        <Menu.Divider />
        <Menu.Label>{t('toolbar.language')}</Menu.Label>
        {SUPPORTED_LANGUAGES.map((lang) => (
          <Menu.Item
            key={lang.code}
            data-testid={`language-option-${lang.code}`}
            leftSection={
              i18n.resolvedLanguage === lang.code ? (
                <IconCheck size={14} />
              ) : (
                <span style={{ width: 14 }} aria-hidden />
              )
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

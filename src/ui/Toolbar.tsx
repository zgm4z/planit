import { ActionIcon, Menu, SegmentedControl, Text, Tooltip } from '@mantine/core'
import {
  IconPlus,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowLeft,
  IconIndentIncrease,
  IconIndentDecrease,
  IconDotsVertical,
  IconCheck,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'
import { useViewStore, type ActiveView, type ZoomLevel } from '../store/viewStore'
import { canIndent, canOutdent } from './outlineActions'
import { LanguageSwitcher } from './LanguageSwitcher'
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from '../i18n'
import { useLayoutMode } from './useBreakpoints'
import styles from './styles/Chrome.module.scss'

/**
 * 工具栏（§1.1 / §2.1 / §6 / §7）。
 *
 * 分组方案（左 → 右，间距用 §2.1 的节奏）：
 *   [身份 8] 返回 · 项目名        —— 名字是 18px/600 的标题，与图标同组
 *   [组间 16]
 *   [编辑 6] 新建 · 缩进 · 反缩进  —— 都作用于当前任务树，组内紧靠
 *   [弹性空档 —— 把显示类控件推到右缘]
 *   [视图 6] 甘特图 / 任务列表
 *   [组间 16]
 *   [缩放 6] 日 / 周 / 月
 *   [组间 16]
 *   [历史 6] 撤销 · 重做          —— 与显示类控件是两类，故左右都拉开 16
 *   [组间 16]
 *   [设置] 语言                   —— 全局偏好，与历史刻意拉开
 *
 * 「相关的靠近、无关的拉开」：6px 只出现在**同一功能**的控件之间，16px 一律
 * 出现在**跨功能**处。旧版处处 8px 因此读不出任何分组。
 *
 * §7 窄屏（< 1100）：编辑组 / 缩放 / 语言收进「更多」溢出菜单 —— 溢出入口带
 * **可感知指示器**（⋯ 图标 + tooltip，非默认状态时点亮小圆点），见 OverflowMenu。
 */
export function Toolbar() {
  const { t } = useTranslation()
  // §7 的断点来自唯一一份定义（outlineColumns 的 1100 / 900，由 useLayoutMode 消费）——
  // 不在工具栏里再写一个 1100，否则 JS 的媒体查询会与 CSS / 列注册表产生 off-by-one 分歧。
  const { isNarrow: narrow } = useLayoutMode()

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
  const activeView = useViewStore((state) => state.activeView)
  const setActiveView = useViewStore((state) => state.setActiveView)
  const scheduleError = useScheduleStore((state) => state.error)

  // 可用性判断与命令层守卫一致：不可达的操作直接禁用，而不是让用户点了没反应
  const indentEnabled = project ? canIndent(project, selectedTaskId) : false
  const outdentEnabled = project ? canOutdent(project, selectedTaskId) : false

  const createTask = () =>
    dispatch({
      type: 'task.create',
      label: 'commands.task.create',
      payload: { name: t('toolbar.newTask') },
    })

  const indent = () =>
    selectedTaskId &&
    dispatch({
      type: 'task.indent',
      label: 'commands.task.indent',
      payload: { taskId: selectedTaskId },
    })

  const outdent = () =>
    selectedTaskId &&
    dispatch({
      type: 'task.outdent',
      label: 'commands.task.outdent',
      payload: { taskId: selectedTaskId },
    })

  const undoLabel = nextUndoLabel
    ? // 分隔符（全角/半角冒号）跟着语言走，不能硬编码「：」——
      // 那样英文界面会渲染成 "Undo：Change duration"
      t('toolbar.undoWithLabel', { label: t(nextUndoLabel) })
    : t('toolbar.undo')

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

      {/* 编辑组：作用于任务树的三个动作，组内 6px。
          窄屏收进溢出菜单 —— 它比「视图/历史」次要。 */}
      {!narrow && (
        <div className={styles.group}>
          <Tooltip label={t('toolbar.newTask')}>
            <ActionIcon
              variant="light"
              aria-label={t('toolbar.newTask')}
              data-testid="new-task"
              onClick={createTask}
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
              onClick={indent}
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
              onClick={outdent}
            >
              <IconIndentDecrease size={16} />
            </ActionIcon>
          </Tooltip>
        </div>
      )}

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
          窄屏收进溢出菜单。 */}
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

      {/* 历史组：撤销 / 重做。与显示类控件不同族，左右都拉开 16px。 */}
      <div className={styles.group}>
        <Tooltip label={undoLabel}>
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
      </div>

      {/* 设置组：语言（+ 窄屏溢出菜单）。全局偏好，与历史刻意拉开 16px。 */}
      {narrow ? (
        <OverflowMenu
          indent={indent}
          outdent={outdent}
          indentEnabled={indentEnabled}
          outdentEnabled={outdentEnabled}
          createTask={createTask}
          zoom={zoom}
          setZoom={setZoom}
        />
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
 * 窄屏溢出菜单（§7）：把编辑组、缩放档位与语言收进一个菜单。
 *
 * 菜单项**复用**主条上同名控件的 data-testid —— 两条分支都靠 `!narrow` 条件渲染，
 * 任何时刻只有一份在 DOM 里，因此 e2e 在宽窄两种视口下都能按同一个 testid 命中。
 *
 * 溢出指示器（§7 / §9 响应式）——**「此处还有内容」必须可感知**：
 *   1) 图标用 IconDotsVertical（⋯）——它是跨平台公认的「更多 / 溢出」约定符号，
 *      比 IconAdjustmentsHorizontal（读作「筛选 / 设置」）更明确地表达「藏着东西」；
 *      并保留 tooltip（`toolbar.more`）作为文字兜底。这两者共同构成「有东西被收起」的
 *      常驻提示 —— 一个纯图标按钮（旧形态）看不出还有内容，是本条要修的缺陷。
 *   2) 当**被收进菜单的控件里有非默认值**时（缩放不是「日」、语言不是默认中文），
 *      右上角点亮一个小圆点 —— 否则用户会以为自己的设置丢了（§9：窄屏下不该悄悄
 *      改变用户看到的状态）。这是「指示器能反映非默认状态」的落点。
 */
function OverflowMenu({
  createTask,
  indent,
  outdent,
  indentEnabled,
  outdentEnabled,
  zoom,
  setZoom,
}: {
  createTask: () => void
  indent: () => void
  outdent: () => void
  indentEnabled: boolean
  outdentEnabled: boolean
  zoom: ZoomLevel
  setZoom: (zoom: ZoomLevel) => void
}) {
  const { t, i18n } = useTranslation()

  const zoomLevels: ZoomLevel[] = ['day', 'week', 'month']

  // 被收进菜单的控件里存在「非默认状态」吗？—— 用于点亮溢出指示器。
  //   · 缩放：默认「日」（viewStore 的初值 dayWidth = day）。
  //   · 语言：默认中文（i18n 的 fallbackLng / DEFAULT_LANGUAGE）。resolvedLanguage
  //     在 init 前可能为 undefined，用 ?? 兜成默认，避免误亮。
  // 编辑组（新建 / 缩进 / 反缩进）没有持久状态，故不参与判断。
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
        <Menu.Item
          data-testid="new-task"
          leftSection={<IconPlus size={14} />}
          onClick={createTask}
        >
          {t('toolbar.newTask')}
        </Menu.Item>
        <Menu.Item
          data-testid="indent"
          disabled={!indentEnabled}
          leftSection={<IconIndentIncrease size={14} />}
          onClick={indent}
        >
          {t('toolbar.indent')}
        </Menu.Item>
        <Menu.Item
          data-testid="outdent"
          disabled={!outdentEnabled}
          leftSection={<IconIndentDecrease size={14} />}
          onClick={outdent}
        >
          {t('toolbar.outdent')}
        </Menu.Item>

        <Menu.Divider />
        <Menu.Label>{t('toolbar.zoomLabel')}</Menu.Label>
        {zoomLevels.map((level) => (
          <Menu.Item
            key={level}
            data-testid={`zoom-option-${level}`}
            leftSection={
              zoom === level ? <IconCheck size={14} /> : <span style={{ width: 14 }} />
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
                <span style={{ width: 14 }} />
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

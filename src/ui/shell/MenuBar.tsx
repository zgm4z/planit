import { Fragment, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Menu } from '@mantine/core'
import { IconCheck } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { findActiveBaseline } from '../../domain/model/baseline'
import type { SchedulingDirection } from '../../domain/model/types'
import { useProjectStore } from '../../store/projectStore'
import {
  useViewStore,
  DAY_WIDTH_PRESETS,
  presetOfDayWidth,
  type ActiveView,
  type ZoomPreset,
} from '../../store/viewStore'
import { createResourceAndGetId } from '../shared/resourceActions'
import { selectionFingerprint } from '../shared/selectionRange'
import styles from '../styles/Chrome.module.scss'
import { buildTaskActions, type TaskActionContext } from '../shared/taskActions'

/**
 * TopBar 菜单栏（设计规范 §10）。
 *
 * 分工（§10.1）：菜单栏放**操作**（做一件事）；右侧的视图切换 / 缩放是「怎么看」
 * 而非「做什么」，留在原地 —— 把显示模式收进菜单只会让高频切换变慢。
 *
 * 这里的条目**只放真能用的**（§10.3.1）：每一条都对得上一条已注册的命令或一个
 * 已存在的 store 动作。没有实现的东西（导出、打印、跨项目依赖）一条都不出现。
 * 需要前提而前提不满足时**禁用并给出理由**，不隐藏（§10.3.2）—— 理由显示在条目的
 * 右侧槽位（见 `.menuReason`）。快捷键同样占这个槽位，但**只在真的绑定了处理器时**
 * 才显示（§10.3.3）：目前只有 撤销 / 重做 绑了（见 Toolbar 的 useUndoRedoShortcuts），
 * 所以也只有它们显示 ⌘Z / ⇧⌘Z。
 *
 * 为什么不给条目配图标：图标若只是重复标签（一个 ＋ 配「新建任务」）就是纯装饰，
 * 属 §8 反面清单。唯一保留的「图形」是**勾选标记**——它承载状态，不是装饰。
 */
const MENU_IDS = ['file', 'edit', 'view', 'task', 'project', 'resource'] as const
type MenuId = (typeof MENU_IDS)[number]

/**
 * 撤销 / 重做的快捷键文案。平台不同修饰键不同 —— 在 Windows 上标 ⌘Z 是错的，
 * 与「标了按不出来」是同一类谎言（§10.3.3）。
 */
const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl'
const UNDO_SHORTCUT = `${MOD_LABEL}Z`
const REDO_SHORTCUT = IS_MAC ? `⇧${MOD_LABEL}Z` : `${MOD_LABEL}+Shift+Z`

export function MenuBar() {
  const { t } = useTranslation()

  /**
   * 当前展开的菜单。**必须由这里（父级）持有**，不能交给每个 Menu 自管：
   * §10.4 要求「展开状态下悬停其它菜单标题即切换」，这是**跨菜单**的状态迁移，
   * 而 Mantine 的 Menu 彼此独立、感知不到兄弟菜单（它只支持单个菜单的
   * trigger="hover"，那是「悬停即开」而不是「已展开时悬停即切换」）。
   * 自己管一个 openMenu 是本项目不引新依赖就能做到这件事的最小形态。
   */
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null)

  // 悬停切换**仅在已有菜单展开时**生效：一个都没开时，鼠标扫过菜单栏不该连续
  // 弹出六个菜单。这是菜单栏（menubar）的标准行为。
  const handleHover = (id: MenuId) => {
    if (openMenu !== null && openMenu !== id) setOpenMenu(id)
  }

  return (
    <div className={styles.menubar} data-testid="menubar">
      <TopMenu
        id="file"
        label={t('menu.file')}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        onHover={handleHover}
      >
        <FileItems />
      </TopMenu>

      <TopMenu
        id="edit"
        label={t('menu.edit')}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        onHover={handleHover}
      >
        <EditItems />
      </TopMenu>

      <TopMenu
        id="view"
        label={t('menu.view')}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        onHover={handleHover}
      >
        <ViewItems />
      </TopMenu>

      <TopMenu
        id="task"
        label={t('menu.task')}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        onHover={handleHover}
      >
        <TaskItems />
      </TopMenu>

      <TopMenu
        id="project"
        label={t('menu.project')}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        onHover={handleHover}
      >
        <ProjectItems />
      </TopMenu>

      <TopMenu
        id="resource"
        label={t('menu.resource')}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        onHover={handleHover}
      >
        <ResourceItems />
      </TopMenu>
    </div>
  )
}

/**
 * 一个菜单标题 + 它的下拉。标题是**文字按钮**，不是图标（§10.1 的形态）。
 *
 * `opened` 受控于父级的 openMenu —— 于是「悬停其它标题即切换」只需改一个状态即可
 * 让旧菜单自动收起（它的 opened 变成 false），不需要手动关旧开新。
 */
function TopMenu({
  id,
  label,
  openMenu,
  setOpenMenu,
  onHover,
  children,
}: {
  id: MenuId
  label: string
  openMenu: MenuId | null
  setOpenMenu: (id: MenuId | null) => void
  onHover: (id: MenuId) => void
  children: ReactNode
}) {
  const opened = openMenu === id

  return (
    <Menu
      opened={opened}
      // 受控 onChange：点击标题切换、Esc、点外部都会走到这里。
      // Esc 关闭后 Mantine 默认把焦点还给标题（returnFocus 默认 true），满足 §10.4。
      onChange={(next) => setOpenMenu(next ? id : null)}
      trigger="click"
      position="bottom-start"
      withinPortal
    >
      <Menu.Target>
        <button
          type="button"
          className={styles.menuTitle}
          data-open={opened || undefined}
          data-testid={`menu-${id}`}
          onMouseEnter={() => onHover(id)}
        >
          {label}
        </button>
      </Menu.Target>

      <Menu.Dropdown className={styles.menuDropdown}>{children}</Menu.Dropdown>
    </Menu>
  )
}

/**
 * 条目的右侧槽位：**快捷键优先，其次禁用理由**（§10.3.2 / §10.3.3）。
 *
 * 二者共用一槽是刻意的：一个条目不可能同时「禁用」与「可按快捷键执行」——
 * 禁用的撤销也不该显示 ⌘Z（按了没反应）。于是：
 *   可用且绑了快捷键 → 显示快捷键（让菜单诚实）
 *   禁用             → 显示理由（而不是让用户对着灰条目猜）
 */
function itemHint({
  disabled,
  reason,
  shortcut,
}: {
  disabled: boolean
  reason?: string
  shortcut?: string
}): ReactNode {
  if (!disabled && shortcut) return <span className={styles.menuShortcut}>{shortcut}</span>
  if (disabled && reason) return <span className={styles.menuReason}>{reason}</span>
  return undefined
}

/**
 * 勾选标记（§10.4）：当前状态**只**用勾选表达，不加粗、不换色。
 * 未勾选时占同宽空位，条目标签左缘因此对齐（与 OverflowMenu 同一手法）。
 */
function Check({ on }: { on: boolean }) {
  return on ? <IconCheck size={14} /> : <span style={{ width: 14 }} aria-hidden />
}

/* ── 文件 ─────────────────────────────────────────────── */
function FileItems() {
  const { t } = useTranslation()
  const closeProject = useProjectStore((state) => state.closeProject)

  // 没有 data-testid="back-to-list"：那个 testid 属于 TopBar 左端的 ← 图标
  // （§10.1 的形态里它仍在）。同一个 testid 出现在两处会让 e2e 的定位变成 2 个匹配。
  return (
    <Menu.Item data-testid="menu-back-to-list" onClick={closeProject}>
      {t('toolbar.backToList')}
    </Menu.Item>
  )
}

/* ── 编辑 ─────────────────────────────────────────────── */
function EditItems() {
  const { t } = useTranslation()
  const dispatch = useProjectStore((state) => state.dispatch)
  const undo = useProjectStore((state) => state.undo)
  const redo = useProjectStore((state) => state.redo)
  const undoDepth = useProjectStore((state) => state.undoStack.length)
  const redoDepth = useProjectStore((state) => state.redoStack.length)
  const nextUndo = useProjectStore(
    (state) => state.undoStack[state.undoStack.length - 1]?.command.label,
  )
  const nextRedo = useProjectStore(
    (state) => state.redoStack[state.redoStack.length - 1]?.command.label,
  )
  const selectedTaskIds = useViewStore((state) => state.selectedTaskIds)
  const breakCoalescing = useProjectStore((state) => state.breakCoalescing)

  const undoDisabled = undoDepth === 0
  const redoDisabled = redoDepth === 0
  const deleteDisabled = selectedTaskIds.length === 0

  return (
    <>
      {/* 条目文字带上「撤的是哪一步」（撤销：新建任务）—— 与旧工具栏的 tooltip 同一个
          信息，只是从悬停提示搬到了条目本身：菜单里一直看得见，比 tooltip 更该有。 */}
      <Menu.Item
        data-testid="undo"
        disabled={undoDisabled}
        rightSection={itemHint({
          disabled: undoDisabled,
          reason: t('menu.reason.noUndo'),
          shortcut: UNDO_SHORTCUT,
        })}
        onClick={undo}
      >
        {nextUndo ? t('toolbar.undoWithLabel', { label: t(nextUndo) }) : t('toolbar.undo')}
      </Menu.Item>

      <Menu.Item
        data-testid="redo"
        disabled={redoDisabled}
        rightSection={itemHint({
          disabled: redoDisabled,
          reason: t('menu.reason.noRedo'),
          shortcut: REDO_SHORTCUT,
        })}
        onClick={redo}
      >
        {nextRedo ? t('toolbar.redoWithLabel', { label: t(nextRedo) }) : t('toolbar.redo')}
      </Menu.Item>

      <Menu.Divider />

      {/* 删除任务不标红：§4.2 明说红色只给关键路径与冲突，不给删除按钮的常态。 */}
      <Menu.Item
        data-testid="delete-task"
        disabled={deleteDisabled}
        rightSection={itemHint({
          disabled: deleteDisabled,
          reason: t('menu.reason.noSelection'),
        })}
        onClick={() => {
          if (deleteDisabled) return
          // 批量删除共用一个合并键 → 一条撤销记录，一次 Ctrl+Z 全部恢复（判据 9）
          const fingerprint = selectionFingerprint(selectedTaskIds)
          breakCoalescing()
          for (const taskId of selectedTaskIds) {
            dispatch({
              type: 'task.delete',
              label: 'commands.task.delete',
              payload: { taskId },
              coalesceKey: `task.delete:${fingerprint}`,
            })
          }
        }}
      >
        {t('commands.task.delete')}
      </Menu.Item>
    </>
  )
}

/* ── 视图 ─────────────────────────────────────────────── */
function ViewItems() {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)
  const activeView = useViewStore((state) => state.activeView)
  const setActiveView = useViewStore((state) => state.setActiveView)
  const dayWidth = useViewStore((state) => state.dayWidth)
  const setDayWidth = useViewStore((state) => state.setDayWidth)
  const collapsedIds = useViewStore((state) => state.collapsedIds)
  const collapseAll = useViewStore((state) => state.collapseAll)
  const expandAll = useViewStore((state) => state.expandAll)

  // 有子任务的行才可折叠 —— 与 viewStore.collapseAll 的判定同一规则（childIds）。
  const collapsibleIds = project
    ? Object.values(project.tasks)
        .filter((task) => task.childIds.length > 0)
        .map((task) => task.id)
    : []
  const collapseAllDisabled =
    collapsibleIds.length === 0 || collapsibleIds.every((id) => collapsedIds.has(id))
  const expandAllDisabled = collapsedIds.size === 0

  const views: { view: ActiveView; label: string }[] = [
    { view: 'gantt', label: t('toolbar.view.gantt') },
    { view: 'outline', label: t('toolbar.view.outline') },
    { view: 'calendar', label: t('toolbar.view.calendar') },
    { view: 'resources', label: t('toolbar.view.resources') },
  ]
  const presets: ZoomPreset[] = ['day', 'week', 'month']

  return (
    <>
      {views.map(({ view, label }) => (
        <Menu.Item
          key={view}
          data-testid={`menu-view-${view}`}
          leftSection={<Check on={activeView === view} />}
          onClick={() => setActiveView(view)}
        >
          {label}
        </Menu.Item>
      ))}

      <Menu.Divider />

      {presets.map((level) => (
        <Menu.Item
          key={level}
          data-testid={`menu-zoom-option-${level}`}
          leftSection={<Check on={presetOfDayWidth(dayWidth) === level} />}
          onClick={() => setDayWidth(DAY_WIDTH_PRESETS[level])}
        >
          {t(`toolbar.zoom.${level}`)}
        </Menu.Item>
      ))}

      <Menu.Divider />

      <Menu.Item
        data-testid="menu-collapse-all"
        disabled={collapseAllDisabled}
        rightSection={itemHint({
          disabled: collapseAllDisabled,
          reason: t(collapsibleIds.length === 0 ? 'menu.reason.noGroups' : 'menu.reason.allCollapsed'),
        })}
        onClick={collapseAll}
      >
        {t('menu.collapseAll')}
      </Menu.Item>

      <Menu.Item
        data-testid="menu-expand-all"
        disabled={expandAllDisabled}
        rightSection={itemHint({
          disabled: expandAllDisabled,
          reason: t('menu.reason.noneCollapsed'),
        })}
        onClick={expandAll}
      >
        {t('menu.expandAll')}
      </Menu.Item>
    </>
  )
}

/* ── 任务 ─────────────────────────────────────────────── */

// 菜单栏「任务」菜单只放这 4 项：新建子任务 / 重命名是**右键菜单独有的入口**。
// ⚠️ delete-task **不在**「任务」菜单里 —— 它在「编辑」菜单（见上面的 EditItems），
//    那条**保持原样不动**，否则会出现两个删除入口。
const MENUBAR_ACTION_IDS = ['new-task', 'indent', 'outdent', 'toggle-milestone'] as const

function TaskItems() {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)
  const dispatch = useProjectStore((state) => state.dispatch)
  const selectedTaskId = useViewStore((state) => state.selectedTaskId)
  const selectedTaskIds = useViewStore((state) => state.selectedTaskIds)
  const beginTitleEdit = useViewStore((state) => state.beginTitleEdit)
  const breakCoalescing = useProjectStore((state) => state.breakCoalescing)

  // 任务动作**唯一实现**：菜单栏与右键菜单都渲染这张表。启用判据（能否缩进、
  // 能否设为里程碑……）复用 outlineActions 里与命令层守卫同源的只读镜像 ——
  // 在这里另写一遍就是「同一规则两份实现」，将来命令层放宽/收紧时菜单会静默漂移。
  const taskActions = useMemo(() => buildTaskActions(t), [t])

  return (
    <>
      {MENUBAR_ACTION_IDS.map((id) => {
        const action = taskActions.find((a) => a.id === id)!
        const ctx: TaskActionContext = {
          taskIds: selectedTaskIds,
          anchorId: selectedTaskId,
          project: project!,
          dispatch,
          breakCoalescing,
          beginTitleEdit,
        }
        const reason = action.disabledReason(ctx)
        return (
          <Fragment key={id}>
            {action.dividerBefore && <Menu.Divider />}
            <Menu.Item
              data-testid={id} // 既有 testid 恰好等于 action id，逐条保留
              disabled={reason !== null}
              rightSection={itemHint({ disabled: reason !== null, reason: reason ?? undefined })}
              onClick={() => {
                if (reason === null) action.run(ctx)
              }}
            >
              {action.label(ctx)}
            </Menu.Item>
          </Fragment>
        )
      })}
    </>
  )
}

/* ── 项目 ─────────────────────────────────────────────── */
function ProjectItems() {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)
  const dispatch = useProjectStore((state) => state.dispatch)
  const breakCoalescing = useProjectStore((state) => state.breakCoalescing)

  if (!project) return null

  const baselines = project.baselines
  // 活动基线的判定收敛到 findActiveBaseline（项目面板的基线事实行同一处取）——
  // 「删除当前基线」的可删目标就是它，禁用与否也由它决定（§10.3.2：不满足前提就禁用）。
  const activeBaseline = findActiveBaseline(project)
  const deleteBaselineDisabled = activeBaseline === undefined

  const directions: { value: SchedulingDirection; label: string }[] = [
    { value: 'forward', label: t('inspector.project.directionForward') },
    { value: 'backward', label: t('inspector.project.directionBackward') },
  ]

  return (
    <>
      <Menu.Sub>
        <Menu.Sub.Target>
          {/* 右侧的 ▸ 由 Mantine 的 Menu.Sub.Item 自动补（它默认渲染一个 chevron）——
              自己再传一个 rightSection 会把它顶掉，反而不一致。 */}
          <Menu.Sub.Item data-testid="menu-direction">
            {t('inspector.project.direction')}
          </Menu.Sub.Item>
        </Menu.Sub.Target>

        <Menu.Sub.Dropdown>
          {/* 叶子条目用 Menu.Item 而不是 Menu.Sub.Item：后者**总是**补一个 ▸
              （`rightSection || <AccordionChevron/>`），于是「向前 / 向后」这两个
              终点会被画成还有下一级子菜单。Menu.Item 不补，且同样认 ArrowLeft 收子菜单。 */}
          {directions.map(({ value, label }) => (
            <Menu.Item
              key={value}
              data-testid={`menu-direction-${value}`}
              leftSection={<Check on={project.schedulingDirection === value} />}
              onClick={() =>
                dispatch({
                  type: 'project.setDirection',
                  label: 'commands.project.setDirection',
                  payload: { direction: value },
                })
              }
            >
              {label}
            </Menu.Item>
          ))}
        </Menu.Sub.Dropdown>
      </Menu.Sub>

      <Menu.Divider />

      <Menu.Item
        data-testid="menu-save-baseline"
        onClick={() => {
          // 快照源是引擎（projectCommands 里 solve(draft)）—— 这里只给名字，
          // 名字按当前语言给（领域层不产出自然语言），与 Inspector 的基线按钮同源。
          breakCoalescing()
          dispatch({
            type: 'project.setBaseline',
            label: 'commands.project.setBaseline',
            payload: { name: t('inspector.baseline.name', { n: baselines.length + 1 }) },
          })
        }}
      >
        {t('commands.project.setBaseline')}
      </Menu.Item>

      <Menu.Item
        data-testid="menu-delete-baseline"
        disabled={deleteBaselineDisabled}
        rightSection={itemHint({
          disabled: deleteBaselineDisabled,
          reason: t('menu.reason.noBaseline'),
        })}
        onClick={() =>
          activeBaseline &&
          dispatch({
            type: 'project.deleteBaseline',
            label: 'commands.project.deleteBaseline',
            payload: { baselineId: activeBaseline.id },
          })
        }
      >
        {t('menu.deleteBaseline')}
      </Menu.Item>
    </>
  )
}

/* ── 资源 ─────────────────────────────────────────────── */
function ResourceItems() {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.project)
  const setActiveInspectorTab = useViewStore((state) => state.setActiveInspectorTab)
  const selectResource = useViewStore((state) => state.selectResource)

  if (!project) return null

  const resourceCount = Object.keys(project.resources).length

  return (
    <Menu.Item
      data-testid="menu-new-resource"
      onClick={() => {
        // 拿到新 id 的手法复用共用函数（资源面板的新建按钮也走它）—— 这条规则只一处实现
        const newId = createResourceAndGetId(`${t('resource.name')} ${resourceCount + 1}`)
        if (!newId) return
        // **点了必须看得见反应**（核心原则：点了没反应比明确禁用更糟）：
        // 切到「资源」Tab 并选中刚建的资源，否则用户点完菜单界面纹丝不动。
        setActiveInspectorTab('resource')
        selectResource(newId)
      }}
    >
      {t('commands.resource.create')}
    </Menu.Item>
  )
}

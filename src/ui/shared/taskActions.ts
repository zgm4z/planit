import type { TFunction } from 'i18next'
import type { Command } from '../../commands/types'
import type { Project, TaskId } from '../../domain/model/types'
import { canIndent, canOutdent, isLeafTask } from './outlineActions'
import { selectionFingerprint } from './selectionRange'

export type TaskActionId =
  | 'new-task' | 'new-child' | 'indent' | 'outdent'
  | 'toggle-milestone' | 'rename' | 'delete-task'

export interface TaskActionContext {
  /** 批量作用对象（与菜单栏语义一致） */
  taskIds: readonly TaskId[]
  /** 被右键/锚定的那一条；单条动作（新建子任务、重命名）用它。无选中时为 null */
  anchorId: TaskId | null
  project: Project
  dispatch: (command: Command) => void
  breakCoalescing: () => void
  /** 进入某任务的标题编辑态（「重命名」项用） */
  beginTitleEdit: (taskId: TaskId) => void
}

export interface TaskAction {
  id: TaskActionId
  /** 右键菜单用的 testid（`ctx-*`）；菜单栏按 id 映射回它原有的 testid */
  testId: string
  label: (ctx: TaskActionContext) => string
  /** 不可执行时返回**已翻译的原因**；可执行返回 null */
  disabledReason: (ctx: TaskActionContext) => string | null
  run: (ctx: TaskActionContext) => void
  dividerBefore?: boolean
}

const NO_SELECTION = 'menu.reason.noSelection'

/**
 * 任务动作的**唯一实现**：菜单栏「任务」菜单与大纲/甘特的右键菜单都渲染这张表。
 * 启用规则复用 outlineActions 里的 canIndent / canOutdent / isLeafTask ——
 * 与命令层守卫同源，不在这里另写一套。
 */
export function buildTaskActions(t: TFunction): TaskAction[] {
  /** 批量派发：逐条 dispatch，共用一个 coalesceKey ⇒ 一次 Ctrl+Z 全部恢复 */
  const batch = (ctx: TaskActionContext, type: Command['type'], labelKey: string, prefix: string) => {
    const fp = selectionFingerprint(ctx.taskIds)
    ctx.breakCoalescing()
    for (const taskId of ctx.taskIds) {
      ctx.dispatch({ type, label: labelKey, payload: { taskId }, coalesceKey: `${prefix}:${fp}` })
    }
  }

  return [
    {
      id: 'new-task',
      testId: 'ctx-new-task',
      label: () => t('toolbar.newTask'),
      disabledReason: () => null,
      run: (ctx) => {
        const payload = ctx.anchorId
          ? { name: t('toolbar.newTask'), afterId: ctx.anchorId }
          : { name: t('toolbar.newTask') }
        ctx.dispatch({ type: 'task.create', label: 'commands.task.create', payload })
      },
    },
    {
      id: 'new-child',
      testId: 'ctx-new-child',
      label: () => t('menu.newChildTask'),
      disabledReason: ({ anchorId, project }) => {
        if (!anchorId) return t(NO_SELECTION)
        const task = project.tasks[anchorId]
        if (!task) return t(NO_SELECTION)
        return task.kind === 'milestone' ? t('menu.reason.summary') : null
      },
      run: (ctx) => {
        if (!ctx.anchorId) return
        ctx.dispatch({
          type: 'task.create',
          label: 'commands.task.create',
          payload: { name: t('outline.newTaskName'), parentId: ctx.anchorId },
        })
      },
    },
    {
      id: 'indent',
      testId: 'ctx-indent',
      dividerBefore: true,
      label: () => t('toolbar.indent'),
      disabledReason: ({ taskIds, project }) => {
        if (taskIds.length === 0) return t(NO_SELECTION)
        return taskIds.every((id) => canIndent(project, id)) ? null : t('menu.reason.indent')
      },
      run: (ctx) => batch(ctx, 'task.indent', 'commands.task.indent', 'task.indent'),
    },
    {
      id: 'outdent',
      testId: 'ctx-outdent',
      label: () => t('toolbar.outdent'),
      disabledReason: ({ taskIds, project }) => {
        if (taskIds.length === 0) return t(NO_SELECTION)
        return taskIds.every((id) => canOutdent(project, id)) ? null : t('menu.reason.outdent')
      },
      run: (ctx) => batch(ctx, 'task.outdent', 'commands.task.outdent', 'task.outdent'),
    },
    {
      id: 'toggle-milestone',
      testId: 'ctx-toggle-milestone',
      dividerBefore: true,
      // 文案跟**锚点**（无锚点则取批内第一条）走 —— 与菜单栏一致。
      // 不能用「整批皆里程碑」：多选混合批里 toggleMilestone 是逐条切换，
      // 用一个整批判据会对其中一部分显示错误的文案。
      label: ({ taskIds, anchorId, project }) => {
        const probe = anchorId ?? taskIds[0] ?? null
        const isMilestone = probe !== null && project.tasks[probe]?.kind === 'milestone'
        return t(isMilestone ? 'menu.unsetMilestone' : 'menu.setMilestone')
      },
      disabledReason: ({ taskIds, project }) => {
        if (taskIds.length === 0) return t(NO_SELECTION)
        return taskIds.every((id) => isLeafTask(project, id)) ? null : t('menu.reason.summary')
      },
      run: (ctx) => batch(ctx, 'task.toggleMilestone', 'commands.task.toggleMilestone', 'task.toggleMilestone'),
    },
    {
      id: 'rename',
      testId: 'ctx-rename',
      label: () => t('menu.renameTask'),
      disabledReason: ({ anchorId }) => (anchorId ? null : t(NO_SELECTION)),
      run: (ctx) => {
        if (ctx.anchorId) ctx.beginTitleEdit(ctx.anchorId)
      },
    },
    {
      id: 'delete-task',
      testId: 'ctx-delete-task',
      dividerBefore: true,
      label: () => t('commands.task.delete'),
      disabledReason: ({ taskIds }) => (taskIds.length === 0 ? t(NO_SELECTION) : null),
      run: (ctx) => batch(ctx, 'task.delete', 'commands.task.delete', 'task.delete'),
    },
  ]
}

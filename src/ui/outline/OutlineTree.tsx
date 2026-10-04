import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { VirtualItem } from '@tanstack/react-virtual'
import type {
  BaselineComparison,
  ComputedSchedule,
  EarnedValue,
  Project,
  Task,
  TaskCosts,
  TaskId,
} from '../../domain/model/types'
import type { FlatRow } from '../shared/flattenRows'
import type { SelectionMods } from '../shared/selectionRange'
import {
  cellFlex,
  getOutlineCellValue,
  type CellValue,
  type OutlineColumn,
} from './outlineColumns'
import { EditableCell } from './EditableCell'
import { OUTLINE_CELL_EDITORS, getOutlineCellEditor, getCellDisabledReason } from './outlineCellEditors'
import { useProjectStore } from '../../store/projectStore'
import { ROW_HEIGHT } from '../shared/useSharedVirtualizer'
import { formatCost, formatDate, formatDays, formatEffort, formatPercent } from '../shared/format'
import styles from '../styles/ProjectView.module.scss'

interface OutlineTreeProps {
  project: Project
  rows: FlatRow[]
  /** 与甘特侧共享的虚拟项 —— 两侧消费同一份，行才对得齐 */
  virtualItems: VirtualItem[]
  schedules: Record<TaskId, ComputedSchedule>
  /** v0.5：引擎派生的投入与成本 —— UI 只读，不重算 */
  efforts: Record<TaskId, number>
  costs: Record<TaskId, TaskCosts>
  /** v1.0：引擎派生的挣值与基线差异 —— UI 只读，不重算 */
  earnedValues: Record<TaskId, EarnedValue>
  baselineDiffs: Record<TaskId, BaselineComparison>
  /** 要渲染的列，**调用方保证已按注册表顺序排好** */
  columns: OutlineColumn[]
  /** 多选全集（高亮判据）。传 Set 以便逐行 O(1) 判定 */
  selectedTaskIds: ReadonlySet<TaskId>
  /** 锚点 —— 集合里被聚焦的那一个（右栏 / 拖拽读它），另给一档样式 */
  selectedTaskId: TaskId | null
  onSelect: (taskId: TaskId, mods: SelectionMods) => void
  onToggleCollapse: (taskId: TaskId) => void
}

/**
 * 一行任务。**两个视图共用这一套渲染** —— 大纲视图不另写一份，
 * 否则两边的缩进、折叠、图标迟早漂移（spec §1）。
 */
export function OutlineTree({
  project,
  rows,
  virtualItems,
  schedules,
  efforts,
  costs,
  earnedValues,
  baselineDiffs,
  columns,
  selectedTaskIds,
  selectedTaskId,
  onSelect,
  onToggleCollapse,
}: OutlineTreeProps) {
  return (
    <div className={styles.virtualLayer} style={{ height: rows.length * ROW_HEIGHT }}>
      {virtualItems.map((item) => {
        const row = rows[item.index]
        if (!row) return null

        const task = project.tasks[row.taskId]
        if (!task) return null

        // 高亮判据是**全集**（多选），锚点在其上另加一档（焦点）。
        const selected = selectedTaskIds.has(row.taskId)
        const anchor = row.taskId === selectedTaskId
        const schedule = schedules[row.taskId]
        // 摘要行（有子任务）= 结构层（§2.2 §3.1）：底带横贯整行 + 名字 600 字重。
        const isSummary = row.hasChildren

        return (
          <div
            key={item.key}
            className={`${styles.outlineRow} ${isSummary ? styles.outlineRowSummary : ''} ${
              selected ? styles.outlineRowSelected : ''
            } ${anchor ? styles.outlineRowAnchor : ''}`}
            style={{ transform: `translateY(${item.start}px)`, height: item.size }}
            onClick={(event) =>
              onSelect(row.taskId, {
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                shiftKey: event.shiftKey,
              })
            }
            data-selected={selected || undefined}
            data-anchor={anchor || undefined}
            data-testid={`outline-row-${row.taskId}`}
          >
            {columns.map((column) => {
              const value = getOutlineCellValue(column.key, {
                task,
                schedule,
                project,
                efforts,
                costs,
                earnedValues,
                baselineDiffs,
              })
              const editorSpec = getOutlineCellEditor(column.key)
              // 空备注渲染弱化 `—`（§6「空单元格不是空白」）；其余列由 CellText 决定呈现。
              const display =
                column.key === 'note' && task.note === '' ? <EmptyDash /> : <CellText value={value} />

              return (
                <div
                  key={column.key}
                  className={`${styles.outlineCell} ${
                    column.key === 'title' ? styles.outlineCellTitle : ''
                  } ${column.key === 'id' ? styles.outlineCellMono : ''}`}
                  style={{ flex: cellFlex(column) }}
                  data-testid={`outline-cell-${column.key}-${row.taskId}`}
                >
                  {column.key === 'title' ? (
                    <TitleCell row={row} task={task} onToggleCollapse={onToggleCollapse} />
                  ) : column.key === 'kind' ? (
                    <KindCell task={task} />
                  ) : editorSpec && editorSpec.canEdit(task, schedule) ? (
                    // key={task.id} 是**为正确性**加的（行容器用行下标作 key，行位移会复用实例；
                    // 不重挂载会「用新任务的 id 提交旧任务的文字」——见下方原 NoteCell 的注释）。
                    <EditableCell
                      key={task.id}
                      columnKey={column.key}
                      spec={editorSpec}
                      task={task}
                      schedule={schedule}
                      displayTestId={
                        column.key === 'note'
                          ? `outline-note-${task.id}`
                          : `outline-edit-${column.key}-${task.id}`
                      }
                      inputTestId={
                        column.key === 'note'
                          ? `outline-note-input-${task.id}`
                          : `outline-edit-input-${column.key}-${task.id}`
                      }
                    >
                      {display}
                    </EditableCell>
                  ) : (
                    <ReadonlyCell
                      reasonKey={editorSpec ? getCellDisabledReason(column.key, task, schedule) : undefined}
                    >
                      {display}
                    </ReadonlyCell>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/**
 * title 的编辑器规格。`task.rename` 的**唯一构造处**就是规格表的 `OUTLINE_CELL_EDITORS.title`
 * （`seed` / `toCommand`）—— TitleCell 只消费它、绝不在渲染层另写一份命令。两份实现
 * 漂移不会被任何测试发现，正是本仓最忌的「两份真相」。
 */
const TITLE_SPEC = OUTLINE_CELL_EDITORS.title!

/** 标题单元格：缩进 + 折叠箭头 + 名称。**摘要任务名加粗**。
 *
 * title 是内联编辑的**唯一例外**：双击目标必须只是**名称 span**（折叠三角仍要可点），
 * 故不复用 EditableCell 的渲染结构（它把整个单元格当双击目标），但**复用其规格表**的
 * `seed` / `toCommand` —— 命令构造仍只有一处。
 */
function TitleCell({
  row,
  task,
  onToggleCollapse,
}: {
  row: FlatRow
  task: Task
  onToggleCollapse: (taskId: TaskId) => void
}) {
  const { t } = useTranslation()
  const dispatch = useProjectStore((state) => state.dispatch)
  const breakCoalescing = useProjectStore((state) => state.breakCoalescing)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => TITLE_SPEC.seed(task, undefined))

  const commit = () => {
    setEditing(false)
    const command = TITLE_SPEC.toCommand(task, undefined, draft)
    if (command) dispatch(command)
  }

  return (
    <span className={styles.outlineRowInner} style={{ paddingLeft: row.depth * 16 }}>
      {row.hasChildren ? (
        <button
          type="button"
          className={styles.outlineToggle}
          aria-label={t(row.collapsed ? 'outline.expand' : 'outline.collapse')}
          onClick={(event) => {
            event.stopPropagation()
            onToggleCollapse(row.taskId)
          }}
        >
          {row.collapsed ? '▸' : '▾'}
        </button>
      ) : (
        // 占位保持各行的名称左缘对齐（与折叠按钮同宽）
        <span className={styles.outlineToggle} aria-hidden />
      )}

      {editing ? (
        <input
          className={styles.outlineEditInput}
          value={draft}
          autoFocus
          data-testid={`outline-title-input-${task.id}`}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
            if (event.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <span
          className={`${styles.outlineName} ${row.hasChildren ? styles.outlineNameSummary : ''}`}
          data-testid={`outline-title-${task.id}`}
          onDoubleClick={(event) => {
            event.stopPropagation()
            breakCoalescing()
            setDraft(TITLE_SPEC.seed(task, undefined))
            setEditing(true)
          }}
        >
          {task.name}
        </span>
      )}
    </span>
  )
}

/**
 * 类型单元格：一个类型图标。字形**不在这里另存一份** —— 走 `outlineColumns` 的
 * 取值口径（`getOutlineCellValue('kind', …)`），它是 kind 列字形的唯一权威来源。
 * 两份表曾经并存且互不一致（这里 `▤`、那里 `▾`），没有任何测试看得见。
 *
 * 里程碑套 `milestoneGlyph` 找回强调色与字号（Task 3 把图标挪进 kind 列时丢了
 * 那个 class，样式表里一度成为死 CSS）。
 */
function KindCell({ task }: { task: Task }) {
  const glyph = getOutlineCellValue('kind', { task, schedule: undefined })

  return (
    <span className={task.kind === 'milestone' ? styles.milestoneGlyph : undefined}>
      {glyph.type === 'text' ? glyph.text : null}
    </span>
  )
}

/**
 * 只读单元格外壳：天生只读列（无 reasonKey）直接渲染子节点；守卫不通过的可编列
 * （有 reasonKey）套一层带原生 `title` 的 span —— 双击无反应时告诉用户原因（轻量
 * tooltip，不用 Mantine Tooltip）。
 */
function ReadonlyCell({ reasonKey, children }: { reasonKey?: string; children: ReactNode }) {
  const { t } = useTranslation()
  if (!reasonKey) return <>{children}</>
  return (
    <span className={styles.outlineEditText} title={t(reasonKey)}>
      {children}
    </span>
  )
}

/**
 * 空值 / 算不出来的统一字形：**弱化的 `—`**（§3.3、§6「空单元格不是空白」）。
 *
 * 用真实文本节点而不是 CSS `::after` 内容 —— e2e 的 `toHaveText('—')` 看得见文本节点，
 * 看不见伪元素。颜色弱化到 `--text-faint`，与「真的是 0」的 `--text` 在灰度上可分。
 */
function EmptyDash() {
  return <span className={styles.outlineCellEmpty}>—</span>
}

/**
 * 把结构化取值翻成当前语言的文案 —— 单位（天 / 人日 / %）只在这里出现。
 *
 * **数字与日期一律先过 `/src/ui/format.ts`**（§1.3 的唯一格式化实现），本组件内
 * 不再出现 toFixed / 原始浮点。`formatX` 返回 `null` 表示「算不出来」→ 渲染弱化 `—`；
 * 返回 `'0'` 表示**真的是 0** → 照常显示（§3.3 的三种「空」因此视觉可分）。
 *
 * 为什么单位仍在这里拼 i18n：`format.ts` 刻意不依赖 i18n，它只给**数字部分**
 * （`'1,234'` / `'0.9'` / `'3'`），量纲词（「天」「人日」「%」）按语言走 ——
 * 这样 format 的单测不必初始化语言。
 */
function CellText({ value }: { value: CellValue }) {
  const { t } = useTranslation()

  switch (value.type) {
    case 'text':
      return <>{value.text}</>
    case 'date': {
      const formatted = formatDate(value.value)
      return formatted === null ? <EmptyDash /> : <>{formatted}</>
    }
    case 'days': {
      const formatted = formatDays(value.count)
      return formatted === null ? (
        <EmptyDash />
      ) : (
        <>{t('outline.cell.days', { count: formatted })}</>
      )
    }
    case 'percent': {
      const formatted = formatPercent(value.value)
      return formatted === null ? (
        <EmptyDash />
      ) : (
        <>{t('outline.cell.percent', { value: formatted })}</>
      )
    }
    case 'effort': {
      const formatted = formatEffort(value.count)
      return formatted === null ? (
        <EmptyDash />
      ) : (
        <>{t('outline.cell.effort', { count: formatted })}</>
      )
    }
    case 'cost': {
      const formatted = formatCost(value.amount)
      return formatted === null ? (
        <EmptyDash />
      ) : (
        <>{t('outline.cell.cost', { amount: formatted })}</>
      )
    }
    // 取值层的 EMPTY 涵盖 §3.3 的「无此概念」（摘要行的工期）与「算不出来」
    // （缺基准日的 PV）—— 两者对用户都是「这一格没有数字」，统一给弱化 `—`（§6）。
    case 'empty':
      return <EmptyDash />
  }
}

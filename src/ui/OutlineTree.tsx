import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VirtualItem } from '@tanstack/react-virtual'
import type { ComputedSchedule, Project, Task, TaskId } from '../domain/model/types'
import type { FlatRow } from './flattenRows'
import {
  cellFlex,
  getOutlineCellValue,
  type CellValue,
  type OutlineColumn,
} from './outlineColumns'
import { useProjectStore } from '../store/projectStore'
import { ROW_HEIGHT } from './useSharedVirtualizer'
import styles from './styles/ProjectView.module.scss'

interface OutlineTreeProps {
  project: Project
  rows: FlatRow[]
  /** 与甘特侧共享的虚拟项 —— 两侧消费同一份，行才对得齐 */
  virtualItems: VirtualItem[]
  schedules: Record<TaskId, ComputedSchedule>
  /** 要渲染的列，**调用方保证已按注册表顺序排好** */
  columns: OutlineColumn[]
  selectedTaskId: TaskId | null
  onSelect: (taskId: TaskId) => void
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
  columns,
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

        const selected = row.taskId === selectedTaskId
        const schedule = schedules[row.taskId]

        return (
          <div
            key={item.key}
            className={`${styles.outlineRow} ${selected ? styles.outlineRowSelected : ''}`}
            style={{ transform: `translateY(${item.start}px)`, height: item.size }}
            onClick={() => onSelect(row.taskId)}
            data-testid={`outline-row-${row.taskId}`}
          >
            {columns.map((column) => (
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
                ) : column.key === 'note' ? (
                  // key 是**为正确性**加的，不是为性能：外层行容器用 `key={item.key}`
                  // （= 行**下标**），rows 位移（折叠/展开、增删/移动、撤销等不经 blur
                  // 的变化）时 React 会复用该下标处的组件实例。若此时正处在编辑态，
                  // 复用会让 `editing` 仍为 true、`draft` 仍是**旧任务**的文字，
                  // 而 `task` prop 已是新任务 —— 失焦就会用新任务的 id 提交旧任务的文字
                  // （真实的写错数据路径）。挂 `key={task.id}` 让底层任务切换时强制重挂载，
                  // 从而重置 draft / editing。
                  <NoteCell key={task.id} task={task} />
                ) : (
                  <CellText value={getOutlineCellValue(column.key, { task, schedule, project })} />
                )}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

/** 标题单元格：缩进 + 折叠箭头 + 名称。**摘要任务名加粗** */
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

      <span className={`${styles.outlineName} ${row.hasChildren ? styles.outlineNameSummary : ''}`}>
        {task.name}
      </span>
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
 * 备注单元格：双击进编辑态，Enter / 失焦提交，Escape 放弃（spec §4.2 的「可编辑」）。
 * 提交带 `coalesceKey`（**含任务 id**）—— 否则「改 A 的备注 → 改 B 的备注」会并进
 * 同一条撤销记录，一次 Ctrl+Z 连 A 一起退回（见 taskCommands.ts 的约定注释）。
 */
function NoteCell({ task }: { task: Task }) {
  const dispatch = useProjectStore((state) => state.dispatch)
  const breakCoalescing = useProjectStore((state) => state.breakCoalescing)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.note)

  const commit = () => {
    setEditing(false)
    if (draft === task.note) return
    dispatch({
      type: 'task.setNote',
      label: 'commands.task.setNote',
      payload: { taskId: task.id, note: draft },
      coalesceKey: `task.setNote:${task.id}`,
    })
  }

  if (!editing) {
    return (
      <span
        className={styles.outlineNoteText}
        onDoubleClick={(event) => {
          event.stopPropagation()
          // 打断合并：一次新编辑 = 一条新的撤销记录。否则「选 A → 改备注① → 失焦 →
          // 再双击 A 改备注② → 失焦」两次 dispatch 的 coalesceKey 相同、中间又没有
          // 其它命令，会被 mergeIntoStack 并成一条 —— 一次 Ctrl+Z 把①②一起退回。
          // 打断必须**在进入编辑态时**做：等到 commit 之后，合并早已发生，
          // 屏障只能管下一条命令（见 projectStore 的 coalesceBarrier 注释）。
          breakCoalescing()
          setDraft(task.note)
          setEditing(true)
        }}
        data-testid={`outline-note-${task.id}`}
      >
        {task.note}
      </span>
    )
  }

  return (
    <input
      className={styles.outlineNoteInput}
      value={draft}
      autoFocus
      data-testid={`outline-note-input-${task.id}`}
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
  )
}

/** 把结构化取值翻成当前语言的文案 —— 单数单位（天 / %）只在这里出现 */
function CellText({ value }: { value: CellValue }) {
  const { t } = useTranslation()

  switch (value.type) {
    case 'days':
      return <>{t('outline.cell.days', { count: value.count })}</>
    case 'percent':
      return <>{t('outline.cell.percent', { value: value.value })}</>
    case 'text':
      return <>{value.text}</>
    case 'empty':
      return null
  }
}

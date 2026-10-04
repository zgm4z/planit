import { useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { NumberInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'

import type { ComputedSchedule, Task } from '../../domain/model/types'
import type { OutlineColumnKey } from '../../store/columnKeys'
import { useProjectStore } from '../../store/projectStore'
import type { OutlineCellEditorSpec } from './outlineCellEditors'
import styles from '../styles/ProjectView.module.scss'

interface EditableCellProps {
  columnKey: OutlineColumnKey
  spec: OutlineCellEditorSpec
  task: Task
  /** 未选中 / 未算出排期时为 undefined（日期列此时不会被渲染成编辑器 —— canEdit 已挡） */
  schedule: ComputedSchedule | undefined
  /** 显示态 span 的 testid（note 沿用历史 `outline-note-<id>`，其余走 `outline-edit-<key>-<id>`） */
  displayTestId: string
  /** 编辑态输入的 testid */
  inputTestId: string
  /** 显示态内容（调用方传入呈现，本组件只管生命周期与输入控件） */
  children: ReactNode
}

/**
 * 通用可编辑单元格外壳（从既有 NoteCell 抽出）。
 *
 * 生命周期：双击显示态 → `breakCoalescing()` + 重置草稿 → 进编辑态；`Enter` / blur 提交；
 * `Escape` 取消（不派发、不改 store）；编辑态内的交互 `stopPropagation`（避免触发整行
 * `onSelect`）。**`key={task.id}` 由调用方挂**（行容器用行下标作 key，行位移时会复用实例，
 * 不按 task.id 重挂载会「用新任务的 id 提交旧任务的文字」—— 见 OutlineTree 的注释）。
 *
 * 数字非法输入（空 / 非有限数）**不提交、保留编辑态并给 `aria-invalid`**（Mantine 的
 * `error` 会带上 `aria-invalid`）；越界不在这里拦 —— 交命令层归一（唯一真相）。
 */
export function EditableCell({
  columnKey,
  spec,
  task,
  schedule,
  displayTestId,
  inputTestId,
  children,
}: EditableCellProps) {
  const { t } = useTranslation()
  const dispatch = useProjectStore((state) => state.dispatch)
  const breakCoalescing = useProjectStore((state) => state.breakCoalescing)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => spec.seed(task, schedule))
  const [invalid, setInvalid] = useState(false)

  const ariaLabel = t('outline.edit.aria', { column: t(`outline.columns.${columnKey}`) })

  const commit = () => {
    if (spec.kind === 'number') {
      const parsed = Number(draft)
      // 空 / 非有限数 = 「还没输完」→ 行内拒绝，保留编辑态（区别于「命令炸了」的全局红 Alert）
      if (draft.trim() === '' || !Number.isFinite(parsed)) {
        setInvalid(true)
        return
      }
    }
    setInvalid(false)
    setEditing(false)
    const command = spec.toCommand(task, schedule, draft)
    if (command) dispatch(command)
  }

  const stopPropagation = (event: { stopPropagation: () => void }) => event.stopPropagation()

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    }
    if (event.key === 'Escape') {
      setInvalid(false)
      setEditing(false)
    }
  }

  if (!editing) {
    return (
      <span
        className={styles.outlineEditText}
        onDoubleClick={(event) => {
          event.stopPropagation()
          // 打断合并：一次新编辑 = 一条新撤销记录。必须在**进入编辑态时**做 —— 等到
          // commit 之后合并早已发生（见 projectStore 的 coalesceBarrier 注释）。
          breakCoalescing()
          setInvalid(false)
          setDraft(spec.seed(task, schedule))
          setEditing(true)
        }}
        data-testid={displayTestId}
      >
        {children}
      </span>
    )
  }

  if (spec.kind === 'number') {
    return (
      <NumberInput
        className={styles.outlineEditNumber}
        value={draft}
        min={spec.min}
        max={spec.max}
        autoFocus
        data-testid={inputTestId}
        aria-label={ariaLabel}
        error={invalid ? t('outline.edit.invalidNumber') : undefined}
        onClick={stopPropagation}
        onChange={(raw) => {
          setInvalid(false)
          setDraft(typeof raw === 'number' ? String(raw) : raw)
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
    )
  }

  if (spec.kind === 'date') {
    return (
      <DateInput
        // '' 是「未设」哨兵，DateInput 只接受 null / YYYY-MM-DD（见 CalendarView 的注释）
        value={draft === '' ? null : draft}
        valueFormat="YYYY-MM-DD"
        autoFocus
        data-testid={inputTestId}
        aria-label={ariaLabel}
        onClick={stopPropagation}
        onChange={(value) => setDraft(value ?? '')}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
    )
  }

  return (
    <input
      className={styles.outlineEditInput}
      value={draft}
      autoFocus
      data-testid={inputTestId}
      aria-label={ariaLabel}
      onClick={stopPropagation}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  )
}

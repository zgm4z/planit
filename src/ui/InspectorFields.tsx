import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Group, NumberInput, Text, TextInput } from '@mantine/core'

import { formatDate, formatPlain, isDateInput } from './format'
import styles from './styles/Inspector.module.scss'

/**
 * §2.1 的间距阶在右栏的落点（右栏三个面板共用同一组常量 —— 各组各写一个数字
 * 就是「同一规则两份实现」的老病）。
 *   组内  6px：标签到输入框、一个字段与它自己的说明
 *   组间 16px：同一区块内的相邻字段
 *   区块间 24px：表单块 / 只读事实块 / 分组与分组
 * Mantine 的 spacing 阶里有 lg=16 / xl=24，故 16 / 24 直接用键名，只有 6 需要字面量。
 */
export const GAP_INNER = 6
export const GAP_FIELD = 'lg' as const
export const GAP_BLOCK = 'xl' as const

/**
 * 右栏共用的三种「字段形态」。放在一个文件里是因为它们服务**同一条规范约束**：
 * 把「控件」与「数据」分开表达（§3.3），并把数字与日期的呈现收敛到 format.ts
 * 这一个唯一实现（§1.3）。
 *
 *   表单控件（可编辑）  → DateField / NumberField
 *   只读事实（数据）    → StatRow / StatLine（等宽数字、右对齐，读作「规格表」）
 *   空值                → StatRow 收 `null` 时渲染弱化的 `—`
 */

/* ───────────────────────── 日期 ───────────────────────── */

interface DateFieldProps {
  label: string
  /** 已存的值，`''` 表示未设。展示前一律过 formatDate（§1.3：YYYY-MM-DD） */
  value: string
  disabled?: boolean
  testId?: string
  /** 允许清空（可选字段）。否则空输入不落盘，失焦回退到已存值 */
  clearable?: boolean
  onChange: (value: string) => void
  onBlur?: () => void
}

/**
 * 日期输入。
 *
 * **为什么不用原生 `<input type="date">`**：它的显示格式由浏览器 locale 决定，
 * zh-CN 下渲染成 `2026/09/14`，CSS 改不动它 —— 规范 §1.3 点名的缺陷正是这一条。
 * 改用文本框承载后，展示值完全由 formatDate 决定，跨语言都是 YYYY-MM-DD。
 *
 * 落盘闸门（isDateInput）：只有完整合法的 `YYYY-MM-DD` 才 dispatch。半截输入
 * （`2026-03-0`）留在草稿里不落盘 —— 否则每敲一个字符就会把中间态写进 store，
 * 撤销栈里立刻多出十几条垃圾记录。
 */
export function DateField({
  label,
  value,
  disabled,
  testId,
  clearable,
  onChange,
  onBlur,
}: DateFieldProps) {
  // 展示值一律过 formatDate（§1.3）—— 即使 store 里存着带时间的 ISO 串，
  // 输入框里也只出现 YYYY-MM-DD。draft 是**可编辑草稿**，允许出现半截输入。
  const normalized = formatDate(value) ?? ''
  const [draft, setDraft] = useState(normalized)

  // 外部值变化（切任务 / 撤销 / 换 Tab）时同步草稿；用户输入过程中 value 不变，不打断
  useEffect(() => {
    setDraft(normalized)
  }, [normalized])

  return (
    <TextInput
      label={label}
      value={draft}
      disabled={disabled}
      data-testid={testId}
      placeholder="YYYY-MM-DD"
      inputMode="numeric"
      classNames={{ input: styles.dateInput }}
      onChange={(event) => {
        const next = event.currentTarget.value
        setDraft(next)
        if (isDateInput(next)) onChange(next)
        else if (clearable && next === '') onChange('')
      }}
      onBlur={() => {
        // §6：失焦后显示格式化值 —— 非法草稿回退到已存值，不留半截日期在框里
        if (!isDateInput(draft)) setDraft(normalized)
        onBlur?.()
      }}
    />
  )
}

/* ───────────────────────── 数字 ───────────────────────── */

interface NumberFieldProps {
  label?: string
  value: number | undefined
  /** 该量纲的小数位（§1.3）。失焦后按它归一显示 —— 这是「0.8889 → 0.9」的落点 */
  digits: number
  min?: number
  max?: number
  size?: 'xs' | 'sm' | 'md'
  w?: number | string
  ariaLabel?: string
  disabled?: boolean
  /** 允许清空 → onChange(undefined)（如「效率」这种可选字段） */
  allowEmpty?: boolean
  onChange: (value: number | undefined) => void
  onBlur?: () => void
}

const display = (value: number | undefined, digits: number): string =>
  value === undefined || value === null ? '' : (formatPlain(value, digits) ?? '')

/**
 * 数字输入。在外面包一层草稿态，为的是实现 §6 的「失焦后按 §1.3 格式化显示」。
 *
 * Mantine 的 NumberInput 会把输入原样回显，用户在「进度」里敲 `33.333` 就会一直
 * 看到 `33.333`。这里在**失焦**时把显示归一成量纲位数（进度 0 位 → `33`），
 * 而**落盘的值仍是用户输入的精确数** —— 显示规整不等于篡改数据。
 *
 * 草稿只在失焦时与外部值同步：聚焦中同步会和输入打架（敲 `0.8889` 的过程中，
 * 中间值被归一成 `0.9` 会直接把后续按键吃掉）。
 */
export function NumberField({
  label,
  value,
  digits,
  min,
  max,
  size,
  w,
  ariaLabel,
  disabled,
  allowEmpty,
  onChange,
  onBlur,
}: NumberFieldProps) {
  const [draft, setDraft] = useState(() => display(value, digits))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(display(value, digits))
  }, [value, digits, focused])

  return (
    <NumberInput
      label={label}
      value={draft}
      min={min}
      max={max}
      size={size}
      w={w}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(raw) => {
        const next = typeof raw === 'number' ? String(raw) : raw
        setDraft(next)
        if (next.trim() === '') {
          if (allowEmpty) onChange(undefined)
          return
        }
        const parsed = Number(next)
        if (Number.isFinite(parsed)) onChange(parsed)
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        // 失焦即归一：把正在显示的草稿换成量纲位数（§6）
        setDraft(display(value, digits))
        onBlur?.()
      }}
    />
  )
}

/* ───────────────────── 只读事实（数据） ───────────────────── */

interface StatRowProps {
  label: ReactNode
  /** `null` = **算不出来**（§3.3）→ 显示弱化 `—`；`'0'` 是真的 0，照常显示 */
  value: string | null
  testId?: string
}

/**
 * 一行只读事实：标签在左、数值在右（等宽、右对齐）。
 *
 * 它存在的理由就是把 §3.3 说透：**绝不用「灰掉的禁用输入框」表达数据**。
 * 三个成本框曾经各占一行的禁用输入框、全是 0 —— 那是「用控件表达数据」。
 * 这里用一个不带边框的两列排版替代：读作规格表，而不是一张要填的表。
 *
 * 三种「空」在本组件里有了唯一的分界：
 *   · 无此概念 → 调用方**根本不渲染**这一行
 *   · 算不出来 → `value === null` → 弱化 `—`
 *   · 真的是 0 → `value === '0'` → 正常显示
 */
export function StatRow({ label, value, testId }: StatRowProps) {
  const empty = value === null
  return (
    <Group justify="space-between" gap={12} wrap="nowrap" align="baseline">
      <Text fz="xs" c="dimmed" style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Text
        fz="md"
        fw={500}
        data-testid={testId}
        className={styles.statValue}
        style={{ color: empty ? 'var(--planit-text-faint)' : undefined }}
      >
        {empty ? '—' : value}
      </Text>
    </Group>
  )
}

/**
 * 一段只读事实（若干 StatRow 用极淡的分隔线串起来）。
 * 与上方「表单控件块」形成对照 —— 这正是扫描锚点：方块 = 能改，平排 = 事实。
 */
export function StatList({ children }: { children: ReactNode }) {
  return <div className={styles.statList}>{children}</div>
}

import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { NumberInput, Text, TextInput } from '@mantine/core'

import { formatDate, formatPlain, isDateInput } from '../shared/format'
import styles from '../styles/Inspector.module.scss'

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
 *   空值                → StatRow 收 `null` 时渲染弱化的 `—` 或说明性文字
 *
 * **它们共用同一套栅格（FieldRow）**：标签固定在左列 88px、值填满右列 —— 于是
 * 「方块 = 能改、纯文字 = 事实」落在同一列上，一眼可分（§3.4 的最后一条）。
 */

/* ───────────────────── 属性行（标签左 / 值右，§3.4）───────────────────── */

/**
 * 属性行：标签左 / 值右。这是属性检查器的标准形态（macOS 检查器、VS Code 设置、
 * OmniPlan 自己的右栏都是如此），扫描效率远高于「标签在上、控件在下」的堆叠 ——
 * 后者每个字段占两行，一屏放不下几个，且标签与值的从属关系靠垂直距离表达，本就弱。
 *
 * **controlId 是 label↔控件关联的唯一入口**：给了就渲染真正的 `<label htmlFor>`，
 * 于是 `getByLabelText` / `getByRole(..., { name })` / 屏幕阅读器都照常工作。
 * 这**不能**用一个纯文本标签替代 —— 那会把可访问名悄悄丢掉（单测与 a11y 都会红）。
 * 只读事实行没有控件，render 成 `<span>`（label 无处可指）。
 *
 * align：'end' = 只读事实**右对齐**（数字成列可比）；'start' = 可编辑控件填满值列。
 */
export function FieldRow({
  label,
  controlId,
  align = 'start',
  children,
}: {
  label: ReactNode
  /** 关联控件用的 id（与控件自身的 id 相同）。给了才是「可编辑行」 */
  controlId?: string
  /** 'end' = 只读事实右对齐；'start' = 可编辑控件填满值列 */
  align?: 'start' | 'end'
  children: ReactNode
}) {
  return (
    <div className={styles.fieldRow}>
      {controlId ? (
        <label className={styles.fieldLabel} htmlFor={controlId}>
          {label}
        </label>
      ) : (
        <span className={styles.fieldLabel}>{label}</span>
      )}
      <div
        className={align === 'end' ? `${styles.fieldValue} ${styles.fieldValueEnd}` : styles.fieldValue}
      >
        {children}
      </div>
    </div>
  )
}

/* ───────────────────────── 日期 ───────────────────────── */

interface DateFieldProps {
  label?: string
  /**
   * 只给可访问名、不渲染可见标签。用于**标签已经由区块标题给出**的场合
   * （如右栏底部的日历块，「例外日期」已是区块标题）—— 否则同一段文字会在
   * 页面上出现两次（标题 + 字段标签），既重复又让按文案定位的断言命中两个元素。
   */
  ariaLabel?: string
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
  ariaLabel,
  value,
  disabled,
  testId,
  clearable,
  onChange,
  onBlur,
}: DateFieldProps) {
  const id = useId()
  // 展示值一律过 formatDate（§1.3）—— 即使 store 里存着带时间的 ISO 串，
  // 输入框里也只出现 YYYY-MM-DD。draft 是**可编辑草稿**，允许出现半截输入。
  const normalized = formatDate(value) ?? ''
  const [draft, setDraft] = useState(normalized)

  // 外部值变化（切任务 / 撤销 / 换 Tab）时同步草稿；用户输入过程中 value 不变，不打断
  useEffect(() => {
    setDraft(normalized)
  }, [normalized])

  const input = (
    <TextInput
      id={id}
      // ariaLabel 用于「标签已由区块标题给出」的场合：只给可访问名、不渲染可见标签，
      // 避免同一段文字在页面上出现两次（标题 + 字段标签）。
      aria-label={ariaLabel}
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

  // 无可见标签（标签由区块标题给出，只有 ariaLabel）时不套属性行 —— 控件直接铺满
  // 调用处给的容器（日历块的「例外日期」与内联的相关性行都靠这个保持原布局）。
  if (!label) return input
  return (
    <FieldRow label={label} controlId={id}>
      {input}
    </FieldRow>
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
  const id = useId()
  const [draft, setDraft] = useState(() => display(value, digits))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(display(value, digits))
  }, [value, digits, focused])

  const input = (
    <NumberInput
      id={id}
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

  // 与 DateField 同理：无可见标签（相关性行的内联 lag 输入）时不套属性行，
  // 保留调用处给的固定宽度（w）与内联布局。
  if (!label) return input
  return (
    <FieldRow label={label} controlId={id}>
      {input}
    </FieldRow>
  )
}

/* ───────────────────── 只读事实（数据） ───────────────────── */

interface StatRowProps {
  label: ReactNode
  /** `null` = **无值**（§3.3）→ 由 `unset` 决定呈现。`'0'` 是真的 0，照常显示 */
  value: string | null
  /**
   * 「未配置」时的说明性文字（§3.3 的中间一类）：它能**说出原因**、告诉用户去哪里补
   * （「未设置基线」「未指定」），比一个 `—` 有用得多。不给则退回弱化的 `—`
   * （那是「算不出来」—— 只是没有值，说不出原因）。
   */
  unset?: string
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
 *   · 未配置   → `unset` 说明性文字（说出原因）/ 算不出来 → 弱化 `—`
 *   · 真的是 0 → `value === '0'` → 正常显示
 */
export function StatRow({ label, value, unset, testId }: StatRowProps) {
  const empty = value === null
  return (
    <FieldRow label={label} align="end">
      <Text
        fz="md"
        fw={500}
        data-testid={testId}
        className={styles.statValue}
        style={{ color: empty ? 'var(--planit-text-faint)' : undefined }}
      >
        {empty ? (unset ?? '—') : value}
      </Text>
    </FieldRow>
  )
}

/**
 * 一段只读事实（若干 StatRow 用极淡的分隔线串起来）。
 * 与上方「表单控件块」形成对照 —— 这正是扫描锚点：方块 = 能改，平排 = 事实。
 */
export function StatList({ children }: { children: ReactNode }) {
  return <div className={styles.statList}>{children}</div>
}

/* ───────────────────── 区块（信息架构） ───────────────────── */

/**
 * 区块 = 一条区块标题 + 内容。标题与任务面板的 `Accordion.Control` **共用同一个
 * `section-heading` mixin**（见 _tokens.scss），所以两处体例逐字一致（lg / 600 /
 * 一条下沿）；差别只在**这一版不可折叠**。
 *
 * 为什么资源面板不折叠：它总共就三个数据分组（基本信息 / 可用性 / 成本）+ 分配，
 * 加起来的字段比任务面板**单个**分组（如相关性）还少。折叠在这里只多一次点击、
 * 并把整屏的信息架构藏进标题里 —— 用标题的排版层次（字号 / 字重 / 下沿 + 24px
 * 区块间距）已经足够分块，无需交互层次。任务面板用 Accordion 是因为它有 7 组、
 * 其中相关性 / 分配动辄长过一屏；那是「必须收」的场景，这里不是。
 */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionHeading}>{title}</h3>
      {children}
    </section>
  )
}

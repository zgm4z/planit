/**
 * Inspector 任务面板的 7 个分组。**纯数据** —— 不依赖 React / i18n 实例，
 * 因此单测不需要初始化语言。
 *
 * 数组顺序即渲染顺序（Accordion 项的顺序、以及「哪些组默认展开」都读它）。
 *
 * 「分批原则」（ROADMAP「通用约定」）：每个分组三选一 —— 可用 / 显示但禁用 + 注明版本 /
 * 不出现。后三组依赖未实现的功能，属第二类：**渲染出来但整组禁用**，并给出
 * `reasonKey`，让用户看出「这里以后会有东西」（spec §3.3 / §3.5 / §3.6 / §3.7）。
 */
export type InspectorGroupKey =
  | 'info'
  | 'schedule'
  | 'baseline'
  | 'relations'
  | 'assignments'
  | 'allocation'
  | 'expectedEffort'

export interface InspectorGroup {
  key: InspectorGroupKey
  /** 分组标题的 i18n key */
  labelKey: string
  /** 占位组：数据来源存在，但依赖未实现的功能 —— 整组禁用 + 注明版本 */
  placeholder?: boolean
  /** 占位原因文案的 i18n key（仅占位组有） */
  reasonKey?: string
}

export const INSPECTOR_GROUPS: readonly InspectorGroup[] = [
  { key: 'info', labelKey: 'inspector.groups.info' },
  { key: 'schedule', labelKey: 'inspector.groups.schedule' },
  {
    key: 'baseline',
    labelKey: 'inspector.groups.baseline',
    placeholder: true,
    reasonKey: 'inspector.placeholder.baselineHint',
  },
  { key: 'relations', labelKey: 'inspector.groups.relations' },
  { key: 'assignments', labelKey: 'inspector.groups.assignments' },
  {
    key: 'allocation',
    labelKey: 'inspector.groups.allocation',
    placeholder: true,
    reasonKey: 'inspector.placeholder.allocationHint',
  },
  {
    key: 'expectedEffort',
    labelKey: 'inspector.groups.expectedEffort',
    placeholder: true,
    reasonKey: 'inspector.placeholder.expectedEffortHint',
  },
]

/**
 * 默认展开的分组 = 本版真正能改的四组（spec §5）。
 * **展开状态不持久化** —— 它是面板的临时状态，与 `viewStore.collapsedIds`
 * （那是项目数据的视图）不同。
 */
export const DEFAULT_OPEN_GROUPS: InspectorGroupKey[] = [
  'info',
  'schedule',
  'relations',
  'assignments',
]

const GROUP_KEYS: ReadonlySet<string> = new Set(INSPECTOR_GROUPS.map((group) => group.key))

/** 运行时校验：这个字符串是一个已知的分组 key 吗 */
export function isInspectorGroupKey(value: unknown): value is InspectorGroupKey {
  return typeof value === 'string' && GROUP_KEYS.has(value)
}

import { useTranslation } from 'react-i18next'
import { Menu, Tooltip } from '@mantine/core'
import { IconCheck } from '@tabler/icons-react'
import type { VirtualItem } from '@tanstack/react-virtual'
import type {
  BaselineComparison,
  ComputedSchedule,
  EarnedValue,
  Project,
  TaskCosts,
  TaskId,
} from '../../domain/model/types'
import type { FlatRow } from '../shared/flattenRows'
import { cellFlex, OUTLINE_COLUMNS, type OutlineColumn } from './outlineColumns'
import { useViewStore } from '../../store/viewStore'
import { OutlineTree } from './OutlineTree'
import { useColumnResize } from './useColumnResize'
import styles from '../styles/ProjectView.module.scss'

interface OutlineTableProps {
  project: Project
  rows: FlatRow[]
  virtualItems: VirtualItem[]
  schedules: Record<TaskId, ComputedSchedule>
  /** v0.5：引擎派生的投入与成本 —— UI 只读，不重算 */
  efforts: Record<TaskId, number>
  costs: Record<TaskId, TaskCosts>
  /** v1.0：引擎派生的挣值与基线差异 —— UI 只读，不重算 */
  earnedValues: Record<TaskId, EarnedValue>
  baselineDiffs: Record<TaskId, BaselineComparison>
  /** 已按注册表顺序排好的可见列 */
  columns: OutlineColumn[]
  selectedTaskId: TaskId | null
  onSelect: (taskId: TaskId) => void
  onToggleCollapse: (taskId: TaskId) => void
}

/**
 * 大纲视图的全宽表格：sticky 表头 + 共用的行渲染（OutlineTree）。
 *
 * 表格容器 `width: max-content; min-width: 100%`（见 SCSS）—— 列的总宽超出视口时
 * 由外层滚动容器横向滚动，此时 `title` 列（表头与单元格）`position: sticky; left: 0`
 * 钉在左缘（spec §4.4）。
 */
export function OutlineTable({
  project,
  rows,
  virtualItems,
  schedules,
  efforts,
  costs,
  earnedValues,
  baselineDiffs,
  columns,
  selectedTaskId,
  onSelect,
  onToggleCollapse,
}: OutlineTableProps) {
  const { t } = useTranslation()
  const visibleColumns = useViewStore((state) => state.visibleColumns)
  const toggleColumn = useViewStore((state) => state.toggleColumn)
  const setColumnWidth = useViewStore((state) => state.setColumnWidth)
  const resetColumnWidth = useViewStore((state) => state.resetColumnWidth)
  const { begin, reset } = useColumnResize({
    onResize: setColumnWidth,
    onReset: resetColumnWidth,
  })

  return (
    <div className={styles.outlineTable} data-testid="outline-table">
      {/* 表头菜单只由右键打开（Menu.ContextMenu），左键不触发。 */}
      <Menu closeOnItemClick={false} withinPortal data-testid="column-menu-root">
        {/* 右键表头任意处即打开菜单（Menu.ContextMenu 按光标定位）。
            必须是单个接受 ref 的元素 —— 因此包住整个表头，而不是逐个单元格包。 */}
        <Menu.ContextMenu>
          <div className={styles.outlineHeader} data-testid="outline-table-header">
            {columns.map((column) => (
              <div
                key={column.key}
                className={`${styles.outlineHeaderCell} ${
                  column.key === 'title' ? styles.outlineHeaderCellSticky : ''
                }`}
                style={{ flex: cellFlex(column) }}
                data-testid={`outline-col-${column.key}`}
              >
                {t(column.labelKey)}
                {/* 分隔线手柄：绝对定位在单元格**内部**右缘 —— 不能外凸，
                    .outlineHeaderCell 的 overflow: hidden 会把它裁掉。
                    testid **刻意不放在 `outline-col-` 前缀下**：那会让所有
                    `[data-testid^="outline-col-"]`（组件测试与 e2e 都有）把
                    手柄也一并数进去，凭空多出手指数量的断言。 */}
                <div
                  className={styles.columnResizer}
                  data-testid={`outline-resizer-${column.key}`}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t('outline.resizeHandle', { column: t(column.labelKey) })}
                  onPointerDown={(event) => {
                    // 起始宽必须取**渲染**宽度，不能取 column.width：title 是 flex 列，没被拖过时
                    // column.width 是 flex 基准（240），而浏览器会把它撑到剩余空间的实际宽度
                    // （默认视图实测约 620 —— 大纲区 980 = 视口 1280 − 右栏 300，减去固定列
                    // 100+100+80+80=360 后剩给 title）。用基准当起始宽会让**首次**右拖反而变窄
                    // （240+80=320，远小于实际的 620）。非 flex 列两者相等，所以统一走渲染宽度是安全的。
                    //
                    // 回落到 column.width 覆盖两种量不出宽度的情形，且都用 `||` 而非 `??`：
                    //   ① parentElement 为 null（结构意外，理论上不会）；
                    //   ② 量得的宽度为 0 —— 无布局环境（jsdom 单测的 getBoundingClientRect
                    //      恒返回 0），此时 parentElement 非 null，`??` 拦不住这个 0。
                    // 真实浏览器里表头单元格最窄也有 40px（title 为 160），渲染宽绝不为 0，
                    // 因此这个 0 回落只在无布局环境生效，不会吃掉真实宽度。
                    const rendered = event.currentTarget.parentElement?.getBoundingClientRect().width
                    begin(event, column.key, rendered || column.width)
                  }}
                  onDoubleClick={() => reset(column.key)}
                />
              </div>
            ))}
          </div>
        </Menu.ContextMenu>

        <Menu.Dropdown data-testid="column-menu">
          <Menu.Label>{t('outline.menu.title')}</Menu.Label>

          {OUTLINE_COLUMNS.map((column) => {
            const isTitle = column.key === 'title'
            // 禁用列（依赖未实现的功能）+ title（不允许取消）都点不动，
            // 但都必须**显示**：用户要能看出「这里以后会有东西」（分批原则）
            const disabled = !column.enabled || isTitle
            const reasonKey = isTitle ? 'outline.menu.titleLocked' : column.disabledReasonKey
            const item = (
              <Menu.Item
                key={column.key}
                data-testid={`column-menu-item-${column.key}`}
                disabled={disabled}
                leftSection={
                  visibleColumns.includes(column.key) ? (
                    <IconCheck size={14} />
                  ) : (
                    <span style={{ width: 14 }} />
                  )
                }
                onClick={() => toggleColumn(column.key)}
              >
                {t(column.labelKey)}
              </Menu.Item>
            )

            if (!disabled) return item

            // Tooltip 要挂在一个非禁用的宿主上 —— 禁用的 <button> 不派发鼠标事件，
            // 直接给 Menu.Item 套 Tooltip 是看不见的（悬停永远不会触发）。
            return (
              <Tooltip
                key={column.key}
                label={t(reasonKey!)}
                position="right"
                withinPortal
                openDelay={200}
              >
                <span
                  data-testid={`column-menu-disabledwrap-${column.key}`}
                  style={{ display: 'block' }}
                >
                  {item}
                </span>
              </Tooltip>
            )
          })}
        </Menu.Dropdown>
      </Menu>

      <OutlineTree
        project={project}
        rows={rows}
        virtualItems={virtualItems}
        schedules={schedules}
        efforts={efforts}
        costs={costs}
        earnedValues={earnedValues}
        baselineDiffs={baselineDiffs}
        columns={columns}
        selectedTaskId={selectedTaskId}
        onSelect={onSelect}
        onToggleCollapse={onToggleCollapse}
      />
    </div>
  )
}

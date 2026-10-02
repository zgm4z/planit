import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { VirtualItem } from '@tanstack/react-virtual'
import type { Project, ResourceId } from '../../domain/model/types'
import type { ResourceFlatRow } from '../shared/flattenResources'
import { ROW_HEIGHT } from '../shared/useSharedVirtualizer'
import {
  RESOURCE_COLUMNS,
  RESOURCE_KINDS,
  resourceCellFlex,
  resourceColumnWidthVar,
} from './resourceColumns'
import styles from '../styles/ProjectView.module.scss'

interface ResourceTreeProps {
  project: Project
  rows: ResourceFlatRow[]
  virtualItems: VirtualItem[]
  selectedResourceId: ResourceId | null
  onSelect: (resourceId: ResourceId) => void
  onToggleCollapse: (resourceId: ResourceId) => void
}

/**
 * 资源树的行渲染。**不复用 `OutlineTree`**（不同实体，见 spec §6.1），
 * 但复用 `virtualItems` / `ROW_HEIGHT` / 折叠态那套模式 —— 行与甘特侧不共享，
 * 因为资源视图里没有甘特侧。
 *
 * ## 类型列的「动态列宽」（本组件存在的唯一一处测量）
 *
 * 「类型」列渲染的是**文字**（`resource.kind_*`），三语长度差很大：中文「群组」2 字、
 * 日文「グループ」4 字、英文「Equipment」9 字。写死一个宽度必然在某个语言下把文字
 * 拦腰截断（此前 28px 是照抄任务树那个放单字符字形 ▤/◆/▪ 的列）。
 *
 * 为什么不能简单地把 `flex` 改成 `0 0 auto`（让单元格自己撑开）：**每一行都是一个
 * 独立的绝对定位 flex 容器**（见 `.outlineRow`），表头又是另一个 —— `auto` 会让每行
 * 按**自己那个标签**算宽，于是日文/英文下各行列宽不同、名字列的起始 x 每行都不一样，
 * 比截断更糟。所谓「动态」必须是**跨行共享**的宽度。
 *
 * 做法：在树根挂一个**隐藏的测量元素**，按块级排布当前语言下的全部类型标签（外加
 * 本列的标题文字，见下），读出「最宽那条」的像素宽，写成树根上的 CSS 变量
 * `--planit-resource-kind-width`。表头与**每一行**的 `kind` 单元格都读这个变量
 * （`resourceCellFlex`），因此四行共享同一个宽度、绝不逐行错位。
 *
 * 语言是**运行时**可切的，所以测量必须跟着 locale 重跑 —— 依赖里放 `i18n.resolvedLanguage`。
 * 少了它，切到英文后列宽还是中文的 42px，又会截断。
 */
export function ResourceTree({
  project,
  rows,
  virtualItems,
  selectedResourceId,
  onSelect,
  onToggleCollapse,
}: ResourceTreeProps) {
  const { t, i18n } = useTranslation()
  const treeRef = useRef<HTMLDivElement>(null)
  const kindSizerRef = useRef<HTMLDivElement>(null)

  // resolvedLanguage（而非 language）才是实际渲染用的语言
  const locale = i18n.resolvedLanguage

  // 测量元素里排布的样本：本列标题 + 全部类型标签。
  // 带上标题是为了给列宽一个**自然下限** —— 列窄到自身的表头文字都放不下时，
  // 表头会先被截断（表头字号比单元格小，故按单元格字号量标题对表头是安全的过估）。
  const kindWidthSamples = [
    t(RESOURCE_COLUMNS[0].labelKey),
    ...RESOURCE_KINDS.map((kind) => t(`resource.kind_${kind}`)),
  ]

  useLayoutEffect(() => {
    const tree = treeRef.current
    const sizer = kindSizerRef.current
    if (!tree || !sizer) return
    // 量「文字本身」的宽：getBoundingClientRect 与 box-sizing 无关（不受 padding 影响），
    // 取块级子节点里最宽的那个即「最宽标签」。padding 从计算样式读，不写死 8px。
    const widest = Math.max(
      0,
      ...Array.from(sizer.children).map((child) => child.getBoundingClientRect().width),
    )
    // jsdom 没有布局，量出来是 0 —— 保留 CSS 兜底值，且不写一个假的 0px 进去
    if (widest <= 0) return
    const sizerStyle = getComputedStyle(sizer)
    const padX =
      Number.parseFloat(sizerStyle.paddingLeft) + Number.parseFloat(sizerStyle.paddingRight)
    // 单元格的 flex-basis 是 border-box 宽度（Mantine 的全局 box-sizing: border-box），
    // 故要加上左右内边距；向上取整避免亚像素把最后一个字截掉。
    tree.style.setProperty(
      resourceColumnWidthVar(RESOURCE_COLUMNS[0]),
      `${Math.ceil(widest + padX)}px`,
    )
    // locale 变了必须重跑（标签文字变了 → 宽度变了）
  }, [locale, t])

  return (
    <div className={styles.resourceTree} data-testid="resource-tree" ref={treeRef}>
      {/*
        隐藏的宽度测量元素。绝对定位 + visibility:hidden：不占位、不绘制，
        但**保留布局**（用 display:none 就量不出宽度了）。逐个子节点块级堆叠，
        使容器宽度 = 最宽那条标签。见组件顶部注释。
      */}
      <div
        ref={kindSizerRef}
        className={`${styles.outlineCell} ${styles.kindSizer}`}
        aria-hidden="true"
        data-testid="resource-kind-width-sizer"
      >
        {kindWidthSamples.map((sample, index) => (
          // key 用下标：样本是纯文本，理论上可能重复（某语言的标题恰与某标签同字），
          // 用文本当 key 会触发 React 重复 key 警告
          <div key={index}>{sample}</div>
        ))}
      </div>

      <div className={styles.outlineHeader} data-testid="resource-tree-header">
        {RESOURCE_COLUMNS.map((column) => (
          <div
            key={column.key}
            className={styles.outlineHeaderCell}
            style={{ flex: resourceCellFlex(column) }}
            data-testid={`resource-col-${column.key}`}
          >
            {t(column.labelKey)}
          </div>
        ))}
      </div>

      <div className={styles.virtualLayer} style={{ height: rows.length * ROW_HEIGHT }}>
        {virtualItems.map((item) => {
          const row = rows[item.index]
          if (!row) return null
          const resource = project.resources[row.resourceId]
          if (!resource) return null
          const selected = row.resourceId === selectedResourceId

          return (
            <div
              key={item.key}
              className={`${styles.outlineRow} ${selected ? styles.outlineRowSelected : ''}`}
              style={{ transform: `translateY(${item.start}px)`, height: item.size }}
              onClick={() => onSelect(row.resourceId)}
              data-testid={`resource-row-${row.resourceId}`}
            >
              <div
                className={styles.outlineCell}
                style={{ flex: resourceCellFlex(RESOURCE_COLUMNS[0]) }}
                data-testid={`resource-cell-kind-${row.resourceId}`}
              >
                {t(`resource.kind_${resource.kind}`)}
              </div>
              <div
                className={`${styles.outlineCell} ${styles.outlineCellTitle}`}
                style={{ flex: resourceCellFlex(RESOURCE_COLUMNS[1]) }}
                data-testid={`resource-cell-name-${row.resourceId}`}
              >
                <span className={styles.outlineRowInner} style={{ paddingLeft: row.depth * 16 }}>
                  {row.hasChildren ? (
                    <button
                      type="button"
                      className={styles.outlineToggle}
                      aria-label={t(row.collapsed ? 'outline.expand' : 'outline.collapse')}
                      onClick={(event) => {
                        event.stopPropagation()
                        onToggleCollapse(row.resourceId)
                      }}
                    >
                      {row.collapsed ? '▸' : '▾'}
                    </button>
                  ) : (
                    <span className={styles.outlineToggle} aria-hidden />
                  )}
                  <span className={styles.outlineName}>{resource.name}</span>
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

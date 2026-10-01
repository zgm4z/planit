import { useTranslation } from 'react-i18next'
import type { VirtualItem } from '@tanstack/react-virtual'
import type { Project, ResourceId } from '../../domain/model/types'
import type { ResourceFlatRow } from '../shared/flattenResources'
import { ROW_HEIGHT } from '../shared/useSharedVirtualizer'
import { RESOURCE_COLUMNS, resourceCellFlex } from './resourceColumns'
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
 */
export function ResourceTree({
  project,
  rows,
  virtualItems,
  selectedResourceId,
  onSelect,
  onToggleCollapse,
}: ResourceTreeProps) {
  const { t } = useTranslation()

  return (
    <div className={styles.resourceTree} data-testid="resource-tree">
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

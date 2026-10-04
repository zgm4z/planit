import { useTranslation } from 'react-i18next'
import { Button } from '@mantine/core'
import type { VirtualItem } from '@tanstack/react-virtual'
import type {
  ComputedSchedule,
  LevelingResult,
  Project,
  ResourceId,
  TaskId,
} from '../../domain/model/types'
import type { ResourceFlatRow } from '../shared/flattenResources'
import type { SelectionMods } from '../shared/selectionRange'
import type { TimelineScale } from '../gantt/timeline'
import { createResourceAndGetId } from '../shared/resourceActions'
import { useViewStore } from '../../store/viewStore'
import { ResourceTree } from './ResourceTree'
import { ResourceTimeline } from './ResourceTimeline'
import styles from '../styles/ProjectView.module.scss'

interface ResourceViewProps {
  project: Project
  rows: ResourceFlatRow[]
  virtualItems: VirtualItem[]
  schedules: Record<TaskId, ComputedSchedule>
  leveling: LevelingResult
  scale: TimelineScale
  totalDays: number
  onSelectResource: (resourceId: ResourceId, mods: SelectionMods) => void
}

/**
 * 视图 B：左资源树 + 右（选中资源的）分配时间线（spec §6）。
 *
 * 选中与折叠读 `viewStore`（`selectedResourceId` / `collapsedResourceIds`）——
 * 点一个资源同时把 Inspector 切到「资源」Tab：**编辑在 Inspector，树与时间线只负责看**
 * （同一件事不会有两处可改）。
 */
export function ResourceView({
  project,
  rows,
  virtualItems,
  schedules,
  leveling,
  scale,
  totalDays,
  onSelectResource,
}: ResourceViewProps) {
  const { t } = useTranslation()
  const selectedResourceId = useViewStore((state) => state.selectedResourceId)
  const setActiveInspectorTab = useViewStore((state) => state.setActiveInspectorTab)
  // 折叠态由 ProjectView 消费（它据此算出 `rows` 传进来）—— 本组件只负责「切换」
  const toggleResourceCollapsed = useViewStore((state) => state.toggleResourceCollapsed)

  const resourceCount = Object.keys(project.resources).length
  if (resourceCount === 0) {
    return (
      <div className={styles.resourceView} data-testid="resource-view">
        <p className={styles.resourceEmpty}>{t('resourceView.empty')}</p>
        <Button
          variant="light"
          size="sm"
          onClick={() => createResourceAndGetId(`${t('resource.name')} 1`)}
        >
          {t('resource.create')}
        </Button>
      </div>
    )
  }

  // 悬空选中（指向已删除资源）回落到第一个资源 —— 与 ResourceInspector 的容错同一条规则
  const selected =
    (selectedResourceId ? project.resources[selectedResourceId] : undefined) ??
    Object.values(project.resources)[0]

  return (
    <div className={styles.resourceView} data-testid="resource-view">
      <ResourceTree
        project={project}
        rows={rows}
        virtualItems={virtualItems}
        selectedResourceId={selected.id}
        onSelect={(resourceId, mods) => {
          onSelectResource(resourceId, mods)
          setActiveInspectorTab('resource')
        }}
        onToggleCollapse={toggleResourceCollapsed}
      />
      <ResourceTimeline
        project={project}
        resourceId={selected.id}
        schedules={schedules}
        leveling={leveling}
        scale={scale}
        totalDays={totalDays}
      />
    </div>
  )
}

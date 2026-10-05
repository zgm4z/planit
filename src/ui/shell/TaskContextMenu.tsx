import { useRef, useState, type ReactNode } from 'react'
import { Menu } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '../../store/projectStore'
import { useViewStore } from '../../store/viewStore'
import { isEditableTarget } from '../shared/isEditableTarget'
import { buildTaskActions, type TaskActionContext } from './taskActions'

/** 从事件目标往上找任务 id：大纲行（`outline-row-<id>`）或甘特条（`task-bar-<id>`）。 */
function taskIdFromTarget(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement)) return null
  const el = target.closest('[data-testid^="outline-row-"], [data-testid^="task-bar-"]')
  const testId = el?.getAttribute('data-testid')
  if (!testId) return null
  return testId.replace(/^(outline-row|task-bar)-/, '')
}

/**
 * 任务右键菜单的**容器**：整个可右键区域只挂一个 Menu 实例（不是每行一个 ——
 * 虚拟滚动下每行一个 portal/floating-ui 实例会在滚动帧里反复挂载卸载）。
 *
 * 目标行在**捕获阶段**记录：`onContextMenuCapture` 先于 Mantine 自己的处理器执行，
 * 因此不依赖 Mantine 是否把 `onContextMenu` 透传给子元素。
 *
 * 结构说明：`Menu.ContextMenu` 只接受**单个**元素子节点（Mantine 的
 * `getSingleElementChild` 对兄弟节点数组直接抛错），而调用方会把多条大纲行 /
 * 多个甘特条作为兄弟节点塞进 `children`。因此这里**不额外包一层 div**，而是让
 * 承载 `className` / 捕获处理器的这层容器直接充当 `Menu.ContextMenu` 的子节点 ——
 * DOM 仍是「一层容器 + children」，不会给调用方多出影响布局的元素。
 */
export function TaskContextMenu({ className, children }: { className?: string; children: ReactNode }) {
  const { t } = useTranslation()
  const [ctx, setCtx] = useState<TaskActionContext | null>(null)
  const openedRef = useRef(false)

  const capture = (event: React.MouseEvent) => {
    // 内联编辑态里不接管：交给浏览器的文本菜单（否则和「选中文字右键复制」打架）
    if (isEditableTarget(event.target)) return
    const hit = taskIdFromTarget(event.target)
    if (!hit) {
      openedRef.current = false
      setCtx(null)
      return
    }
    const project = useProjectStore.getState().project
    if (!project) return
    const { selectedTaskIds, beginTitleEdit } = useViewStore.getState()
    // 右键**不改变选中**；命中已在选中集里 → 作用于全部选中，否则只作用于该行
    const taskIds = selectedTaskIds.includes(hit) ? selectedTaskIds : [hit]
    openedRef.current = true
    setCtx({
      taskIds,
      anchorId: hit,
      project,
      dispatch: useProjectStore.getState().dispatch,
      breakCoalescing: useProjectStore.getState().breakCoalescing,
      beginTitleEdit,
    })
  }

  return (
    <Menu
      opened={openedRef.current && ctx !== null}
      onChange={(next) => {
        if (!next) {
          openedRef.current = false
          setCtx(null)
        }
      }}
      withinPortal
    >
      <Menu.ContextMenu>
        <div className={className} onContextMenuCapture={capture}>
          {children}
        </div>
      </Menu.ContextMenu>
      <Menu.Dropdown>
        {ctx && buildTaskActions(t).map((action) => {
          const reason = action.disabledReason(ctx)
          return (
            <Menu.Item
              key={action.id}
              data-testid={action.testId}
              disabled={reason !== null}
              onClick={() => {
                if (reason === null) {
                  action.run(ctx)
                  openedRef.current = false
                  setCtx(null)
                }
              }}
            >
              {reason === null ? action.label(ctx) : `${action.label(ctx)} — ${reason}`}
            </Menu.Item>
          )
        })}
      </Menu.Dropdown>
    </Menu>
  )
}

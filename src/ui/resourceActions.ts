import type { ResourceId } from '../domain/model/types'
import { useProjectStore } from '../store/projectStore'

/**
 * 新建一个资源，并返回它的 id（拿不到则返回 null）。
 *
 * `resource.create` 的 id 由命令层 `nextId('res')` 生成，payload 不接受 id、命令也**不
 * 回传**新 id（见 resourceCommands.ts），因此在 UI 侧无法预知。这里用 dispatch 前后
 * `resources` 的 **key 差集**定位刚建的那一个：dispatch 是同步的，`getState()` 读到的
 * 已是新状态，返回值可立即使用，无需等下一次渲染。
 *
 * 抽成共用函数而不是在调用点各写一遍：菜单栏（资源 > 新建资源）与资源面板（新建按钮）
 * 两条路径都要**同一套**「怎么拿到新 id」的手法，否则这条规则会有一份第二实现 ——
 * 那正是本项目最忌讳的重复真相（将来命令层若能回传 id，只需改这一处）。
 *
 * `name` 由调用方给出（通常按当前语言拼「资源 N」）—— 领域层不产出自然语言，
 * 命名策略因此留在 UI 侧、由调用点决定。
 */
export function createResourceAndGetId(name: string): ResourceId | null {
  const before = new Set(Object.keys(useProjectStore.getState().project?.resources ?? {}))
  useProjectStore.getState().dispatch({
    type: 'resource.create',
    label: 'commands.resource.create',
    payload: { name },
  })
  const after = useProjectStore.getState().project?.resources ?? {}
  return Object.keys(after).find((id) => !before.has(id)) ?? null
}

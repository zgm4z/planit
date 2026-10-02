import type { ResourceKind } from './types'

/**
 * 资源的**全部四种类型**的运行时清单 —— 全仓唯一一份。
 *
 * `ResourceKind` 联合类型在 `domain/model/types.ts` 里定义了取值集合，但类型
 * 在运行时不存在；凡是需要**遍历**四种类型的地方（下拉可选项、列宽测量样本）
 * 都得有这个数组。以前 `views/resourceColumns.ts` 与 `inspector/ResourceInspector.tsx`
 * 各持一份字面量，靠一条测试防漂移 —— 那只是缓解，不是消除。
 *
 * 放在 `domain/model/` 是因为它被**三个层**共用：`ui/views`（列宽测量取
 * 「最宽标签」）、`ui/inspector`（类型下拉的选项）、`persist`（迁移测试断言
 * 落盘形状）。放在任一层的包里，其余两层就得反向依赖它 —— 与 `units.ts`
 * 收 `Σunits`、`kind.ts` 收 `deriveKind` 是同一个理由。
 *
 * **加/删 kind 时只改这一处**；`resourceKinds.test.ts` 会断言它与三语
 * `resource.kind_*` 的键集合相等，漏改即红。
 */
export const RESOURCE_KINDS: readonly ResourceKind[] = ['staff', 'equipment', 'material', 'group']

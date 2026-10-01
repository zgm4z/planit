import type { DateStr, ResourceCost, ResourceId, ResourceKind } from '../domain/model/types'
import { createResource } from '../domain/model/factories'
import type { CommandHandler } from './types'

export interface ResourceCreatePayload { name: string; kind?: ResourceKind }
export interface ResourceRenamePayload { resourceId: ResourceId; name: string }
export interface ResourceDeletePayload { resourceId: ResourceId }
export interface ResourceSetKindPayload { resourceId: ResourceId; kind: ResourceKind }
export interface ResourceSetEmailPayload { resourceId: ResourceId; email: string }
export interface ResourceSetAvailabilityPayload { resourceId: ResourceId; availability: number }
export interface ResourceSetEfficiencyPayload { resourceId: ResourceId; efficiency: number | undefined }
export interface ResourceSetAvailablePeriodPayload {
  resourceId: ResourceId
  availableFrom?: DateStr
  availableUntil?: DateStr
}
export interface ResourceSetCostPayload { resourceId: ResourceId; cost: ResourceCost }

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/**
 * 合并键约定（各面板按此传参，命令层不登记 —— 与 v0.2 / v0.4 同一惯例）：
 *   输入框驱动 → 传 `resource.setX:<resourceId>`
 *   点击驱动   → 不传
 * `resource.create` / `resource.delete` / `resource.setKind` 是点击驱动。
 */
export const resourceHandlers: Record<string, CommandHandler<any>> = {
  'resource.create': (draft, payload: ResourceCreatePayload) => {
    const resource = createResource({ name: payload.name, kind: payload.kind })
    draft.resources[resource.id] = resource
  },

  'resource.rename': (draft, payload: ResourceRenamePayload) => {
    const resource = draft.resources[payload.resourceId]
    if (resource) resource.name = payload.name
  },

  // 级联：删资源要删掉它的**所有** assignment（spec §5）—— 只删资源会留下
  // 指向不存在资源的孤儿分配，它们会被持久化、污染派生量，且不在 patch 里。
  'resource.delete': (draft, payload: ResourceDeletePayload) => {
    delete draft.resources[payload.resourceId]
    for (const [id, assignment] of Object.entries(draft.assignments)) {
      if (assignment.resourceId === payload.resourceId) delete draft.assignments[id]
    }
  },

  'resource.setKind': (draft, payload: ResourceSetKindPayload) => {
    const resource = draft.resources[payload.resourceId]
    if (resource) resource.kind = payload.kind
  },

  'resource.setEmail': (draft, payload: ResourceSetEmailPayload) => {
    const resource = draft.resources[payload.resourceId]
    // 空串等价于「没有邮箱」—— 存 undefined，别让 '' 在 UI 上伪装成有值
    if (resource) resource.email = payload.email || undefined
  },

  'resource.setAvailability': (draft, payload: ResourceSetAvailabilityPayload) => {
    const resource = draft.resources[payload.resourceId]
    if (resource) resource.availability = clamp01(payload.availability)
  },

  'resource.setEfficiency': (draft, payload: ResourceSetEfficiencyPayload) => {
    const resource = draft.resources[payload.resourceId]
    if (!resource) return
    resource.efficiency =
      payload.efficiency === undefined || payload.efficiency <= 0 ? undefined : payload.efficiency
  },

  // 传 undefined 即「清空该端」—— 缺省表示不受限
  'resource.setAvailablePeriod': (draft, payload: ResourceSetAvailablePeriodPayload) => {
    const resource = draft.resources[payload.resourceId]
    if (!resource) return
    resource.availableFrom = payload.availableFrom
    resource.availableUntil = payload.availableUntil
  },

  'resource.setCost': (draft, payload: ResourceSetCostPayload) => {
    const resource = draft.resources[payload.resourceId]
    if (resource) resource.cost = payload.cost
  },
}

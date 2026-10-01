import type { Project } from '../domain/model/types'
import { SCHEMA_VERSION } from '../domain/model/factories'
import { migrateV1ToV2, migrateV2ToV3, migrateV3ToV4 } from './migrate'

// 单一来源：从 domain 层重导出，避免两处版本号各自漂移
export { SCHEMA_VERSION }

export interface PersistedProject {
  schemaVersion: number
  project: Project
  updatedAt: string
}

/**
 * 历史版本 → **它的下一个版本**。每个条目只跳一跳，链式推进由
 * `parsePersistedProject` 的 while 循环驱动。
 *
 * 为什么是逐跳而不是「直达当前版本」：直达版本要求每个历史迁移函数都自己
 * 知道当前版本号（写死 `schemaVersion: SCHEMA_VERSION`），一旦 bump 就会
 * 产出「旧形状 + 新版本号」的畸形结果（见 migrations 的历史注记）。
 * 逐跳把「版本号」与「形状变换」解耦：`migrateV1ToV2` 只管出 v2，
 * `migrateV2ToV3` 只管出 v3，谁也不知道 SCHEMA_VERSION 是几。
 *
 * 形参用 `never` 是为了让各迁移函数（入参类型各不相同）都能登记进来 ——
 * 代价是这里丢了类型安全，加新条目时靠人工保证入参对得上。
 */
const MIGRATIONS: Partial<Record<number, (project: never) => unknown>> = {
  1: migrateV1ToV2,
  2: migrateV2ToV3,
  3: migrateV3ToV4,
}

/**
 * 校验并解出存档中的 Project。历史版本会按版本号**逐跳**迁移到当前版本。
 * 任何异常都抛出可读的错误 —— 绝不静默返回一个空项目，那会让用户以为数据丢了。
 */
export function parsePersistedProject(raw: unknown): Project {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('存档格式无效：不是一个对象')
  }

  const candidate = raw as Partial<PersistedProject>

  if (!candidate.project || typeof candidate.project !== 'object') {
    throw new Error('存档缺少 project 字段')
  }

  const envelopeVersion = candidate.schemaVersion
  const projectVersion = (candidate.project as Project).schemaVersion

  if (envelopeVersion === SCHEMA_VERSION && projectVersion === SCHEMA_VERSION) {
    return candidate.project as Project
  }

  // 信封与内层必须表达同一个版本；不一致说明数据被半途改过，宁可拒绝
  if (envelopeVersion === projectVersion && typeof envelopeVersion === 'number') {
    let current: unknown = candidate.project
    let version: number = envelopeVersion

    while (version < SCHEMA_VERSION) {
      const migrate = MIGRATIONS[version]
      if (!migrate) break
      current = migrate(current as never)
      version += 1
    }

    if (version === SCHEMA_VERSION) return current as Project
  }

  throw new Error(
    `存档版本不匹配（存档 v${String(envelopeVersion)} / 项目 v${String(projectVersion)}，` +
      `当前 v${SCHEMA_VERSION}），已拒绝载入以免损坏数据`,
  )
}

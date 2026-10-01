import type { Project } from '../domain/model/types'
import { SCHEMA_VERSION } from '../domain/model/factories'
import { migrateV1ToV2 } from './migrate'

// 单一来源：从 domain 层重导出，避免两处版本号各自漂移
export { SCHEMA_VERSION }

export interface PersistedProject {
  schemaVersion: number
  project: Project
  updatedAt: string
}

/**
 * 历史版本 → 迁移函数。**每个条目必须直接产出当前版本的 Project**（单跳，
 * 不是链式）—— 表里只登记历史版本，当前版本走上面的快路径、不在表里。
 *
 * 升到 v3 时别只加一条 `2: migrateV2ToV3` 就走：`MIGRATIONS[1]` 仍是
 * `migrateV1ToV2`，而它内部写死的 `schemaVersion: SCHEMA_VERSION` 会读到 3，
 * 于是产出「v2 形状 + 戳成 v3」的畸形结果。要么给每个历史版本各写一个
 * 直达当前版本的迁移函数，要么把这里改成一个逐跳驱动的循环。
 *
 * 用 `Partial<Record<…>>` 是刻意的：让「键可能不存在」被类型系统表达出来，
 * 下面 `if (migrate)` 的守卫因此不是恒真。
 * 形参用 `never` 是为了让各迁移函数（入参类型各不相同）都能登记进来 ——
 * 代价是这里丢了类型安全，加新条目时靠人工保证入参对得上。
 */
const MIGRATIONS: Partial<Record<number, (project: never) => Project>> = {
  1: migrateV1ToV2,
}

/**
 * 校验并解出存档中的 Project。v1 会被迁移到当前版本。
 * 任何异常都抛出可读的错误 —— 绝不静默返回一个空项目，
 * 那会让用户以为数据丢了。
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
  if (envelopeVersion === projectVersion) {
    const migrate = MIGRATIONS[envelopeVersion as number]
    if (migrate) return migrate(candidate.project as never)
  }

  throw new Error(
    `存档版本不匹配（存档 v${String(envelopeVersion)} / 项目 v${String(projectVersion)}，` +
      `当前 v${SCHEMA_VERSION}），已拒绝载入以免损坏数据`,
  )
}

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
 * 「存档里记录的版本」→「把它迁到当前版本的函数」。
 *
 * 只登记**需要迁移的历史版本**，当前版本（SCHEMA_VERSION）永远不在表里 ——
 * 当前版本的存档由 parsePersistedProject 的快路径原样返回，绝不该被“迁移”。
 * （原先把 `[1, SCHEMA_VERSION]` 当作可读版本清单，那让当前版本也落进迁移
 * 分支里；虽然被上面的快路径挡住、到不了，但一旦有人改快路径就会误迁。）
 * 将来升到 v3 时在这里登记 `2: migrateV2ToV3`，并把 v1→v2→v3 串成链。
 */
const MIGRATIONS: Record<number, (project: never) => Project> = {
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

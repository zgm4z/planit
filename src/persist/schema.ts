import type { Project } from '../domain/model/types'

/** 与 factories.SCHEMA_VERSION 保持一致。载入时严格比对，不匹配就拒绝 */
export const SCHEMA_VERSION = 1

export interface PersistedProject {
  schemaVersion: number
  project: Project
  updatedAt: string
}

/**
 * 校验并解出存档中的 Project。
 * 任何异常都抛出可读的错误 —— 绝不静默返回一个空项目，
 * 那会让用户以为数据丢了。
 */
export function parsePersistedProject(raw: unknown): Project {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('存档格式无效：不是一个对象')
  }

  const candidate = raw as Partial<PersistedProject>

  if (candidate.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `存档版本不匹配（存档 v${String(candidate.schemaVersion)}，当前 v${SCHEMA_VERSION}），已拒绝载入以免损坏数据`,
    )
  }

  if (!candidate.project || typeof candidate.project !== 'object') {
    throw new Error('存档缺少 project 字段')
  }

  return candidate.project
}

import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { createProject, createTask } from '../domain/model/factories'
import { deleteAllProjects, listProjects, loadProject, saveProject } from './indexeddb'
import { parsePersistedProject, SCHEMA_VERSION } from './schema'

beforeEach(async () => {
  await deleteAllProjects()
})

describe('saveProject / loadProject', () => {
  it('保存后能原样载入', async () => {
    const project = createProject('我的计划', '2026-03-02')
    const task = createTask({ name: '需求调研', duration: 3 })
    project.tasks[task.id] = task
    project.rootIds.push(task.id)

    await saveProject(project)
    const loaded = await loadProject(project.id)

    expect(loaded).not.toBeNull()
    expect(loaded!.name).toBe('我的计划')
    expect(loaded!.startDate).toBe('2026-03-02')
    expect(loaded!.tasks[task.id].duration).toBe(3)
  })

  it('载入不存在的项目返回 null', async () => {
    expect(await loadProject('不存在')).toBeNull()
  })

  it('重复保存同一项目是覆盖而非新增', async () => {
    const project = createProject('计划', '2026-03-02')
    await saveProject(project)
    await saveProject({ ...project, name: '改名后' })

    const list = await listProjects()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('改名后')
  })

  it('按更新时间倒序列出项目', async () => {
    await saveProject({ ...createProject('旧', '2026-03-02'), updatedAt: '2026-01-01T00:00:00.000Z' })
    await saveProject({ ...createProject('新', '2026-03-02'), updatedAt: '2026-06-01T00:00:00.000Z' })

    const list = await listProjects()
    expect(list.map((p) => p.name)).toEqual(['新', '旧'])
  })
})

describe('parsePersistedProject', () => {
  it('版本不匹配时拒绝载入并说明原因', () => {
    expect(() => parsePersistedProject({ schemaVersion: SCHEMA_VERSION + 1, project: {} }))
      .toThrow(/版本不匹配/)
  })

  it('缺少 project 字段时拒绝载入', () => {
    expect(() => parsePersistedProject({ schemaVersion: SCHEMA_VERSION }))
      .toThrow(/缺少 project/)
  })

  it('非对象输入被拒绝', () => {
    expect(() => parsePersistedProject(null)).toThrow(/不是一个对象/)
  })

  it('项目自带的 schemaVersion 不匹配时也拒绝载入', () => {
    const project = { ...createProject('x', '2026-03-02'), schemaVersion: 999 }
    expect(() => parsePersistedProject({ schemaVersion: SCHEMA_VERSION, project }))
      .toThrow(/版本不匹配/)
  })
})

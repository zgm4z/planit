import { describe, it, expect } from 'vitest'
import { createProject, createTask, SCHEMA_VERSION } from '../domain/model/factories'
import { parsePersistedProject } from './schema'

/** 手工构造一份 v1 存档：kind 时代之前的形状（isMilestone + 无新字段） */
function v1Save() {
  const now = '2026-03-01T00:00:00.000Z'
  return {
    schemaVersion: 1,
    updatedAt: now,
    project: {
      id: 'proj_v1',
      name: '老项目',
      schemaVersion: 1,
      startDate: '2026-03-02',
      calendarId: 'default',
      calendars: {
        default: {
          id: 'default',
          name: '标准日历',
          workingDays: [true, true, true, true, true, false, false],
          hoursPerDay: 8,
          exceptions: {},
        },
      },
      tasks: {
        // 普通任务
        t1: {
          id: 't1', name: '普通', parentId: null, childIds: [],
          isMilestone: false, duration: 3,
          scheduling: { mode: 'auto' }, progress: 0, effortMode: 'fixedDuration',
        },
        // 里程碑
        t2: {
          id: 't2', name: '里程碑', parentId: null, childIds: [],
          isMilestone: true, duration: 0,
          scheduling: { mode: 'auto' }, progress: 0, effortMode: 'fixedDuration',
        },
        // 摘要（有子任务）
        t3: {
          id: 't3', name: '阶段', parentId: null, childIds: ['t4'],
          isMilestone: false, duration: 1,
          scheduling: { mode: 'auto' }, progress: 0, effortMode: 'fixedDuration',
        },
        t4: {
          id: 't4', name: '子任务', parentId: 't3', childIds: [],
          isMilestone: false, duration: 2,
          scheduling: { mode: 'auto' }, progress: 0, effortMode: 'fixedDuration',
        },
      },
      rootIds: ['t1', 't2', 't3'],
      dependencies: {},
      resources: {},
      assignments: {},
      createdAt: now,
      updatedAt: now,
    },
  }
}

describe('parsePersistedProject — v1 → v2 迁移', () => {
  it('三种任务的 kind 都被正确推导，且 isMilestone 字段消失', () => {
    const project = parsePersistedProject(v1Save())

    expect(project.tasks.t1.kind).toBe('task')
    expect(project.tasks.t2.kind).toBe('milestone')
    expect(project.tasks.t3.kind).toBe('group')
    expect(project.tasks.t4.kind).toBe('task')

    for (const task of Object.values(project.tasks)) {
      expect(task).not.toHaveProperty('isMilestone')
    }
  })

  it('迁移后补上全部新字段的默认值', () => {
    const project = parsePersistedProject(v1Save())

    for (const task of Object.values(project.tasks)) {
      expect(task.schedulingOrder).toBe('asap')
      expect(task.note).toBe('')
      expect(task.allowSplitting).toBe(false)
      expect(task.priority).toBe(0)
      expect(task.delay).toBe(0)
    }
    expect(project.schedulingDirection).toBe('forward')
    expect(project.endDate).toBeUndefined()
  })

  it('迁移后 project.schemaVersion 更新为 2', () => {
    expect(parsePersistedProject(v1Save()).schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('迁移不丢字段：名称、工期、依赖、日历原样保留', () => {
    const project = parsePersistedProject(v1Save())
    expect(project.name).toBe('老项目')
    expect(project.tasks.t1.duration).toBe(3)
    expect(project.tasks.t3.childIds).toEqual(['t4'])
    expect(project.rootIds).toEqual(['t1', 't2', 't3'])
    expect(project.calendars.default.workingDays).toEqual([true, true, true, true, true, false, false])
  })

  it('迁移是纯函数：同一份输入跑两次结果逐字段相同', () => {
    const a = parsePersistedProject(v1Save())
    const b = parsePersistedProject(v1Save())
    expect(a).toEqual(b)
  })

  it('迁移不改动传入的原始对象', () => {
    const raw = v1Save()
    const snapshot = JSON.stringify(raw)
    parsePersistedProject(raw)
    expect(JSON.stringify(raw)).toBe(snapshot)
  })
})

describe('parsePersistedProject — v2 直接载入', () => {
  it('当前版本的存档原样返回', () => {
    const project = createProject('新项目', '2026-03-02')
    const parsed = parsePersistedProject({
      schemaVersion: SCHEMA_VERSION,
      project,
      updatedAt: new Date().toISOString(),
    })
    expect(parsed).toEqual(project)
  })

  it('v2 存档里带 kind 的任务不被改写', () => {
    const project = createProject('新项目', '2026-03-02')
    const t = createTask({ name: 'M', kind: 'milestone' })
    project.tasks[t.id] = t
    project.rootIds.push(t.id)

    const parsed = parsePersistedProject({ schemaVersion: SCHEMA_VERSION, project })
    expect(parsed.tasks[t.id].kind).toBe('milestone')
  })
})

describe('parsePersistedProject — 未知版本仍然抛错', () => {
  it('版本号既不是 1 也不是当前版本时抛错，绝不静默返回空项目', () => {
    const project = createProject('x', '2026-03-02')
    expect(() =>
      parsePersistedProject({ schemaVersion: 99, project: { ...project, schemaVersion: 99 } }),
    ).toThrow(/版本不匹配/)
  })

  it('信封与内层版本号不一致时抛错', () => {
    const project = createProject('x', '2026-03-02')
    expect(() => parsePersistedProject({ schemaVersion: 1, project })).toThrow(/版本不匹配/)
  })
})

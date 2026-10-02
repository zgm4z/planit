import { describe, it, expect } from 'vitest'
import { createProject, createTask, SCHEMA_VERSION } from '../domain/model/factories'
import { parsePersistedProject } from './schema'
import { RESOURCE_KINDS } from '../domain/model/resourceKinds'
import { migrateV2ToV3, migrateV3ToV4 } from './migrate'

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

  it('v1 里「里程碑 ∧ 有子任务」的畸形任务迁成 group，不违反不变式 2', () => {
    const raw = v1Save()
    // v0.1 的 task.create 没有「父任务不能是里程碑」的守卫，所以这个形状
    // 在旧版是可生成的。迁移必须以结构事实为准 —— 子任务优先。
    ;(raw.project.tasks.t2 as Record<string, unknown>).childIds = ['t4']
    ;(raw.project.tasks.t4 as Record<string, unknown>).parentId = 't2'

    const project = parsePersistedProject(raw)

    expect(project.tasks.t2.kind).toBe('group')
    expect(project.tasks.t2.childIds.length).toBeGreaterThan(0)
  })

  it('v1 任务意外带有 kind 时抛错，不静默覆盖', () => {
    const raw = v1Save()
    // 模拟「新形状 + 旧版本号」的中间态存档
    ;(raw.project.tasks.t1 as unknown as Record<string, unknown>).kind = 'milestone'

    expect(() => parsePersistedProject(raw)).toThrow(/kind/)
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

/** 手工构造一份 v2 存档：资源是旧形状，且含一个 cost 型资源 */
function v2Save() {
  const now = '2026-03-01T00:00:00.000Z'
  return {
    schemaVersion: 2,
    updatedAt: now,
    project: {
      id: 'proj_v2',
      name: '带资源的项目',
      schemaVersion: 2,
      startDate: '2026-03-02',
      schedulingDirection: 'forward',
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
      tasks: {},
      rootIds: [],
      dependencies: {},
      resources: {
        r1: {
          id: 'r1', name: '张三', kind: 'staff', parentId: null,
          availability: 0.5, cost: { rate: 120, per: 'hour', currency: 'CNY' },
        },
        r2: {
          id: 'r2', name: '差旅费', kind: 'cost', parentId: null,
          availability: 1, cost: { rate: 800, per: 'day', currency: 'CNY' },
        },
        r3: {
          id: 'r3', name: '打印', kind: 'material', parentId: null,
          availability: 1, cost: { rate: 5, per: 'unit', currency: 'CNY' },
        },
      },
      assignments: {},
      createdAt: now,
      updatedAt: now,
    },
  }
}

describe('parsePersistedProject — v2 → v3 迁移', () => {
  it('cost 型资源转成 material，且按 per 落到 hourly / usage', () => {
    const project = parsePersistedProject(v2Save())

    expect(project.resources.r1.kind).toBe('staff')
    expect(project.resources.r1.cost).toEqual({ hourly: 120, currency: 'CNY' })

    // cost → material（偏差 2）
    expect(project.resources.r2.kind).toBe('material')
    // per: 'day' → hourly = 800 / 8（hoursPerDay）
    expect(project.resources.r2.cost).toEqual({ hourly: 100, currency: 'CNY' })

    expect(project.resources.r3.kind).toBe('material')
    expect(project.resources.r3.cost).toEqual({ usage: 5, currency: 'CNY' })
  })

  it('迁移后的资源没有非法的 4 值之外的 kind，且丢掉旧的 cost.per / cost.rate', () => {
    const project = parsePersistedProject(v2Save())
    for (const resource of Object.values(project.resources)) {
      expect(RESOURCE_KINDS).toContain(resource.kind)
      expect(resource.cost).not.toHaveProperty('rate')
      expect(resource.cost).not.toHaveProperty('per')
    }
  })

  it('新字段缺省时不写入（email / availableFrom / availableUntil 保持 undefined）', () => {
    const project = parsePersistedProject(v2Save())
    expect(project.resources.r1.email).toBeUndefined()
    expect(project.resources.r1.availableFrom).toBeUndefined()
    expect(project.resources.r1.availableUntil).toBeUndefined()
  })

  it('v2 存档迁移后到达当前版本（v5）', () => {
    expect(parsePersistedProject(v2Save()).schemaVersion).toBe(SCHEMA_VERSION)
    expect(SCHEMA_VERSION).toBe(5)
  })

  it('v1 存档经 v2 → v3 两步迁移也能到当前版本（逐跳链式）', () => {
    const project = parsePersistedProject(v1Save())
    expect(project.schemaVersion).toBe(SCHEMA_VERSION)
    expect(project.tasks.t2.kind).toBe('milestone')
    expect(project.resources).toEqual({})
  })

  it('逐跳链真的逐跳：v1 里的资源也走完第二步变成 v3 形状（不是 v2 形状 + v3 版本号）', () => {
    const raw = v1Save()
    // 给 v1 存档塞一个 v2 形状（5 种 kind、rate/per）的资源。它必须**经第二步**
    // 被折算成 v3 形状。若把「v1→v2 的产出直接戳上 v3 版本号」而跳过第二步，
    // 这里会拿到 kind: 'cost' + cost.rate —— 这条就是为区分那种畸形结果而写的。
    ;(raw.project.resources as Record<string, unknown>).r1 = {
      id: 'r1', name: '差旅费', kind: 'cost', parentId: null,
      availability: 1, cost: { rate: 80, per: 'day', currency: 'CNY' },
    }

    const project = parsePersistedProject(raw)

    expect(project.schemaVersion).toBe(SCHEMA_VERSION)
    expect(project.tasks.t2.kind).toBe('milestone')
    expect(project.resources.r1.kind).toBe('material')
    expect(project.resources.r1.cost).toEqual({ hourly: 10, currency: 'CNY' })
  })

  it('迁移是纯函数：同一份输入跑两次结果逐字段相同且不改动入参', () => {
    const raw = v2Save()
    const snapshot = JSON.stringify(raw)
    const a = parsePersistedProject(raw)
    const b = parsePersistedProject(v2Save())
    expect(a).toEqual(b)
    expect(JSON.stringify(raw)).toBe(snapshot)
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

/** 手工构造一份 v3 存档：有资源新形状，但**没有** baselines / activeBaselineId / statusDate */
function v3Save() {
  const now = '2026-03-01T00:00:00.000Z'
  return {
    schemaVersion: 3,
    updatedAt: now,
    project: {
      id: 'proj_v3',
      name: 'v3 项目',
      schemaVersion: 3,
      startDate: '2026-03-02',
      schedulingDirection: 'forward',
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
      tasks: {},
      rootIds: [],
      dependencies: {},
      resources: {},
      assignments: {},
      createdAt: now,
      updatedAt: now,
    },
  }
}

describe('parsePersistedProject — v3 → v4 迁移', () => {
  it('补上空的 baselines 与 activeBaselineId: null', () => {
    const project = parsePersistedProject(v3Save())
    expect(project.baselines).toEqual([])
    expect(project.activeBaselineId).toBeNull()
  })

  it('statusDate 缺省时不写入（保持 undefined，不塞 ""）', () => {
    expect(parsePersistedProject(v3Save()).statusDate).toBeUndefined()
  })

  it('迁移后 project.schemaVersion 更新为当前版本（v5）', () => {
    expect(parsePersistedProject(v3Save()).schemaVersion).toBe(SCHEMA_VERSION)
    expect(SCHEMA_VERSION).toBe(5)
  })

  it('v1 / v2 存档经逐跳链也能到 v4（三跳）', () => {
    expect(parsePersistedProject(v1Save()).schemaVersion).toBe(SCHEMA_VERSION)
    expect(parsePersistedProject(v1Save()).baselines).toEqual([])
    expect(parsePersistedProject(v2Save()).schemaVersion).toBe(SCHEMA_VERSION)
    expect(parsePersistedProject(v2Save()).baselines).toEqual([])
    // v2 的资源仍要经第二步被折算（逐跳链没有把中间步吞掉）
    expect(parsePersistedProject(v2Save()).resources.r2.cost).toEqual({ hourly: 100, currency: 'CNY' })
  })

  it('migrateV2ToV3 产出的是 v3，而不是当前版本（逐跳的关键）', () => {
    // 若这里写成 SCHEMA_VERSION（=4），v2 存档会被戳成「v3 形状 + v4 版本号」。
    // 但 while 循环按**计数器**推进（不看产出的 schemaVersion），所以它碰巧仍会
    // 补跑 v3→v4、**不暴露**这个畸形 —— 也就是说 v1 / v2 的**全链路断言抓不住这一步的
    // 回归**（实测：把这里的 3 改回 SCHEMA_VERSION，链路断言全绿）。
    // **本直断言是这一处唯一的守卫，别删。**
    expect(migrateV2ToV3(v2Save().project as never).schemaVersion).toBe(3)
  })

  it('迁移是纯函数：同一份输入跑两次结果逐字段相同且不改动入参', () => {
    const raw = v3Save()
    const snapshot = JSON.stringify(raw)
    const a = parsePersistedProject(raw)
    const b = parsePersistedProject(v3Save())
    expect(a).toEqual(b)
    expect(JSON.stringify(raw)).toBe(snapshot)
  })
})

/** 手工构造一份 v4 存档：承载字段是**纯日期**（带时刻之前） */
function v4Save() {
  const now = '2026-03-01T00:00:00.000Z'
  return {
    schemaVersion: 4,
    updatedAt: now,
    project: {
      id: 'proj_v4',
      name: '带时刻之前',
      schemaVersion: 4,
      startDate: '2026-03-02',
      endDate: '2026-06-30',
      statusDate: '2026-03-04',
      schedulingDirection: 'forward',
      calendarId: 'default',
      calendars: {
        default: {
          id: 'default',
          name: '标准日历',
          workingDays: [true, true, true, true, true, false, false],
          hoursPerDay: 8,
          exceptions: {
            '2026-03-17': { kind: 'holiday' },
            '2026-04-06': { kind: 'custom', start: '2026-04-06', end: '2026-04-06' },
          },
        },
      },
      tasks: {
        t1: {
          id: 't1', name: '手动任务', parentId: null, childIds: [], kind: 'task',
          duration: 2, scheduling: { mode: 'constraint', type: 'startOn', date: '2026-03-05' },
          progress: 0, effortMode: 'fixedDuration', schedulingOrder: 'asap',
          note: '', allowSplitting: false, priority: 0, delay: 0,
        },
        t2: {
          id: 't2', name: '自动任务', parentId: null, childIds: [], kind: 'task',
          duration: 1, scheduling: { mode: 'auto' }, progress: 0, effortMode: 'fixedDuration',
          schedulingOrder: 'asap', note: '', allowSplitting: false, priority: 0, delay: 0,
        },
      },
      rootIds: ['t1', 't2'],
      dependencies: {},
      resources: {
        r1: { id: 'r1', name: '临时工', kind: 'staff', parentId: null, availability: 1,
          availableFrom: '2026-03-10', availableUntil: '2026-04-01', cost: { currency: 'CNY' } },
      },
      assignments: {},
      baselines: [
        { id: 'bl1', name: '基线 1', createdAt: now,
          entries: { t1: { name: '手动任务', start: '2026-03-05', finish: '2026-03-06' } } },
      ],
      activeBaselineId: 'bl1',
      createdAt: now,
      updatedAt: now,
    },
  }
}

describe('parsePersistedProject — v4 → v5 迁移', () => {
  it('承载时刻的字段补上默认时刻（09:00 / 18:00）', () => {
    const project = parsePersistedProject(v4Save())
    expect(project.schemaVersion).toBe(5)
    expect(project.startDate).toBe('2026-03-02T09:00')
    expect(project.endDate).toBe('2026-06-30T18:00')
    expect(project.statusDate).toBe('2026-03-04T18:00')
    expect(project.tasks.t1.scheduling).toEqual({
      mode: 'constraint', type: 'startOn', date: '2026-03-05T09:00',
    })
    expect(project.resources.r1.availableFrom).toBe('2026-03-10T09:00')
    expect(project.resources.r1.availableUntil).toBe('2026-04-01T18:00')
    expect(project.calendars.default.exceptions['2026-04-06']).toEqual({
      kind: 'custom', start: '2026-04-06T09:00', end: '2026-04-06T18:00',
    })
  })

  it('例外表的键与假日变体一字未动；auto 任务的 scheduling 保持原样', () => {
    const project = parsePersistedProject(v4Save())
    expect(Object.keys(project.calendars.default.exceptions)).toEqual(['2026-03-17', '2026-04-06'])
    expect(project.calendars.default.exceptions['2026-03-17']).toEqual({ kind: 'holiday' })
    expect(project.tasks.t2.scheduling).toEqual({ mode: 'auto' })
  })

  it('基线快照保持纯日期（不补时刻）—— 快照冻结在当时的日粒度', () => {
    const project = parsePersistedProject(v4Save())
    expect(project.baselines[0].entries.t1).toEqual({
      name: '手动任务', start: '2026-03-05', finish: '2026-03-06',
    })
  })

  it('v1 / v2 / v3 存档经逐跳链都能到 v5（四跳）', () => {
    expect(parsePersistedProject(v1Save()).schemaVersion).toBe(5)
    expect(parsePersistedProject(v2Save()).schemaVersion).toBe(5)
    expect(parsePersistedProject(v3Save()).schemaVersion).toBe(5)
  })

  it('migrateV3ToV4 产出的是 v4 字面量，而不是 SCHEMA_VERSION（偏差 6）', () => {
    expect(migrateV3ToV4(v3Save().project as never).schemaVersion).toBe(4)
  })

  it('迁移是纯函数：同一份输入跑两次结果逐字段相同且不改动入参', () => {
    const raw = v4Save()
    const snapshot = JSON.stringify(raw)
    expect(parsePersistedProject(raw)).toEqual(parsePersistedProject(v4Save()))
    expect(JSON.stringify(raw)).toBe(snapshot)
  })
})

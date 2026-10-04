import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDependency, createProject, createTask } from '../domain/model/factories'
import type { Project } from '../domain/model/types'
import { createSolveClient, type SolveWorkerLike } from '../domain/scheduler/solveClient'
import { useProjectStore } from './projectStore'
import { bindSolveMode, useScheduleStore } from './scheduleStore'

/**
 * 重算是**异步**的（求解在 worker / 单测里走同步兜底，但 store 的落地都是异步）。
 * 这里等 `computing` 落回 false 再断言 —— 不写墙钟（并行套件下会 flaky）。
 */
const settle = (): Promise<void> =>
  vi.waitFor(() => expect(useScheduleStore.getState().computing).toBe(false))

function projectWithTask(name = 'P', duration = 3): { project: Project; taskId: string } {
  const project = createProject(name, '2026-03-02')
  const task = createTask({ name: 'A', duration })
  project.tasks[task.id] = task
  project.rootIds.push(task.id)
  return { project, taskId: task.id }
}

/** A→B 且 B→A：solve() 必然抛 CycleError。 */
function cyclicProject(): Project {
  const project = createProject('环', '2026-03-02')
  const a = createTask({ name: 'A', duration: 1 })
  const b = createTask({ name: 'B', duration: 1 })
  project.tasks[a.id] = a
  project.tasks[b.id] = b
  project.rootIds.push(a.id, b.id)
  const d1 = createDependency(a.id, b.id)
  const d2 = createDependency(b.id, a.id)
  project.dependencies[d1.id] = d1
  project.dependencies[d2.id] = d2
  return project
}

beforeEach(async () => {
  useProjectStore.setState({ project: null, undoStack: [], redoStack: [], lastError: null })
  await settle()
  useScheduleStore.setState({ error: null, computing: false })
})

describe('scheduleStore：异步重算 / 保留上一次结果 / computing', () => {
  it('dispatch 返回时 computing 已同步置位，完成后写入结果', async () => {
    const { project, taskId } = projectWithTask()
    useProjectStore.setState({ project })

    // 同步置位：UI 在 dispatch 返回的当帧就能看到「在算」
    expect(useScheduleStore.getState().computing).toBe(true)

    await settle()
    expect(useScheduleStore.getState().result.schedules[taskId].scheduledStart).toBe('2026-03-02')
  })

  it('求解在途时保留上一次的好结果（不清空、不闪）', async () => {
    const first = projectWithTask('第一个')
    useProjectStore.setState({ project: first.project })
    await settle()
    const good = useScheduleStore.getState().result
    expect(Object.keys(good.schedules)).not.toHaveLength(0)

    const second = projectWithTask('第二个', 5)
    useProjectStore.setState({ project: second.project })

    // 在途：result 仍是上一次的好结果（引用都没换），computing=true
    expect(useScheduleStore.getState().result).toBe(good)
    expect(useScheduleStore.getState().computing).toBe(true)

    await settle()
    // 完成后才换上新结果
    expect(useScheduleStore.getState().result).not.toBe(good)
    expect(Object.keys(useScheduleStore.getState().result.schedules)).toHaveLength(1)
  })

  it('求解失败（成环）：保留上一次结果，错误只写 store.error（单一通道，不碰 lastError）', async () => {
    const good = projectWithTask()
    useProjectStore.setState({ project: good.project })
    await settle()
    const prev = useScheduleStore.getState().result

    useProjectStore.setState({ project: cyclicProject(), lastError: null })
    await settle()

    // **不清空**上一次的好结果 —— 界面不会因一次失败就塌成空态
    expect(useScheduleStore.getState().result).toBe(prev)
    expect(useScheduleStore.getState().computing).toBe(false)
    // 错误只走既有的一条通道：工具栏内联（scheduleStore.error）
    expect(useScheduleStore.getState().error).toMatch(/循环依赖/)
    // **不**写 projectStore.lastError —— 那条通道 undo/redo 不重置，求解错误写进去
    // 会留下一条撤掉出错编辑后仍清不掉的陈旧横条
    expect(useProjectStore.getState().lastError).toBeNull()
  })

  it('项目关闭后回到空态', async () => {
    useProjectStore.setState({ project: projectWithTask().project })
    await settle()

    useProjectStore.setState({ project: null })
    await settle()

    expect(Object.keys(useScheduleStore.getState().result.schedules)).toHaveLength(0)
    expect(useScheduleStore.getState().computing).toBe(false)
    expect(useScheduleStore.getState().error).toBeNull()
  })

  it('jsdom 无 Worker：solveMode 为 inline（单测走同步兜底）', () => {
    expect(useScheduleStore.getState().solveMode).toBe('inline')
  })

  it('solveMode 是**当前**模式而非启动快照：worker 中途失效 → 立刻反映 inline', () => {
    // 一个可被「弄挂」的假 worker
    const worker: SolveWorkerLike = {
      postMessage: () => {},
      terminate: () => {},
      onmessage: null,
      onerror: null,
    }
    const client = createSolveClient({ worker })
    expect(client.mode).toBe('worker')

    const unbind = bindSolveMode(client)
    try {
      expect(useScheduleStore.getState().solveMode).toBe('worker')

      // 模拟运行期 worker 失效（脚本崩溃 / 被回收）
      worker.onerror?.(new Error('boom'))

      expect(client.mode).toBe('inline')
      // store 立刻跟随 —— 不是「开机时是 worker」的陈旧快照
      expect(useScheduleStore.getState().solveMode).toBe('inline')
    } finally {
      unbind()
    }
  })
})

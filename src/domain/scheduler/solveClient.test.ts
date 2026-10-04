import { describe, expect, it } from 'vitest'
import { createDependency, createProject, createTask } from '../model/factories'
import type { Project } from '../model/types'
import { solve } from './index'
import { CycleError } from './graph'
import { createSolveClient, SupersededError, type SolveWorkerLike } from './solveClient'
import {
  serializeSolveError,
  type SolveRequest,
  type SolveResponse,
} from './solveProtocol'

/**
 * 客户端的可测性说明：jsdom **没有 `Worker`**，所以这里注入一个假 worker 来驱动
 * 「消息进消息出」的真实路径 —— 客户端逻辑（关联、supersede、错误透传）与真实
 * worker 用的是同一份代码，假 worker 只替掉 `postMessage` 这一段传输。
 * 生产路径（真 worker）由 e2e 证明（见 e2e/perf.spec.ts 的 solveMode 断言）。
 */
class FakeWorker implements SolveWorkerLike {
  onmessage: ((event: MessageEvent<SolveResponse>) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  readonly sent: SolveRequest[] = []
  terminated = false

  postMessage(message: SolveRequest): void {
    this.sent.push(message)
  }
  terminate(): void {
    this.terminated = true
  }
  /** 把一条响应投回客户端（模拟 worker 的 postMessage 回到主线程）。 */
  respond(response: SolveResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<SolveResponse>)
  }
}

function singleTaskProject(name = '测试', duration = 3): { project: Project; taskId: string } {
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

describe('solveClient：worker 路径', () => {
  it('把请求发给 worker，并用响应解析结果（结果与直接 solve 相同）', async () => {
    const worker = new FakeWorker()
    const client = createSolveClient({ worker })
    expect(client.mode).toBe('worker')

    const { project } = singleTaskProject()
    const promise = client.solve(project)

    expect(worker.sent).toHaveLength(1)
    const req = worker.sent[0]
    expect(req.project).toBe(project)

    worker.respond({ id: req.id, ok: true, result: solve(project) })
    await expect(promise).resolves.toEqual(solve(project))
  })

  it('dispose() 终止底层 worker', () => {
    const worker = new FakeWorker()
    const client = createSolveClient({ worker })
    client.dispose()
    expect(worker.terminated).toBe(true)
  })

  it('worker 出错后：在途请求被拒绝，后续请求退回同步兜底（不永久卡住）', async () => {
    const worker = new FakeWorker()
    const client = createSolveClient({ worker })
    expect(client.mode).toBe('worker')

    const { project } = singleTaskProject()
    const inFlight = client.solve(project)
    expect(worker.sent).toHaveLength(1)

    // 模拟 worker 脚本加载失败 / 运行期崩溃
    worker.onerror?.(new Error('boom'))

    await expect(inFlight).rejects.toThrow(/worker 不可用/)
    expect(client.mode).toBe('inline')
    // 之后不再依赖（已废弃的）worker —— 直接同步兜底，且不再发消息
    await expect(client.solve(project)).resolves.toEqual(solve(project))
    expect(worker.sent).toHaveLength(1)
  })
})

describe('solveClient：无 Worker 时的同步兜底', () => {
  it('mode 为 inline，且结果与直接 solve 逐字段相同', async () => {
    const client = createSolveClient({ worker: null })
    expect(client.mode).toBe('inline')

    const { project } = singleTaskProject()
    await expect(client.solve(project)).resolves.toEqual(solve(project))
  })

  it('兜底把 solve 抛出的错误原样透传给调用方', async () => {
    const client = createSolveClient({ worker: null })
    await expect(client.solve(cyclicProject())).rejects.toBeInstanceOf(CycleError)
  })
})

describe('solveClient：supersede（旧结果永不覆盖新结果）', () => {
  it('慢请求被随后的快请求取代 —— 只有快请求的结果被投递', async () => {
    const worker = new FakeWorker()
    const client = createSolveClient({ worker })

    const slow = singleTaskProject('慢', 10).project
    const fast = singleTaskProject('快', 1).project

    const slowPromise = client.solve(slow)
    const slowId = worker.sent[0].id
    // 第二个请求一到，第一个立即作废
    const fastPromise = client.solve(fast)
    const fastId = worker.sent[1].id

    await expect(slowPromise).rejects.toBeInstanceOf(SupersededError)

    // 慢响应迟到 —— 必须被丢弃（否则会用慢结果覆盖快的）
    worker.respond({ id: slowId, ok: true, result: solve(slow) })
    // 快响应到达
    worker.respond({ id: fastId, ok: true, result: solve(fast) })

    await expect(fastPromise).resolves.toEqual(solve(fast))
  })

  it('迟到的旧响应在新结果之后到达，也无法改写新结果', async () => {
    const worker = new FakeWorker()
    const client = createSolveClient({ worker })

    const a = singleTaskProject('A', 3).project
    const b = singleTaskProject('B', 1).project

    const aPromise = client.solve(a)
    const aId = worker.sent[0].id
    const bPromise = client.solve(b)
    const bId = worker.sent[1].id

    // 新的先回来
    worker.respond({ id: bId, ok: true, result: solve(b) })
    await expect(bPromise).resolves.toEqual(solve(b))

    // 旧的后回来 —— 没有任何 pending 条目，直接丢弃；aPromise 早已是 superseded
    worker.respond({ id: aId, ok: true, result: solve(a) })
    await expect(aPromise).rejects.toBeInstanceOf(SupersededError)
    await expect(bPromise).resolves.toEqual(solve(b))
  })
})

describe('solveClient：错误跨消息边界的身份', () => {
  it('CycleError 到对面重建后仍是同一个类，环路不丢', async () => {
    const worker = new FakeWorker()
    const client = createSolveClient({ worker })
    const project = cyclicProject()

    // 取出真实 solve() 抛出的 CycleError（模拟 worker 内发生的事）
    let thrown: unknown
    try {
      solve(project)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(CycleError)
    const originalCycle = (thrown as CycleError).cycle

    const promise = client.solve(project)
    worker.respond({ id: worker.sent[0].id, ok: false, error: serializeSolveError(thrown) })

    const rejected = await promise.then(
      () => {
        throw new Error('本应被拒绝')
      },
      (error: unknown) => error,
    )
    expect(rejected).toBeInstanceOf(CycleError)
    // 身份之外，环路内容也必须完整保留
    expect((rejected as CycleError).cycle).toEqual(originalCycle)
    expect((rejected as CycleError).cycle).toContain(project.rootIds[0])
  })

  it('非 CycleError 原样透传（name / message 不变，且不会被误认成 CycleError）', async () => {
    const worker = new FakeWorker()
    const client = createSolveClient({ worker })
    const { project } = singleTaskProject()

    const promise = client.solve(project)
    worker.respond({
      id: worker.sent[0].id,
      ok: false,
      error: { name: 'RangeError', message: 'boom' },
    })

    const rejected = await promise.then(
      () => {
        throw new Error('本应被拒绝')
      },
      (error: unknown) => error,
    )
    expect(rejected).toBeInstanceOf(Error)
    expect(rejected).not.toBeInstanceOf(CycleError)
    expect((rejected as Error).name).toBe('RangeError')
    expect((rejected as Error).message).toBe('boom')
  })
})

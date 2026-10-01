import { describe, it, expect, beforeEach } from 'vitest'
import { createProject } from '../domain/model/factories'
import { __resetRegistryForTests, initCommands } from '../commands/registry'
import { useProjectStore } from './projectStore'

function reset(): void {
  __resetRegistryForTests()
  initCommands()
  useProjectStore.setState({
    project: createProject('测试项目', '2026-03-02'),
    undoStack: [],
    redoStack: [],
    lastError: null,
  })
}

function state() {
  return useProjectStore.getState()
}

function seedTask(name: string): string {
  state().dispatch({ type: 'task.create', label: '新建任务', payload: { name } })
  const ids = Object.keys(state().project!.tasks)
  return ids[ids.length - 1]
}

describe('projectStore.dispatch', () => {
  beforeEach(reset)

  it('应用命令并更新 project', () => {
    const id = seedTask('需求调研')
    expect(state().project!.tasks[id].name).toBe('需求调研')
    expect(state().undoStack).toHaveLength(1)
  })

  it('不产生任何变更的命令不入栈', () => {
    // 删除一个不存在的任务 → patches 为空
    state().dispatch({ type: 'task.delete', label: '删除', payload: { taskId: 'ghost' } })
    expect(state().undoStack).toHaveLength(0)
  })

  it('命令执行失败时写入 lastError 且 project 保持不变', () => {
    const a = seedTask('A')
    const b = seedTask('B')
    state().dispatch({ type: 'dependency.create', label: '建立依赖', payload: { fromTaskId: a, toTaskId: b } })
    const before = state().project

    state().dispatch({ type: 'dependency.create', label: '建立依赖', payload: { fromTaskId: b, toTaskId: a } })

    expect(state().lastError).toMatch(/循环依赖/)
    expect(state().project).toBe(before)
  })
})

describe('projectStore.undo / redo', () => {
  beforeEach(reset)

  it('undo 回滚到上一次状态', () => {
    const id = seedTask('A')
    state().dispatch({ type: 'task.rename', label: '重命名', payload: { taskId: id, name: 'B' } })
    expect(state().project!.tasks[id].name).toBe('B')

    state().undo()

    expect(state().project!.tasks[id].name).toBe('A')
    expect(state().undoStack).toHaveLength(1)
    expect(state().redoStack).toHaveLength(1)
  })

  it('redo 重新应用被撤销的命令', () => {
    const id = seedTask('A')
    state().dispatch({ type: 'task.rename', label: '重命名', payload: { taskId: id, name: 'B' } })
    state().undo()
    state().redo()

    expect(state().project!.tasks[id].name).toBe('B')
    expect(state().redoStack).toHaveLength(0)
  })

  it('undo 到底后不再变化', () => {
    seedTask('A')
    state().undo()
    state().undo()
    expect(state().project!.tasks).toEqual({})
    expect(state().undoStack).toHaveLength(0)
  })

  it('执行新命令会清空 redo 栈', () => {
    const id = seedTask('A')
    state().dispatch({ type: 'task.rename', label: '重命名', payload: { taskId: id, name: 'B' } })
    state().undo()
    state().dispatch({ type: 'task.rename', label: '重命名', payload: { taskId: id, name: 'C' } })

    expect(state().redoStack).toHaveLength(0)
  })

  it('排期结果不进撤销栈：redo 后重新算出的排期与首次一致', () => {
    const id = seedTask('A')
    state().dispatch({ type: 'task.setDuration', label: '修改工期', payload: { taskId: id, duration: 4 } })
    state().undo()
    state().redo()

    expect(state().project!.tasks[id].duration).toBe(4)
  })

  it('create → undo → redo → undo 后项目保持一致，不产生孤儿任务', () => {
    const id = seedTask('A')
    expect(state().project!.rootIds).toEqual([id])

    state().undo()
    expect(state().project!.tasks).toEqual({})
    expect(state().project!.rootIds).toEqual([])

    state().redo()
    // 关键：redo 后 id 必须与首次一致（应用正向 patch，而非重跑 handler）
    expect(state().project!.tasks[id]).toBeDefined()
    expect(state().project!.rootIds).toEqual([id])

    state().undo()
    // 关键：tasks 与 rootIds 必须同时清空，不能留下孤儿
    expect(state().project!.tasks).toEqual({})
    expect(state().project!.rootIds).toEqual([])
  })
})

describe('命令合并（coalesceKey）', () => {
  beforeEach(reset)

  it('相邻且 coalesceKey 相同的命令合并为一条撤销记录', () => {
    const id = seedTask('A')
    const base = state().undoStack.length

    for (const name of ['AB', 'ABC', 'ABCD']) {
      state().dispatch({
        type: 'task.rename',
        label: '重命名',
        payload: { taskId: id, name },
        coalesceKey: `task.rename:${id}`,
      })
    }

    expect(state().undoStack).toHaveLength(base + 1) // 三条折叠成一条新增记录
    expect(state().project!.tasks[id].name).toBe('ABCD')

    state().undo()
    expect(state().project!.tasks[id].name).toBe('A') // 一次撤销回到最原始
  })

  it('coalesceKey 不同的相邻命令不合并', () => {
    const id = seedTask('A')
    const base = state().undoStack.length
    state().dispatch({ type: 'task.rename', label: '重命名', payload: { taskId: id, name: 'B' }, coalesceKey: 'x' })
    state().dispatch({ type: 'task.rename', label: '重命名', payload: { taskId: id, name: 'C' }, coalesceKey: 'y' })

    expect(state().undoStack).toHaveLength(base + 2)
  })

  it('没有 coalesceKey 的命令从不合并', () => {
    const id = seedTask('A')
    const base = state().undoStack.length
    state().dispatch({ type: 'task.setProgress', label: '设置进度', payload: { taskId: id, progress: 10 } })
    state().dispatch({ type: 'task.setProgress', label: '设置进度', payload: { taskId: id, progress: 20 } })

    expect(state().undoStack).toHaveLength(base + 2)
  })

  it('合并后一次撤销能回滚全部被改动的字段', () => {
    // 这条测试专门盯住合成记录里被丢掉的逆 patch：两条命令改的是不同字段，
    // 若合并时只保留较早那条的逆 patch，总有一个字段回不去。
    const id = seedTask('A')
    const base = state().undoStack.length
    state().dispatch({
      type: 'task.setDuration',
      label: '修改工期',
      payload: { taskId: id, duration: 5 },
      coalesceKey: 'k',
    })
    state().dispatch({
      type: 'task.setProgress',
      label: '设置进度',
      payload: { taskId: id, progress: 40 },
      coalesceKey: 'k',
    })

    expect(state().undoStack).toHaveLength(base + 1)

    state().undo()

    expect(state().project!.tasks[id].duration).toBe(1)
    expect(state().project!.tasks[id].progress).toBe(0)
  })
})

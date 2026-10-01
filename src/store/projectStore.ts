import { create } from 'zustand'
import { applyPatches, type Patch } from 'immer'
import type { Project } from '../domain/model/types'
import { execute } from '../commands/registry'
import type { Command } from '../commands/types'

// 注：Immer 的 patch 能力已由 commands/registry 在模块加载时通过 enablePatches() 开启。
// 只要命令经由 registry 的 execute 应用，这里就无需重复开启 —— 它同样是 applyPatches 能工作的前提。

/** 撤销栈里的一条记录：命令本身 + 它能被撤销掉的逆 patch */
export interface HistoryEntry {
  command: Command
  inversePatches: Patch[]
}

interface ProjectState {
  project: Project | null
  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]
  /** 最近一次命令失败的说明，供 UI 展示 */
  lastError: string | null

  dispatch: (command: Command) => void
  undo: () => void
  redo: () => void
  loadProject: (project: Project) => void
  clearError: () => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  undoStack: [],
  redoStack: [],
  lastError: null,

  dispatch: (command) => {
    const { project, undoStack } = get()
    if (!project) return

    try {
      const { project: next, patches, inversePatches } = execute(project, command)

      // 命令被业务规则拒绝（例如对摘要任务设工期）时 patches 为空，
      // 此时不应污染撤销栈
      if (patches.length === 0) return

      set({
        project: next,
        undoStack: mergeIntoStack(undoStack, { command, inversePatches }),
        redoStack: [],
        lastError: null,
      })
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : String(error) })
    }
  },

  undo: () => {
    const { project, undoStack, redoStack } = get()
    if (!project || undoStack.length === 0) return

    const entry = undoStack[undoStack.length - 1]
    set({
      project: applyPatches(project, entry.inversePatches),
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, entry],
    })
  },

  redo: () => {
    const { project, undoStack, redoStack } = get()
    if (!project || redoStack.length === 0) return

    const entry = redoStack[redoStack.length - 1]
    // 重跑同一条命令 —— handler 是纯函数，结果与首次执行一致
    const { project: next } = execute(project, entry.command)

    set({
      project: next,
      undoStack: [...undoStack, entry],
      redoStack: redoStack.slice(0, -1),
    })
  },

  loadProject: (project) => {
    set({ project, undoStack: [], redoStack: [], lastError: null })
  },

  clearError: () => set({ lastError: null }),
}))

/**
 * 入栈。若栈顶命令与当前命令的 coalesceKey 相同，则合并为一条撤销记录：
 * 命令换成最新的那条（撤销菜单显示最近的操作名），
 * 逆 patch 则按「先撤最新、再撤更早」的顺序拼接 ——
 * 每条逆 patch 都是相对它被应用时的状态计算的，顺序错乱会导致撤销不干净。
 */
function mergeIntoStack(stack: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const top = stack[stack.length - 1]
  const key = entry.command.coalesceKey

  if (top && key !== undefined && top.command.coalesceKey === key) {
    return [
      ...stack.slice(0, -1),
      {
        command: entry.command,
        inversePatches: [...entry.inversePatches, ...top.inversePatches],
      },
    ]
  }
  return [...stack, entry]
}

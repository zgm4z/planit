import { create } from 'zustand'
import { applyPatches, type Patch } from 'immer'
import type { Project } from '../domain/model/types'
import { execute } from '../commands/registry'
import type { Command } from '../commands/types'

// 注：Immer 的 patch 能力已由 commands/registry 在模块加载时通过 enablePatches() 开启。
// 只要命令经由 registry 的 execute 应用，这里就无需重复开启 —— 它同样是 applyPatches 能工作的前提。

/** 撤销栈里的一条记录：命令本身 + 它的正向/逆向 patch */
export interface HistoryEntry {
  command: Command
  /** redo 用：应用它即可重放这次变更（不重跑 handler，因为 handler 未必是纯函数） */
  patches: Patch[]
  /** undo 用：应用它即可回滚这次变更 */
  inversePatches: Patch[]
}

interface ProjectState {
  project: Project | null
  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]
  /** 最近一次命令失败的说明，供 UI 展示 */
  lastError: string | null
  /**
   * 一次性的「合并屏障」：置位后，下一条 dispatch 必须新开一条撤销记录。
   *
   * `mergeIntoStack` 只看「栈顶的 coalesceKey 是否与当前命令相同」，它无法
   * 感知用户做了什么**不产生命令**的动作。于是
   * 「改 A 的工期 → 点 B 看一眼 → 点回 A → 再改 A 的工期」会塌缩成一次 Ctrl+Z ——
   * 中间那次换任务没有 dispatch，栈顶没被动过。
   * 交互边界（切换选中任务、输入框失焦、undo/redo）把这里置位，即可打断合并。
   */
  coalesceBarrier: boolean

  /** 打断合并：下一条命令另起一条撤销记录 */
  breakCoalescing: () => void
  dispatch: (command: Command) => void
  undo: () => void
  redo: () => void
  loadProject: (project: Project) => void
  closeProject: () => void
  clearError: () => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  undoStack: [],
  redoStack: [],
  lastError: null,
  coalesceBarrier: false,

  breakCoalescing: () => set({ coalesceBarrier: true }),

  dispatch: (command) => {
    const { project, undoStack, coalesceBarrier } = get()
    if (!project) return

    try {
      const { project: next, patches, inversePatches } = execute(project, command)

      // 命令被业务规则拒绝（例如对摘要任务设工期）时 patches 为空，
      // 此时不应污染撤销栈。屏障也保留 —— 下一个真正生效的命令
      // 仍然应该另起一条记录。
      if (patches.length === 0) return

      set({
        // updatedAt 在 set 时用展开叠加，而非写进 handler ——
        // 这样它不会出现在 patches 里，也就不会污染撤销栈。
        project: { ...next, updatedAt: new Date().toISOString() },
        undoStack: mergeIntoStack(undoStack, { command, patches, inversePatches }, coalesceBarrier),
        redoStack: [],
        lastError: null,
        coalesceBarrier: false,
      })
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : String(error) })
    }
  },

  undo: () => {
    const { project, undoStack, redoStack } = get()
    if (!project || undoStack.length === 0) return

    const entry = undoStack[undoStack.length - 1]

    try {
      set({
        // updatedAt 与 dispatch 一致地刷新：撤销同样是一次真实的修改，
        // 不刷新会让「最近修改時間」倒退，列表排序失真
        project: {
          ...applyPatches(project, entry.inversePatches),
          updatedAt: new Date().toISOString(),
        },
        undoStack: undoStack.slice(0, -1),
        redoStack: [...redoStack, entry],
        // 撤销后栈顶换成了一条**更早**的记录；若那条的 coalesceKey 恰好与
        // 接下来的编辑相同，不打断就会把新编辑并进一条已经撤销过的记录里，
        // 于是一次撤销会连带上一次早已撤销的编辑。
        coalesceBarrier: true,
      })
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : String(error) })
    }
  },

  redo: () => {
    const { project, undoStack, redoStack } = get()
    if (!project || redoStack.length === 0) return

    const entry = redoStack[redoStack.length - 1]

    try {
      set({
        // 应用正向 patch 重放，而不是重跑 handler ——
        // task.create 会生成新的自增 id，重跑会得到与首次不同的任务
        project: {
          ...applyPatches(project, entry.patches),
          updatedAt: new Date().toISOString(),
        },
        undoStack: [...undoStack, entry],
        redoStack: redoStack.slice(0, -1),
        coalesceBarrier: true,
      })
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : String(error) })
    }
  },

  loadProject: (project) => {
    set({ project, undoStack: [], redoStack: [], lastError: null, coalesceBarrier: false })
  },

  /**
   * 关闭当前项目，回到项目列表。
   *
   * 同时清空历史栈 —— 撤销栈是**项目级**的，跨项目保留会让 A 项目的
   * 撤销记录作用到 B 项目上，那是灾难性的。
   */
  closeProject: () => {
    set({ project: null, undoStack: [], redoStack: [], lastError: null, coalesceBarrier: false })
  },

  clearError: () => set({ lastError: null }),
}))

/**
 * 入栈。若栈顶命令与当前命令的 coalesceKey 相同，则合并为一条撤销记录：
 * 命令换成最新的那条（撤销菜单显示最近的操作名），正/逆向 patch 分别拼接。
 *
 * `forceNew` 为真时跳过合并（见 `coalesceBarrier`）。
 */
function mergeIntoStack(
  stack: HistoryEntry[],
  entry: HistoryEntry,
  forceNew = false,
): HistoryEntry[] {
  const top = stack[stack.length - 1]
  const key = entry.command.coalesceKey

  if (!forceNew && top && key !== undefined && top.command.coalesceKey === key) {
    return [
      ...stack.slice(0, -1),
      {
        command: entry.command,
        // 正向 patch 按执行顺序拼接，逆向 patch 按「先撤最新、再撤更早」拼接。
        // 每条 patch 都是相对它被应用时的状态计算的，顺序错乱会导致撤销/重放不干净。
        patches: [...top.patches, ...entry.patches],
        inversePatches: [...entry.inversePatches, ...top.inversePatches],
      },
    ]
  }
  return [...stack, entry]
}

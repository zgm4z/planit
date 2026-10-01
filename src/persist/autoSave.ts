import type { Project } from '../domain/model/types'
import { useProjectStore } from '../store/projectStore'
import { saveProject } from './indexeddb'

export const AUTO_SAVE_DELAY_MS = 500

/**
 * 订阅 projectStore，在 project 变化后防抖落盘。
 * 返回取消订阅的函数。
 *
 * 存盘失败不抛出到 UI —— 调用方通过 onError 回调展示常驻警告条，
 * 但内存中的数据照常可用（降级为纯内存运行）。
 */
export function startAutoSave(
  onError: (message: string) => void,
  delayMs = AUTO_SAVE_DELAY_MS,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  /** 最近一次待落盘的快照。取消订阅时若有挂起的快照，先冲掉再退出 */
  let pending: Project | null = null

  const unsubscribe = useProjectStore.subscribe((state, prevState) => {
    if (state.project === prevState.project || !state.project) return

    if (timer !== null) clearTimeout(timer)
    pending = state.project
    timer = setTimeout(() => {
      const snapshot = pending
      pending = null
      timer = null
      if (!snapshot) return
      saveProject(snapshot).catch((error: unknown) => {
        onError(error instanceof Error ? error.message : String(error))
      })
    }, delayMs)
  })

  return () => {
    unsubscribe()
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
      // 卸载不等于放弃这次编辑 —— 立刻落盘，否则用户最后一次修改会静默丢失
      if (pending) {
        void saveProject(pending).catch((error: unknown) => {
          onError(error instanceof Error ? error.message : String(error))
        })
        pending = null
      }
    }
  }
}

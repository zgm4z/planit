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

  const unsubscribe = useProjectStore.subscribe((state, prevState) => {
    if (state.project === prevState.project || !state.project) return

    if (timer !== null) clearTimeout(timer)
    const snapshot = state.project
    timer = setTimeout(() => {
      saveProject(snapshot).catch((error: unknown) => {
        onError(error instanceof Error ? error.message : String(error))
      })
    }, delayMs)
  })

  return () => {
    if (timer !== null) clearTimeout(timer)
    unsubscribe()
  }
}

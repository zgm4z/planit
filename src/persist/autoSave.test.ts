import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createProject } from '../domain/model/factories'
import { useProjectStore } from '../store/projectStore'
import { deleteAllProjects, loadProject } from './indexeddb'
import { startAutoSave } from './autoSave'

beforeEach(async () => {
  await deleteAllProjects()
  useProjectStore.setState({ project: null, undoStack: [], redoStack: [], lastError: null })
})

describe('startAutoSave', () => {
  it('取消订阅时会冲掉挂起的存盘，不丢失最后一次编辑', async () => {
    const project = createProject('待存', '2026-03-02')

    const stop = startAutoSave(() => {}, 10_000) // 防抖设得足够长，确保不会自然触发
    useProjectStore.setState({ project }) // 触发一次变更
    stop() // 立刻取消订阅

    // flush 是异步的，等它落盘
    await vi.waitFor(async () => {
      expect(await loadProject(project.id)).not.toBeNull()
    })
  })
})

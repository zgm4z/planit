import type { Project } from '../domain/model/types'
import { seedIdCounterFromProject } from '../domain/model/factories'
import { SCHEMA_VERSION, parsePersistedProject } from './schema'

const DB_NAME = 'planit'
const DB_VERSION = 1
const STORE = 'projects'

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'project.id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开 IndexedDB'))
  })
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const request = run(tx.objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失败'))
        tx.oncomplete = () => db.close()
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务被中止'))
      }),
  )
}

export async function saveProject(project: Project): Promise<void> {
  await withStore('readwrite', (store) =>
    store.put({
      schemaVersion: SCHEMA_VERSION,
      project,
      updatedAt: project.updatedAt,
    }),
  )
}

export async function loadProject(id: string): Promise<Project | null> {
  const raw = await withStore<unknown>('readonly', (store) => store.get(id))
  if (raw === undefined) return null

  const project = parsePersistedProject(raw)
  // 页面重载后模块级 id 计数器已归零。必须从存档里恢复，
  // 否则新建的任务会拿到与既有任务相同的 id，并在 Record 中静默覆盖它。
  seedIdCounterFromProject(project)
  return project
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const rows = await withStore<unknown[]>('readonly', (store) => store.getAll())

  return rows
    .map((row) => (row as { project?: Project }).project)
    .filter((project): project is Project => Boolean(project))
    .map((project) => ({
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export async function deleteProject(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id))
}

/** 仅供测试清理 */
export async function deleteAllProjects(): Promise<void> {
  await withStore('readwrite', (store) => store.clear())
}

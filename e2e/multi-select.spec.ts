import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  chainProject,
  clickRowWithModifiers,
  dragBar,
  loadFixture,
  makeProject,
  openTopMenu,
  readSchedules,
  readSelection,
  readStore,
  readVisibleSelectedRows,
  switchView,
} from './helpers'

/**
 * 主「切换」修饰键：macOS 用 Cmd（Meta），其余平台用 Ctrl。
 *
 * 不能无脑用 Control：在 macOS 上 Chromium 把 Control+左键当次键处理，行的 `onClick`
 * 根本不触发 —— 选区纹丝不动（这个坑实打实踩过一次）。应用侧 `ctrlKey || metaKey`
 * 两者等价，故按平台取主修饰键即可，语义不变。
 */
const PRIMARY: { ctrl?: boolean; meta?: boolean } =
  process.platform === 'darwin' ? { meta: true } : { ctrl: true }

/**
 * 任务/资源复选 + 工具栏批量分配（spec 判据 1–12 里可自动化的部分）。
 *
 * 两条纪律贯穿全篇（与 `helpers.ts` 的模块注释同源）：
 *   ① 期望值要么从 DOM 独立读、要么从 store 实体读；不 import 实现内部函数去反推。
 *   ② **「可见性」必须单独钉住**：多选最初正是「store 里集合对了、UI 上却不亮」的 Blocker，
 *      所以断言里既有 store 的 `selectedTaskIds`，也有行上的 `data-selected` / `data-anchor`。
 */

/** 从 store 读当前全部分配（判据 4/6 的落点）。 */
async function assignmentsOf(
  page: Page,
): Promise<{ id: string; taskId: string; resourceId: string; units: number }[]> {
  return page.evaluate(async () => {
    const mod = (await import('/src/store/projectStore.ts')) as {
      useProjectStore: {
        getState: () => {
          project: {
            assignments: Record<string, { id: string; taskId: string; resourceId: string; units: number }>
          }
        }
      }
    }
    return Object.values(mod.useProjectStore.getState().project.assignments)
  })
}

test.describe('① 复选交互与可见性', () => {
  test('Ctrl 点击切换、Shift 点击选范围、Esc 收敛 —— 每一行都有选中态', async ({ page }) => {
    await loadFixture(page, chainProject())

    // Ctrl 累加：t2 → t4；锚点跟随最后一次点击（t4）
    await clickRowWithModifiers(page, 'outline-row-t2', { ...PRIMARY })
    await clickRowWithModifiers(page, 'outline-row-t4', { ...PRIMARY })
    let sel = await readSelection(page)
    expect(sel.taskIds).toEqual(['t2', 't4'])
    expect(sel.anchorTaskId).toBe('t4')

    // 可见性：两行都带选中态；只有锚点行带 `data-anchor`（区分态）
    expect(await readVisibleSelectedRows(page, 'outline-row-')).toEqual(['t2', 't4'])
    await expect(page.getByTestId('outline-row-t4')).toHaveAttribute('data-anchor', 'true')
    await expect(page.getByTestId('outline-row-t2')).not.toHaveAttribute('data-anchor', 'true')

    // Shift 以锚点（t4）为起点扩到 t7 —— 锚点保留
    await clickRowWithModifiers(page, 'outline-row-t7', { shift: true })
    sel = await readSelection(page)
    expect(sel.taskIds).toEqual(['t4', 't5', 't6', 't7'])
    expect(sel.anchorTaskId).toBe('t4')
    expect(await readVisibleSelectedRows(page, 'outline-row-')).toEqual(['t4', 't5', 't6', 't7'])

    // Esc 收敛到只剩锚点
    await page.keyboard.press('Escape')
    sel = await readSelection(page)
    expect(sel.taskIds).toEqual(['t4'])
    expect(await readVisibleSelectedRows(page, 'outline-row-')).toEqual(['t4'])
  })

  test('Shift+↓ / Shift+↑ 以锚点扩选（键盘路径）', async ({ page }) => {
    await loadFixture(page, chainProject())
    await clickRowWithModifiers(page, 'outline-row-t3', {})

    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    expect((await readSelection(page)).taskIds).toEqual(['t3', 't4', 't5'])

    await page.keyboard.press('Shift+ArrowUp')
    expect((await readSelection(page)).taskIds).toEqual(['t3', 't4'])
  })

  test('资源视图同样可多选（判据 2）', async ({ page }) => {
    await loadFixture(
      page,
      makeProject({
        tasks: [{ id: 't1', name: 'T1' }],
        resources: [
          { id: 'r1', name: '张三' },
          { id: 'r2', name: '李四' },
        ],
      }),
    )
    await switchView(page, 'resources')

    await clickRowWithModifiers(page, 'resource-row-r1', {})
    await clickRowWithModifiers(page, 'resource-row-r2', { ...PRIMARY })

    const sel = await readSelection(page)
    expect(sel.resourceIds).toEqual(['r1', 'r2'])
    expect(sel.anchorResourceId).toBe('r2')
    expect(await readVisibleSelectedRows(page, 'resource-row-')).toEqual(['r1', 'r2'])
  })
})

test.describe('② 工具栏禁用与范围固化', () => {
  test('未选任务 / 选中全为摘要时禁用并给可见原因；选中叶子后启用', async ({ page }) => {
    await loadFixture(
      page,
      makeProject({
        tasks: [
          { id: 'g', name: '组' },
          { id: 'a', name: 'A', parentId: 'g' },
          { id: 'b', name: 'B', parentId: 'g' },
        ],
      }),
    )

    // 未选任何任务 → 禁用，原因落在 DOM 上（tooltip 只在悬停挂载，DOM 属性才是可断言的事实）
    await expect(page.getByTestId('assignment-menu-trigger')).toBeDisabled()
    await expect(page.getByTestId('assignment-menu-wrap')).toHaveAttribute(
      'data-disabled-reason',
      '未选中任务',
    )

    // 只选中摘要（组）→ 仍禁用，原因换成「均为摘要」（摘要不能直接派资源）
    await clickRowWithModifiers(page, 'outline-row-g', {})
    await expect(page.getByTestId('assignment-menu-trigger')).toBeDisabled()
    await expect(page.getByTestId('assignment-menu-wrap')).toHaveAttribute(
      'data-disabled-reason',
      '选中项均为摘要任务',
    )

    // 选中一个叶子 → 启用
    await clickRowWithModifiers(page, 'outline-row-a', { ...PRIMARY })
    await expect(page.getByTestId('assignment-menu-trigger')).toBeEnabled()
  })

  test('Shift 范围被折叠 / 切视图往返后成员不变（判据 11）', async ({ page }) => {
    await loadFixture(
      page,
      makeProject({
        tasks: [
          { id: 'g', name: '组' },
          { id: 'a', name: 'A', parentId: 'g' },
          { id: 'b', name: 'B', parentId: 'g' },
          { id: 'c', name: 'C', parentId: 'g' },
        ],
      }),
    )
    await clickRowWithModifiers(page, 'outline-row-g', {})
    await clickRowWithModifiers(page, 'outline-row-c', { shift: true })
    expect((await readSelection(page)).taskIds).toEqual(['g', 'a', 'b', 'c'])

    // 折叠组：可见行序变化（只剩 g），但集合成员一个不少 —— 范围一经选中即固化
    await page.locator('[data-testid="outline-row-g"] button').click()
    expect((await readSelection(page)).taskIds).toEqual(['g', 'a', 'b', 'c'])
    expect(await readVisibleSelectedRows(page, 'outline-row-')).toEqual(['g'])

    // 切到资源视图再切回，成员仍不变
    await switchView(page, 'resources')
    await switchView(page, 'outline')
    expect((await readSelection(page)).taskIds).toEqual(['g', 'a', 'b', 'c'])
  })
})

test.describe('③ 批量分配（判据 4/5）', () => {
  test('勾选资源 → 每个选中任务各一条 units===1.0 的分配；一次 Ctrl+Z 全恢复', async ({ page }) => {
    await loadFixture(
      page,
      makeProject({
        tasks: [
          { id: 't1', name: 'T1' },
          { id: 't2', name: 'T2' },
        ],
        resources: [{ id: 'r1', name: '张三' }],
      }),
    )
    await clickRowWithModifiers(page, 'outline-row-t1', {})
    await clickRowWithModifiers(page, 'outline-row-t2', { ...PRIMARY })

    await page.getByTestId('assignment-menu-trigger').click()
    await page.getByTestId('assignment-resource-r1').click()

    await expect.poll(async () => (await assignmentsOf(page)).length).toBe(2)
    const assignments = await assignmentsOf(page)
    expect(assignments.every((a) => a.units === 1)).toBe(true)
    // 每个选中任务各一条、且不重复建（集合大小 = 分配条数）
    expect(new Set(assignments.map((a) => a.taskId))).toEqual(new Set(['t1', 't2']))

    // 点触发器挪走焦点（复选框是 <input>，焦点在内时全局撤销快捷键会刻意不接管），再撤销
    await page.getByTestId('assignment-menu-trigger').click()
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await assignmentsOf(page)).length).toBe(0)
  })

  test('三态：部分有 → 半选；点后补齐为全选（判据 5）', async ({ page }) => {
    await loadFixture(
      page,
      makeProject({
        tasks: [
          { id: 't1', name: 'T1' },
          { id: 't2', name: 'T2' },
        ],
        resources: [
          { id: 'r1', name: '张三' },
          { id: 'r2', name: '李四' },
        ],
        // t1 已有张三 → 两个选中任务里只有一个有 → 半选
        assignments: [{ id: 'a1', task: 't1', resource: 'r1' }],
      }),
    )
    await clickRowWithModifiers(page, 'outline-row-t1', {})
    await clickRowWithModifiers(page, 'outline-row-t2', { ...PRIMARY })

    await page.getByTestId('assignment-menu-trigger').click()
    await expect(page.getByTestId('assignment-resource-r1')).toHaveAttribute(
      'data-indeterminate',
      'true',
    )
    await expect(page.getByTestId('assignment-resource-r2')).not.toBeChecked()

    // 半选态下再点 → 只给缺的那个任务补一条，已有的不重复建
    await page.getByTestId('assignment-resource-r1').click()
    await expect.poll(async () => (await assignmentsOf(page)).length).toBe(2)
    const assignments = await assignmentsOf(page)
    expect(assignments.filter((a) => a.taskId === 't1')).toHaveLength(1)
    expect(assignments.filter((a) => a.taskId === 't2')).toHaveLength(1)

    // 补齐后变成全选
    await expect(page.getByTestId('assignment-resource-r1')).toBeChecked()
  })
})

test.describe('④ 清除与批量删除各留一条撤销记录（判据 6/9）', () => {
  test('「清除分配」清空全部选中任务的分配；一次 Ctrl+Z 全恢复', async ({ page }) => {
    await loadFixture(
      page,
      makeProject({
        tasks: [
          { id: 't1', name: 'T1' },
          { id: 't2', name: 'T2' },
        ],
        resources: [
          { id: 'r1', name: '张三' },
          { id: 'r2', name: '李四' },
        ],
        assignments: [
          { id: 'a1', task: 't1', resource: 'r1' },
          { id: 'a2', task: 't2', resource: 'r2' },
        ],
      }),
    )
    await clickRowWithModifiers(page, 'outline-row-t1', {})
    await clickRowWithModifiers(page, 'outline-row-t2', { ...PRIMARY })

    await page.getByTestId('assignment-menu-trigger').click()
    await page.getByTestId('assignment-clear').click()
    await expect.poll(async () => (await assignmentsOf(page)).length).toBe(0)

    // N 条删除共用一个 coalesceKey → 只塌成一条撤销记录
    expect((await readStore(page)).undoLength).toBe(1)

    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await assignmentsOf(page)).length).toBe(2)
  })

  test('批量删除 3 个任务 → 一条撤销记录，一次 Ctrl+Z 三个全恢复', async ({ page }) => {
    await loadFixture(
      page,
      makeProject({
        tasks: [
          { id: 't1', name: 'T1' },
          { id: 't2', name: 'T2' },
          { id: 't3', name: 'T3' },
          { id: 't4', name: 'T4' },
        ],
      }),
    )
    await clickRowWithModifiers(page, 'outline-row-t1', {})
    await clickRowWithModifiers(page, 'outline-row-t2', { ...PRIMARY })
    await clickRowWithModifiers(page, 'outline-row-t3', { ...PRIMARY })

    await openTopMenu(page, 'edit')
    await page.getByTestId('delete-task').click()

    await expect.poll(async () => (await readStore(page)).taskCount).toBe(1)
    expect((await readStore(page)).undoLength).toBe(1)

    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await readStore(page)).taskCount).toBe(4)
  })
})

test.describe('⑤ 甘特拖拽只移动被拖的那一根（判据 10）', () => {
  test('多选两根条后拖其中一根，另一根日期不变', async ({ page }) => {
    await loadFixture(
      page,
      makeProject({
        tasks: [
          { id: 't1', name: 'T1', duration: 3 },
          { id: 't2', name: 'T2', duration: 3 },
        ],
      }),
    )
    await clickRowWithModifiers(page, 'outline-row-t1', {})
    await clickRowWithModifiers(page, 'outline-row-t2', { ...PRIMARY })

    const before = (await readSchedules(page)).schedules

    await dragBar(page, 'task-bar-t1', 96)

    const after = (await readSchedules(page)).schedules
    // 被拖的那一根确实动了（否则「另一根没动」是恒真的假绿）
    expect(after.t1.scheduledStart).not.toBe(before.t1.scheduledStart)
    // 另一根不受牵连
    expect(after.t2.scheduledStart).toBe(before.t2.scheduledStart)
    expect(after.t2.scheduledFinish).toBe(before.t2.scheduledFinish)
  })
})

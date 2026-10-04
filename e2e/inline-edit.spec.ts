import { test, expect } from '@playwright/test'
import { chainProject, loadFixture, switchView } from './helpers'

/**
 * 大纲视图字段单元格内联编辑（spec「测试计划」）。
 *
 * 夹具 `chainProject()` 的默认可见列 = title / start / finish / duration / progress
 * （见 `DEFAULT_VISIBLE_COLUMNS`），文本（title）/ 数字（progress）/ 日期（start）
 * 各取其一即覆盖三类编辑器。断言按中文文案 / 中文数字格式（Playwright 固定 locale=zh-CN）。
 *
 * 进入编辑：双击显示态 span；提交：回车（或 blur）；取消：Escape；`Ctrl+Z` 撤销。
 * testid：显示态 `outline-title-<id>`（title 特例）/ `outline-edit-<key>-<id>`（其余），
 * 编辑态 `outline-title-input-<id>` / `outline-edit-input-<key>-<id>`，外层单元格
 * `outline-cell-<key>-<id>`。
 */
test.describe('大纲单元格内联编辑', () => {
  test('文本：双击标题改名 → 回车 → 单元格更新；Ctrl+Z 复原', async ({ page }) => {
    await loadFixture(page, chainProject())
    await switchView(page, 'outline')

    await page.locator('[data-testid="outline-title-t1"]').dblclick()
    const input = page.locator('[data-testid="outline-title-input-t1"]')
    await input.fill('新任务名')
    await input.press('Enter')

    await expect(page.locator('[data-testid="outline-title-t1"]')).toHaveText('新任务名')

    await page.keyboard.press('Control+z')
    await expect(page.locator('[data-testid="outline-title-t1"]')).toHaveText('任务 1')
  })

  test('数字：双击进度输 150 → 回车 → clamp 显示 100%；Ctrl+Z 复原', async ({ page }) => {
    await loadFixture(page, chainProject())
    await switchView(page, 'outline')

    // t1 默认进度 0%
    await expect(page.locator('[data-testid="outline-cell-progress-t1"]')).toHaveText('0%')

    await page.locator('[data-testid="outline-edit-progress-t1"]').dblclick()
    const input = page.locator('[data-testid="outline-edit-input-progress-t1"]')
    await input.fill('150')
    await input.press('Enter')

    // 越界由命令层归一（clamp 0–100），不是编辑器本地拦 —— 显示真值 100%
    await expect(page.locator('[data-testid="outline-cell-progress-t1"]')).toHaveText('100%')

    await page.keyboard.press('Control+z')
    await expect(page.locator('[data-testid="outline-cell-progress-t1"]')).toHaveText('0%')
  })

  test('日期：双击开始输新日期 → 回车 → 单元格更新；Ctrl+Z 复原', async ({ page }) => {
    await loadFixture(page, chainProject())
    await switchView(page, 'outline')

    // chainProject 起点 2026-03-02（周一），t1 首日即它
    await expect(page.locator('[data-testid="outline-cell-start-t1"]')).toHaveText('2026-03-02')

    await page.locator('[data-testid="outline-edit-start-t1"]').dblclick()
    const input = page.locator('[data-testid="outline-edit-input-start-t1"]')
    await input.fill('2026-03-05')
    await input.press('Enter')

    await expect(page.locator('[data-testid="outline-cell-start-t1"]')).toHaveText('2026-03-05')

    await page.keyboard.press('Control+z')
    await expect(page.locator('[data-testid="outline-cell-start-t1"]')).toHaveText('2026-03-02')
  })

  test('只读回归：双击 id 列不出现编辑输入框', async ({ page }) => {
    await loadFixture(page, chainProject())
    await switchView(page, 'outline')

    // 打开 id 列（默认不可见）：右键表头 → 勾选 id
    await page.locator('[data-testid="outline-table-header"]').click({ button: 'right' })
    await page.locator('[data-testid="column-menu-item-id"]').click()

    await page.locator('[data-testid="outline-cell-id-t1"]').dblclick()
    await expect(page.locator('[data-testid="outline-edit-input-id-t1"]')).toHaveCount(0)
    // id 单元格文本仍在（没有被编辑态替换）
    await expect(page.locator('[data-testid="outline-cell-id-t1"]')).toHaveText('t1')
  })
})

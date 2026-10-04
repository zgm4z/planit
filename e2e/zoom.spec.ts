import { test, expect } from '@playwright/test'
import { loadFixture, makeProject, readGanttMetrics } from './helpers'

/** 一个小项目：两条任务 + 一条依赖，足以渲染甘特与依赖层。 */
const miniProject = () =>
  makeProject({
    name: '连续缩放',
    startDate: '2026-03-02',
    tasks: [
      { id: 't1', name: 'T1', duration: 5 },
      { id: 't2', name: 'T2', duration: 8 },
    ],
    deps: [{ id: 'd1', from: 't1', to: 't2', type: 'FS' }],
  })

test.describe('时间轴连续缩放', () => {
  test('默认 dayWidth=32；日/周/月预设把 --day-width 精确设为 32/12/4，与 readGanttMetrics 一致', async ({
    page,
  }) => {
    await loadFixture(page, miniProject())

    expect((await readGanttMetrics(page)).dayWidth).toBe(32)

    await page.locator('[data-testid="zoom-preset-week"]').click()
    await expect.poll(async () => (await readGanttMetrics(page)).dayWidth).toBe(12)

    await page.locator('[data-testid="zoom-preset-month"]').click()
    await expect.poll(async () => (await readGanttMetrics(page)).dayWidth).toBe(4)

    await page.locator('[data-testid="zoom-preset-day"]').click()
    await expect.poll(async () => (await readGanttMetrics(page)).dayWidth).toBe(32)
  })

  test('键盘 Ctrl+= 放大到 40、Ctrl+0 复位；--gantt-width 是 --day-width 的整数倍', async ({
    page,
  }) => {
    await loadFixture(page, miniProject())
    const before = await readGanttMetrics(page)

    await page.keyboard.press('Control+=')
    // 非自证：键盘因子 ×1.25 ⇒ 32 → 40，精确落到 DOM 的 --day-width
    await expect
      .poll(async () => (await readGanttMetrics(page)).dayWidth)
      .toBeCloseTo(before.dayWidth * 1.25, 6)

    // 非自证：直接从 DOM 的 CSS 变量读 --gantt-width / --day-width（**不用** readGanttMetrics 的
    // round(paneWidth/dayWidth)，那是自证）。二者之比必须是整数（总天数），且 ≥ 60（时间轴至少铺 60 天）。
    const { dayWidth, ganttWidth, rawDays, paneWidth } = await page.evaluate(() => {
      const grid = document.querySelector('[data-testid="outline-column"]')!
        .parentElement as HTMLElement
      const dayWidth = Number.parseFloat(grid.style.getPropertyValue('--day-width'))
      const ganttWidth = Number.parseFloat(grid.style.getPropertyValue('--gantt-width'))
      const pane = document.querySelector('[data-testid="gantt-pane"]') as HTMLElement
      return { dayWidth, ganttWidth, rawDays: ganttWidth / dayWidth, paneWidth: pane.getBoundingClientRect().width }
    })
    const totalDays = Math.round(rawDays)
    expect(Math.abs(rawDays - totalDays)).toBeLessThan(1e-6) // ganttWidth 是 dayWidth 的整数倍
    expect(totalDays).toBeGreaterThanOrEqual(60)
    expect(ganttWidth).toBeCloseTo(dayWidth * totalDays, 4)
    // 声明的列宽必须等于实际渲染宽度（CSS 变量真的驱动了布局）
    expect(Math.abs(ganttWidth - paneWidth)).toBeLessThanOrEqual(1)

    await page.keyboard.press('Control+0')
    await expect.poll(async () => (await readGanttMetrics(page)).dayWidth).toBe(32)
  })

  test('标尺上左拖变宽、右拖变窄', async ({ page }) => {
    await loadFixture(page, miniProject())
    const before = await readGanttMetrics(page)

    const ruler = page.locator('[data-testid="gantt-ruler"]')
    const box = (await ruler.boundingBox())!
    // 标尺的实际宽度 = 总天数 × dayWidth（本用例 ≥ 60 天 ⇒ ≥ 1920px），**远宽于视口**，
    // 其包围盒在视口右侧被裁掉；**包围盒中心**（box.x + box.width/2）更是落在右侧
    // Inspector 面板之下 —— `page.mouse.down()` 会命中面板而非标尺，拖拽根本收不到
    // pointerdown（症状：dayWidth 恒为 32，纹丝不动）。故取标尺**可见区左侧**一点作起点：
    // 仍在甘特区、且在视口内，hit-test 命中标尺本身（标尺内容 pointer-events:none，
    // 事件落回 .ruler）。左拖 120px 后 x 仍 ≥ 甘特区左缘，不越界到大纲列。
    const y = box.y + 10
    const startX = box.x + 160

    await page.mouse.move(startX, y)
    await page.mouse.down()
    await page.mouse.move(startX - 120, y, { steps: 8 }) // 左拖 ⇒ 变宽
    await page.mouse.up()
    await expect
      .poll(async () => (await readGanttMetrics(page)).dayWidth)
      .toBeGreaterThan(before.dayWidth)

    const widened = await readGanttMetrics(page)
    await page.mouse.move(startX, y)
    await page.mouse.down()
    await page.mouse.move(startX + 120, y, { steps: 8 }) // 右拖 ⇒ 变窄
    await page.mouse.up()
    await expect
      .poll(async () => (await readGanttMetrics(page)).dayWidth)
      .toBeLessThan(widened.dayWidth)
  })

  test('Ctrl+滚轮停在连续值：--day-width 非 32/12/4，且没有预设段被勾选', async ({ page }) => {
    await loadFixture(page, miniProject())

    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="shared-scroll"]') as HTMLElement
      el.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -140,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    })

    await expect
      .poll(async () => (await readGanttMetrics(page)).dayWidth)
      .not.toBe(32)
    const { dayWidth } = await readGanttMetrics(page)
    expect([32, 12, 4]).not.toContain(dayWidth)

    // 分段控件：value='' 时不勾选任何段（Mantine 渲染隐藏的 radio input）
    const checked = await page
      .locator('[data-testid="zoom-switcher"] input[type="radio"]:checked')
      .count()
    expect(checked).toBe(0)
  })
})

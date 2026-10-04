import { test, expect, type Page } from '@playwright/test'
import { dragBar, loadFixture, makeProject, readStore } from './helpers'

/**
 * 「甘特条显示已分配资源名」的 e2e 验收（spec 2026-10-04）。
 *
 * 三条戒律同 resources.spec.ts：看得见就断言可见；期望值从 DOM / store 独立读出，
 * 不 import timeline.ts / 引擎；测对元素（data-testid 精确定位那一根条 / 那一个药丸）。
 * 几何断言一律走 getBoundingClientRect，不 import 被测常量。
 */

/** 资源声明序 r1(张三) → r2(李四) → r3(王五)，分配插入序刻意相反 —— 用来区分两种顺序 */
function orderedFixture() {
  return makeProject({
    tasks: [{ id: 't1', name: '写文档', duration: 5 }],
    resources: [
      { id: 'r1', name: '张三' },
      { id: 'r2', name: '李四' },
      { id: 'r3', name: '王五' },
    ],
    assignments: [
      { id: 'a1', task: 't1', resource: 'r3', units: 1 },
      { id: 'a2', task: 't1', resource: 'r1', units: 1 },
      { id: 'a3', task: 't1', resource: 'r2', units: 1 },
    ],
  })
}

/** 4 个长名 + 1 天工期 → 药丸必被省略号截断 */
function overflowFixture() {
  const names = ['资源甲乙丙丁', '资源戊己庚辛', '资源壬癸子丑', '资源寅卯辰巳']
  return makeProject({
    tasks: [{ id: 't1', name: '短', duration: 1 }],
    resources: names.map((name, i) => ({ id: `r${i + 1}`, name })),
    assignments: names.map((_, i) => ({ id: `a${i + 1}`, task: 't1', resource: `r${i + 1}` })),
  })
}

/**
 * 两条**互不依赖**的任务、行相邻：t2 更长 → 决定项目终点 → 关键（条高 20）；
 * t1 更短 → 有浮时 → 非关键（条高 18）。
 *
 * 注意：这里刻意**不用** FS 链（t1→t2）。纯链上每个任务的总浮时都是 0，
 * 两条都会是关键的，拿不到「18 / 20 两种条高」的对照。
 */
function mixedCriticalityFixture() {
  return makeProject({
    tasks: [
      { id: 't1', name: '短', duration: 2 },
      { id: 't2', name: '长', duration: 5 },
    ],
    resources: [
      { id: 'r1', name: '张三' },
      { id: 'r2', name: '李四' },
    ],
    assignments: [
      { id: 'a1', task: 't1', resource: 'r1' },
      { id: 'a2', task: 't2', resource: 'r2' },
    ],
  })
}

test.describe('§1/§2 条内文本与顺序', () => {
  test('名字按资源声明序排列，条宽足够时完整显示（无省略号）', async ({ page }) => {
    await loadFixture(page, orderedFixture())
    const label = page.locator('[data-testid="task-bar-label-t1"]')
    await expect(label).toBeVisible()
    // 声明序 r1,r2,r3 = 张三、李四、王五（不是分配插入序 r3,r1,r2）
    await expect(label).toHaveText('张三、李四、王五')

    const { scrollWidth, clientWidth } = await label.locator('span').evaluate((el) => ({
      scrollWidth: (el as HTMLElement).scrollWidth,
      clientWidth: (el as HTMLElement).clientWidth,
    }))
    expect(scrollWidth, `scrollWidth=${scrollWidth} clientWidth=${clientWidth}`).toBeLessThanOrEqual(
      clientWidth,
    )
  })

  test('条宽不足时省略号生效（scrollWidth > clientWidth），title 含完整名单', async ({ page }) => {
    await loadFixture(page, overflowFixture())
    const pill = page.locator('[data-testid="task-bar-label-t1"] span')
    const { scrollWidth, clientWidth } = await pill.evaluate((el) => ({
      scrollWidth: (el as HTMLElement).scrollWidth,
      clientWidth: (el as HTMLElement).clientWidth,
    }))
    expect(scrollWidth, `scrollWidth=${scrollWidth} clientWidth=${clientWidth}`).toBeGreaterThan(
      clientWidth,
    )

    // 悬停清单（原生 title）必须逐字含全部四个名字
    await expect(page.locator('[data-testid="task-bar-t1"]')).toHaveAttribute(
      'title',
      expect.stringContaining('已分配：资源甲乙丙丁、资源戊己庚辛、资源壬癸子丑、资源寅卯辰巳'),
    )
  })
})

test.describe('§9 无分配 / 悬空分配', () => {
  test('任务无分配时不渲染 .barLabel，title 也不含名字行', async ({ page }) => {
    await loadFixture(
      page,
      makeProject({ tasks: [{ id: 't1', name: '无分配', duration: 2 }] }),
    )
    await expect(page.locator('[data-testid="task-bar-label-t1"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="task-bar-t1"]')).not.toHaveAttribute(
      'title',
      /已分配/,
    )
  })

  test('悬空分配（resourceId 指向已删资源）不产生名字 → 视同无分配', async ({ page }) => {
    await loadFixture(
      page,
      makeProject({
        tasks: [{ id: 't1', name: '悬空', duration: 2 }],
        assignments: [{ id: 'a1', task: 't1', resource: 'rX', units: 1 }],
      }),
    )
    await expect(page.locator('[data-testid="task-bar-label-t1"]')).toHaveCount(0)
  })
})

test.describe('§8 里程碑', () => {
  test('菱形无文字子节点，但 title 含完整名单', async ({ page }) => {
    await loadFixture(
      page,
      makeProject({
        tasks: [{ id: 'm1', name: '里程碑', kind: 'milestone' }],
        resources: [{ id: 'r1', name: '张三' }],
        assignments: [{ id: 'a1', task: 'm1', resource: 'r1' }],
      }),
    )
    const marker = page.locator('[data-testid="task-milestone-m1"]')
    await expect(marker).toBeVisible()
    await expect(marker).toHaveText('')
    await expect(marker).toHaveAttribute('title', expect.stringContaining('已分配：张三'))
  })
})

test.describe('§3/§8 几何与连接柄', () => {
  test('条高恒为 18（关键条 20）、行高恒为 30', async ({ page }) => {
    await loadFixture(page, mixedCriticalityFixture())

    const normalHeight = await page
      .locator('[data-testid="task-bar-t1"]')
      .evaluate((el) => el.getBoundingClientRect().height)
    const criticalHeight = await page
      .locator('[data-testid="task-bar-t2"]')
      .evaluate((el) => el.getBoundingClientRect().height)
    expect(Math.round(normalHeight)).toBe(18)
    expect(Math.round(criticalHeight)).toBe(20)

    const { top1, top2 } = await page.evaluate(() => ({
      top1: document.querySelector('[data-gantt-row="t1"]')!.getBoundingClientRect().top,
      top2: document.querySelector('[data-gantt-row="t2"]')!.getBoundingClientRect().top,
    }))
    expect(Math.round(top2 - top1)).toBe(30)
  })

  test('.link-handle 仍在条外（.bar 不裁剪）', async ({ page }) => {
    await loadFixture(page, mixedCriticalityFixture())
    const { barRight, handleRight } = await page.evaluate(() => ({
      barRight: document.querySelector('[data-testid="task-bar-t1"]')!.getBoundingClientRect().right,
      handleRight: document
        .querySelector('[data-testid="link-handle-t1"]')!
        .getBoundingClientRect().right,
    }))
    expect(handleRight).toBeGreaterThan(barRight)
  })
})

test.describe('§9 .barLabel 不拦截指针', () => {
  test('在条中心（名字文字上）按下拖动，仍触发任务条拖拽并落 manual', async ({ page }) => {
    await loadFixture(page, orderedFixture())
    // 条中心由 .barLabel（inset:0，覆盖整条）占据 —— 它 pointer-events:none，
    // 事件穿透到 .bar，故拖拽仍从条中心发起
    await dragBar(page, 'task-bar-t1', 40)
    const scheduling = (await readStore(page)).schedulingOfT1 as { mode: string }
    expect(scheduling.mode).toBe('manual')
  })
})

test.describe('§5 对比度（白字对合成底 ≥ 4.5:1，普通条与关键条均满足）', () => {
  /** 在页面内合成 .barLabelText 的 rgba 底衬与条底色，返回前景/背景对比度（WCAG 2.x） */
  async function labelContrast(page: Page, taskId: string): Promise<number> {
    return page
      .locator(`[data-testid="task-bar-label-${taskId}"] span`)
      .evaluate((span, barId) => {
        const parse = (value: string): number[] =>
          (value.match(/[\d.]+/g) ?? []).map(Number)
        const label = span as HTMLElement
        const bar = document.querySelector(`[data-testid="${barId}"]`) as HTMLElement
        const fg = parse(getComputedStyle(label).color)
        const pill = parse(getComputedStyle(label).backgroundColor)
        const base = parse(getComputedStyle(bar).backgroundColor)
        const alpha = pill[3] ?? 1
        const composed = [0, 1, 2].map((i) => pill[i] * alpha + base[i] * (1 - alpha))
        const lin = (c: number): number => {
          const s = c / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        }
        const lum = (rgb: number[]): number =>
          0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
        const [l1, l2] = [lum(fg), lum(composed)].sort((a, b) => b - a)
        return (l1 + 0.05) / (l2 + 0.05)
      }, `task-bar-${taskId}`)
  }

  test('普通条（t1）与关键条（t2）的条内文字对比度均达标', async ({ page }) => {
    await loadFixture(page, mixedCriticalityFixture())
    expect(await labelContrast(page, 't1')).toBeGreaterThanOrEqual(4.5)
    expect(await labelContrast(page, 't2')).toBeGreaterThanOrEqual(4.5)
  })
})

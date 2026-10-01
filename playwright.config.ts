import { defineConfig } from '@playwright/test'

/**
 * 端到端验收（Task 21）。
 *
 * 这些测试跑在**真实的 Vite dev server** 上，并沿用前 9 个 UI 任务的验收约定：
 * 通过 `page.evaluate` 动态 import `/src/...` 下的模块，直接驱动 Zustand store
 * 与读取 DOM 几何 —— 这是把那些「临时 browser_evaluate 断言」固化下来的手段。
 *
 * `--strictPort` 不能省：端口被占用时 Vite 默认会静默换到 5175，
 * 而测试仍指向 5174 —— 你会对着一个旧页面做断言还看不出来。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // 单 worker：压测（1000 任务）与帧率测量需要独占主线程，并行会互相干扰；
  // 且所有测试都指向同一个 dev server。
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    // 固定 locale，让 i18n 的语言自动探测结果稳定（否则跟随浏览器默认值，
    // 中文环境下可能变成英文界面，断言文案会漂）
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: 'pnpm dev --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})

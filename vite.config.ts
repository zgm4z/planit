/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  css: {
    modules: {
      // 用 camelCase 生成类名，避免 styles['task-bar'] 这种别扭写法
      localsConvention: 'camelCaseOnly',
    },
    preprocessorOptions: {
      scss: {
        // 让所有 .module.scss 都能直接用令牌变量与 mixin，不必逐个 @use。
        // 指向 src/ui/styles/_tokens.scss（下划线前缀让 Sass 视为 partial）。
        additionalData: `@use "${new URL('./src/ui/styles/_tokens', import.meta.url).pathname}" as *;`,
      },
    },
  },
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: true,
    // 固定一个非 UTC 时区：dateUtils 的时区正确性只有在本地偏移非零时才可验证，
    // 而 CI 容器默认是 UTC，不固定就会让相关测试静默失效
    env: { TZ: 'America/New_York' },
  },
})

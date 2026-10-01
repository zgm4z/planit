/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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

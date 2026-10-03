/// <reference types="vitest/config" />
import {configDefaults, defineConfig} from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5174
    },
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
        alias: {'@': new URL('./src', import.meta.url).pathname},
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./vitest.setup.ts'],
        css: true,
        // e2e/ 下是 Playwright 的 spec（浏览器里跑，靠 dev server），
        // vitest 的默认 include 会把 *.spec.ts 一并捞进来，必须排除
        //
        // .worktrees/ 下每个 worktree 都是本仓库的完整副本（含自己的 e2e/）。
        // 上面的 'e2e/**' 锚定仓库根目录，匹配不到副本里的 '<worktree>/e2e/**'，
        // 于是根目录跑测试会把副本的 Playwright spec 当单测收进来 —— 表现为
        // 「15 failed」但 Tests 行零失败（真实测试全绿）的假红。必须显式排除。
        exclude: [...configDefaults.exclude, 'e2e/**', '.worktrees/**'],
        // 固定一个非 UTC 时区：dateUtils 的时区正确性只有在本地偏移非零时才可验证，
        // 而 CI 容器默认是 UTC，不固定就会让相关测试静默失效
        env: {TZ: 'America/New_York'},
    },
})

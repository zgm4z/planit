/**
 * e2e 测试在**浏览器**里用 `page.evaluate(() => import('/src/...'))` 动态加载
 * 模块。这些 specifier 是 Vite dev server 在运行时提供的 **URL**，不是 TypeScript
 * 的模块路径 —— 若不加声明，tsc 会按文件路径去解析并报 TS2307。
 *
 * 这里把它们声明为「运行时模块」：模块本身没有静态类型，真正的形状由**调用点**的
 * `as { ... }` 断言给出（每个 `await import(...) as {...}` 都写明了用到的成员）。
 * 这样既能通过 typecheck，又不会把调用点退化成无约束的 any。
 *
 * 注意 `/scripts/*`：`scripts/seedLargeProject.ts` 同样只在 dev server 下按 URL 加载。
 */
declare module '/src/*'
declare module '/scripts/*'

import '@testing-library/jest-dom/vitest'

// jsdom 30 的 window 上存在 matchMedia 属性，但值是 undefined。
// Mantine 的颜色方案代码用 `'matchMedia' in window` 做能力探测，这个守卫在
// 上述情况下会放行，紧接着调用就抛 "window.matchMedia is not a function"。
// 任何 <MantineProvider> 的渲染都会因此崩掉，所以在测试入口补一个最小实现。
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia
}

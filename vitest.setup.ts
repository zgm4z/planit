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

// jsdom 不实现 ResizeObserver，而 Mantine 的 ScrollArea（Select / Popover 的
// 下拉容器都用它）在 layout effect 里会构造一个。缺了它任何含下拉的
// Mantine 组件都会在挂载时抛 "ResizeObserver is not defined"。
// jsdom 也不实现 scrollIntoView，而 Mantine 的 Combobox 在展开下拉时会调用它
// 把高亮项滚进视野 —— 抛错会直接中断「点击 → 展开 → 选选项」的整条链路。
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

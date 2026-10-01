import { createTheme, type MantineColorsTuple } from '@mantine/core'

// 品牌色 = 设计规范 §4.1 的「工作色」靛蓝（--planit-work）。Mantine 需要一组
// 十档色板，这里以 indigo 为基准构造，明暗关系与我们的 CSS 变量一致。
const brand: MantineColorsTuple = [
  '#eef2ff',
  '#e0e7ff',
  '#c7d2fe',
  '#a5b4fc',
  '#818cf8',
  '#6366f1',
  '#4f46e5',
  '#4338ca',
  '#3730a3',
  '#312e81',
]

export const theme = createTheme({
  primaryColor: 'brand',
  colors: { brand },
  defaultRadius: 'md',
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  // 与 global.scss 的字号阶对齐（§1.1：10 / 11 / 12 / 13 / 15 / 18）。
  // Mantine 只有五档键位，micro(10) 无对应槽位，留给纯 CSS 的列头使用。
  fontSizes: {
    xs: '11px',
    sm: '12px',
    md: '13px',
    lg: '15px',
    xl: '18px',
  },
  // 与 §2.1 的间距阶对齐（2 / 4 / 6 / 8 / 12 / 16 / 24 / 32）。
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
  },
})

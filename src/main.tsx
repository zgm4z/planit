import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// i18n 必须在 App 之前初始化，否则 useTranslation 会在 init 完成前调用
import './i18n'
// 设计令牌（:root CSS 变量）—— 一次性输出，先于组件样式生效
import './ui/styles/global.scss'
import App from './ui/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// i18n 必须在 App 之前初始化，否则 useTranslation 会在 init 完成前调用
import './i18n'
import App from './ui/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { startDesktopUpdater } from './core/platform/desktop-updater'
import '@natnaelkahssay/card-stack-3d/styles.css'
import './style.css'

startDesktopUpdater()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

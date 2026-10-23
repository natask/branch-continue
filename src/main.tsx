import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { startDesktopUpdater } from './core/platform/desktop-updater'
import { startMobileOtaRedirect } from './core/platform/mobile-ota'
import '@natnaelkahssay/card-stack-3d/styles.css'
import './style.css'

// Desktop installs remain local-only. Mobile shells and published mobile pages
// opt into the configured OTA lane and retain their embedded offline fallback.
const deploymentUpdatesEnabled = false
if (deploymentUpdatesEnabled) {
  startDesktopUpdater()
}
startMobileOtaRedirect()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

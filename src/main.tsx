import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { startDesktopUpdater } from './core/platform/desktop-updater'
import { startMobileOtaRedirect } from './core/platform/mobile-ota'
import '@natnaelkahssay/card-stack-3d/styles.css'
import './style.css'

// Branch Continue currently ships as a local-only desktop app. Keep the
// existing update implementations intact until their deletion is approved,
// but do not contact or redirect to deployment infrastructure at startup.
const deploymentUpdatesEnabled = false
if (deploymentUpdatesEnabled) {
  startDesktopUpdater()
  startMobileOtaRedirect()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

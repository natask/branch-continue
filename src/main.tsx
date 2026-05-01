import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@natnaelkahssay/card-stack-3d/styles.css'
import './style.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

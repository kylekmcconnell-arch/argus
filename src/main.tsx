import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthGate } from './auth.tsx'
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx'
import { SessionExpiryNotice } from './components/SessionExpiryNotice.tsx'
import { installSessionExpiryWatch } from './lib/sessionExpiry.ts'

// Observe 401s from ARGUS API routes so an expired session is stated once
// instead of surfacing as a page of quietly dead panels.
installSessionExpiryWatch(window)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <AuthGate>
        <SessionExpiryNotice />
        <App />
      </AuthGate>
    </AppErrorBoundary>
  </StrictMode>,
)

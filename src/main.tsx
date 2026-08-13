import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthGate } from './auth.tsx'
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx'
import { SessionExpiryNotice } from './components/SessionExpiryNotice.tsx'
import { installSessionExpiryWatch } from './lib/sessionExpiry.ts'
import { installPrintTheme } from './lib/printTheme.ts'

// Development-only visual harness. It is lazy so the fixture never rejoins the production report chunk.
// eslint-disable-next-line react-refresh/only-export-components
const ArgusEyePreview = lazy(() => import('./dev/ArgusEyePreview.tsx').then((module) => ({ default: module.ArgusEyePreview })))

// Observe 401s from ARGUS API routes so an expired session is stated once
// instead of surfacing as a page of quietly dead panels.
installSessionExpiryWatch(window)

// Export-PDF prints the light (website-default) theme regardless of the
// on-screen choice, restoring it after the print pass.
installPrintTheme(window)

const showArgusEyePreview = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('design-preview') === 'argus-eye'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      {showArgusEyePreview ? (
        <Suspense fallback={null}><ArgusEyePreview /></Suspense>
      ) : (
        <AuthGate>
          <SessionExpiryNotice />
          <App />
        </AuthGate>
      )}
    </AppErrorBoundary>
  </StrictMode>,
)

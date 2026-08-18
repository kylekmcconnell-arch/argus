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
// eslint-disable-next-line react-refresh/only-export-components
const ProvenancePreview = lazy(() => import('./dev/ProvenancePreview.tsx').then((module) => ({ default: module.ProvenancePreview })))
// eslint-disable-next-line react-refresh/only-export-components
const DossierPreview = lazy(() => import('./dev/DossierPreview.tsx').then((module) => ({ default: module.DossierPreview })))
// eslint-disable-next-line react-refresh/only-export-components
const CompositionPreview = lazy(() => import('./dev/CompositionPreview.tsx').then((module) => ({ default: module.CompositionPreview })))

// Observe 401s from ARGUS API routes so an expired session is stated once
// instead of surfacing as a page of quietly dead panels.
installSessionExpiryWatch(window)

// Export-PDF prints the light (website-default) theme regardless of the
// on-screen choice, restoring it after the print pass.
installPrintTheme(window)

const designPreview = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('design-preview')
  : null
const showArgusEyePreview = designPreview === 'argus-eye'
const showProvenancePreview = designPreview === 'provenance'

// A share capability opens the read-only report view with no account and no
// AuthGate: the token is the entire authority, validated server-side.
const sharedReportToken = new URLSearchParams(window.location.search).get('share')
// eslint-disable-next-line react-refresh/only-export-components
const SharedReportView = lazy(() => import('./components/SharedReportView.tsx').then((module) => ({ default: module.SharedReportView })))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      {showArgusEyePreview ? (
        <Suspense fallback={null}><ArgusEyePreview /></Suspense>
      ) : showProvenancePreview ? (
        <Suspense fallback={null}><ProvenancePreview /></Suspense>
      ) : designPreview === 'dossier' ? (
        <Suspense fallback={null}><DossierPreview /></Suspense>
      ) : designPreview === 'composition' ? (
        <Suspense fallback={null}><CompositionPreview /></Suspense>
      ) : sharedReportToken ? (
        <Suspense fallback={null}><SharedReportView token={sharedReportToken} /></Suspense>
      ) : (
        <AuthGate>
          <SessionExpiryNotice />
          <App />
        </AuthGate>
      )}
    </AppErrorBoundary>
  </StrictMode>,
)

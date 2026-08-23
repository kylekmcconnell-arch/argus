import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthGate } from './auth.tsx'
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx'
import { SessionExpiryNotice } from './components/SessionExpiryNotice.tsx'
import { FeedbackButton } from './components/FeedbackButton.tsx'
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
// eslint-disable-next-line react-refresh/only-export-components
const ReferralsPreview = lazy(() => import('./dev/ReferralsPreview.tsx').then((module) => ({ default: module.ReferralsPreview })))
// eslint-disable-next-line react-refresh/only-export-components
const IntelligenceReportPreview = lazy(() => import('./dev/IntelligenceReportPreview.tsx').then((module) => ({ default: module.IntelligenceReportPreview })))
// eslint-disable-next-line react-refresh/only-export-components
const ProvidersPreview = lazy(() => import('./dev/ProvidersPreview.tsx').then((module) => ({ default: module.ProvidersPreview })))
// eslint-disable-next-line react-refresh/only-export-components
const LandingPreview = lazy(() => import('./dev/LandingPreview.tsx').then((module) => ({ default: module.LandingPreview })))
// eslint-disable-next-line react-refresh/only-export-components
const ResearchLoadingPreview = lazy(() => import('./dev/ResearchLoadingPreview.tsx').then((module) => ({ default: module.ResearchLoadingPreview })))
// eslint-disable-next-line react-refresh/only-export-components
const SocialActivityPreview = lazy(() => import('./dev/SocialActivityPreview.tsx').then((module) => ({ default: module.SocialActivityPreview })))
// eslint-disable-next-line react-refresh/only-export-components
const NavigationConsolidationPreview = lazy(() => import('./dev/NavigationConsolidationPreview.tsx').then((module) => ({ default: module.NavigationConsolidationPreview })))
// eslint-disable-next-line react-refresh/only-export-components
const PublicAccessPreview = lazy(() => import('./dev/PublicAccessPreview.tsx').then((module) => ({ default: module.PublicAccessPreview })))

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
const publicView = new URLSearchParams(window.location.search).get('view')
// eslint-disable-next-line react-refresh/only-export-components
const SharedReportView = lazy(() => import('./components/SharedReportView.tsx').then((module) => ({ default: module.SharedReportView })))
// eslint-disable-next-line react-refresh/only-export-components
const PublicLeaderboardPage = lazy(() => import('./components/PublicGrowthPages.tsx').then((module) => ({ default: module.PublicLeaderboardPage })))
// eslint-disable-next-line react-refresh/only-export-components
const PublicPricingPage = lazy(() => import('./components/PublicGrowthPages.tsx').then((module) => ({ default: module.PublicPricingPage })))
// eslint-disable-next-line react-refresh/only-export-components
const JoinPage = lazy(() => import('./components/PublicGrowthPages.tsx').then((module) => ({ default: module.JoinPage })))

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
      ) : designPreview === 'referrals' ? (
        <Suspense fallback={null}><ReferralsPreview /></Suspense>
      ) : designPreview === 'intelligence-report' ? (
        <Suspense fallback={null}><IntelligenceReportPreview /></Suspense>
      ) : designPreview === 'providers' ? (
        <Suspense fallback={null}><ProvidersPreview /></Suspense>
      ) : designPreview === 'landing' ? (
        <Suspense fallback={null}><LandingPreview /></Suspense>
      ) : designPreview === 'research-loading' ? (
        <Suspense fallback={null}><ResearchLoadingPreview /></Suspense>
      ) : designPreview === 'social-activity' ? (
        <Suspense fallback={null}><SocialActivityPreview /></Suspense>
      ) : designPreview === 'navigation-consolidation' ? (
        <Suspense fallback={null}><NavigationConsolidationPreview /></Suspense>
      ) : designPreview === 'public-access' ? (
        <Suspense fallback={null}><PublicAccessPreview /></Suspense>
      ) : sharedReportToken ? (
        <Suspense fallback={null}><SharedReportView token={sharedReportToken} /></Suspense>
      ) : publicView === 'leaderboard' ? (
        <Suspense fallback={null}><PublicLeaderboardPage /></Suspense>
      ) : publicView === 'pricing' ? (
        <Suspense fallback={null}><PublicPricingPage /></Suspense>
      ) : publicView === 'join' ? (
        <Suspense fallback={null}><JoinPage /></Suspense>
      ) : (
        <AuthGate>
          <SessionExpiryNotice />
          <FeedbackButton />
          <App />
        </AuthGate>
      )}
    </AppErrorBoundary>
  </StrictMode>,
)

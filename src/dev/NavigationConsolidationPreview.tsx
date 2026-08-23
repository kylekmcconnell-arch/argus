import { AuthContext } from "../auth-context";
import { AppShell } from "../components/AppShell";
import { WatchlistPage } from "../components/WatchlistPage";
import type { Alert } from "../components/AlertsPage";

const SAMPLE_ALERTS: Alert[] = [
  {
    ref: "preview-alert-1",
    subject: "$FOLD",
    label: "$FOLD",
    type: "drift",
    detail: "Liquidity is 31% below the saved baseline. Open the case before treating the earlier report as current.",
    at: Date.now() - 18 * 60 * 1000,
  },
  {
    ref: "preview-alert-2",
    subject: "@examplefounder",
    label: "Example founder",
    type: "ring",
    detail: "A new connection to a previously flagged wallet appeared in the shared graph.",
    at: Date.now() - 2 * 60 * 60 * 1000,
  },
];

const loadPreviewAlerts = async () => SAMPLE_ALERTS;

export function NavigationConsolidationPreview() {
  return (
    <AuthContext.Provider value={{
      user: { id: "preview-kyle", email: "kyle@example.com", displayName: "Kyle" },
      organizationId: "preview-argus",
      role: "owner",
      signOut: async () => undefined,
    }}>
      <AppShell onNav={() => undefined} onAudit={() => undefined} view="watchlist">
        <WatchlistPage onAudit={() => undefined} alertsLoader={loadPreviewAlerts} />
      </AppShell>
    </AuthContext.Provider>
  );
}

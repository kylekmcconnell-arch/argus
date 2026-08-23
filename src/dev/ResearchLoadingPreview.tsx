import { AuthContext } from "../auth-context";
import { AppShell } from "../components/AppShell";
import { AuditConsole } from "../components/AuditConsole";
import type { TraceStep } from "../data/evidence";

const previewSteps: TraceStep[] = [
  { phase: "P0 · Intake", label: "Official project identity resolved", detail: "The contract, project account, and published website resolve to the same project identity.", source: "Published project links", tone: "good" },
  { phase: "P1 · Contract", label: "Contract controls reviewed", detail: "Ownership is renounced and no mint authority was observed in the current contract state.", source: "On-chain contract", tone: "good" },
  { phase: "P2 · Liquidity", label: "Liquidity concentration needs review", detail: "Most liquidity-provider tokens are held in one wallet, so the lock and control trail require closer review.", source: "On-chain holders", tone: "warn" },
  { phase: "P3 · Team", label: "One public operator tied to the project", detail: "A source-grounded operator relationship was observed; ARGUS is checking the wider team and control links now.", source: "Published social profile", tone: "neutral" },
];

export function ResearchLoadingPreview() {
  return (
    <AuthContext.Provider value={{
      user: { id: "preview-kyle", email: "kyle@example.com", displayName: "Kyle" },
      organizationId: "preview-argus",
      role: "owner",
      signOut: async () => undefined,
    }}>
      <AppShell onNav={() => undefined} onAudit={() => undefined} activeHandle="$STONKBROKER" view="audit">
        <AuditConsole
          handle="$STONKBROKER"
          subtitle="Token + project investigation · preserving each source for the final decision brief"
          steps={previewSteps}
          working
          mode="live"
          kind="investigation"
          hop="Checking the project's X account"
        />
      </AppShell>
    </AuthContext.Provider>
  );
}

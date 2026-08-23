import { AuthContext } from "../auth-context";
import { AppShell } from "../components/AppShell";
import { ChangelogPage, type ChangelogData } from "../components/ChangelogPage";

const SAMPLE_CHANGELOG: ChangelogData = {
  available: true,
  commits: [
    { sha: "45077bb", subject: "Navigation: consolidate investigation tools", category: "Navigation", author: "Kyle McConnell", email: "kylekmcconnell@gmail.com", login: "kylekmcconnell-arch", date: "2026-08-23T04:12:00Z" },
    { sha: "2f8c8d1", subject: "Reports: make the decision summary easier to understand", category: "Reports", author: "Enigma", email: "enigma@enigma-fund.com", date: "2026-08-23T02:48:00Z" },
    { sha: "8d772a4", subject: "Social: add bounded X activity snapshots", category: "Social", author: "Kyle McConnell", email: "kylekmcconnell@gmail.com", login: "kylekmcconnell-arch", date: "2026-08-22T23:16:00Z" },
    { sha: "31c9b4e", subject: "Referrals: clarify credits and tracked earnings", category: "Referrals", author: "Enigma", email: "enigma@enigma-fund.com", date: "2026-08-22T21:35:00Z" },
    { sha: "72f31de", subject: "Evidence: preserve source-specific capture times", category: "Evidence", author: "Kyle McConnell", email: "kylekmcconnell@gmail.com", login: "kylekmcconnell-arch", date: "2026-08-21T18:02:00Z" },
  ],
};

export function NavigationConsolidationPreview() {
  return (
    <AuthContext.Provider value={{
      user: { id: "preview-kyle", email: "kyle@example.com", displayName: "Kyle" },
      organizationId: "preview-argus",
      role: "owner",
      signOut: async () => undefined,
    }}>
      <AppShell onNav={() => undefined} onAudit={() => undefined} view="changelog">
        <ChangelogPage initialData={SAMPLE_CHANGELOG} />
      </AppShell>
    </AuthContext.Provider>
  );
}

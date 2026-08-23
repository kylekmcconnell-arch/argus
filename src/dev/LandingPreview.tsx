import { AuthContext } from "../auth-context";
import { AppShell } from "../components/AppShell";
import { Landing } from "../components/Landing";

export function LandingPreview() {
  return (
    <AuthContext.Provider value={{
      user: { id: "preview-kyle", email: "kyle@example.com", displayName: "Kyle" },
      organizationId: "preview-argus",
      role: "owner",
      signOut: async () => undefined,
    }}>
      <AppShell onNav={() => undefined} onAudit={() => undefined} view="idle">
        <Landing onAudit={() => undefined} onAbout={() => undefined} />
      </AppShell>
    </AuthContext.Provider>
  );
}

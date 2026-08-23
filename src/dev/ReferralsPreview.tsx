import { ReferralsPage, type ReferralSnapshot } from "../components/ReferralsPage";
import { AppShell } from "../components/AppShell";
import { AuthContext } from "../auth-context";

const previewData: ReferralSnapshot = {
  access: "member",
  credit: { balance: 42 },
  referral: {
    code: "ARGUSKYLE88",
    publicName: "Kyle",
    qualified: 12,
    rank: 3,
    bonusPerQualifiedReferral: 2,
    commission: {
      earnedCents: 47_520,
      creditCents: 11_880,
      cashCents: 35_640,
      payableCashCents: 0,
    },
    revenueShare: {
      commissionPercent: 20,
      creditSplitPercent: 25,
      cashSplitPercent: 75,
      cashPayoutsActive: false,
    },
    leaderboard: [
      { rank: 1, publicName: "Enigma", code: "ENIGMA000001", access: "admitted", qualifiedReferrals: 28, paidReferrals: 14, revshareEarnedCents: 126_720, revsharePercent: 20, creditEarnedCents: 31_680, cashEarnedCents: 95_040, isCurrentUser: false },
      { rank: 2, publicName: "Chain Sleuth", code: "CHAINSLEUTH2", access: "admitted", qualifiedReferrals: 19, paidReferrals: 8, revshareEarnedCents: 71_280, revsharePercent: 20, creditEarnedCents: 17_820, cashEarnedCents: 53_460, isCurrentUser: false },
      { rank: 3, publicName: "Kyle", code: "ARGUSKYLE88", access: "admitted", qualifiedReferrals: 12, paidReferrals: 4, revshareEarnedCents: 47_520, revsharePercent: 20, creditEarnedCents: 11_880, cashEarnedCents: 35_640, isCurrentUser: true },
      { rank: 4, publicName: "Ledger Lens", code: "LEDGERLENS4", access: "waitlist", qualifiedReferrals: 9, paidReferrals: 2, revshareEarnedCents: 17_820, revsharePercent: 20, creditEarnedCents: 4_455, cashEarnedCents: 13_365, isCurrentUser: false },
      { rank: 5, publicName: "Open Evidence", code: "OPENEVIDENCE", access: "waitlist", qualifiedReferrals: 6, paidReferrals: 0, revshareEarnedCents: 0, revsharePercent: 20, creditEarnedCents: 0, cashEarnedCents: 0, isCurrentUser: false },
    ],
  },
};

export function ReferralsPreview() {
  return (
    <AuthContext.Provider value={{
      user: { id: "preview-kyle", email: "kyle@example.com", displayName: "Kyle" },
      organizationId: "preview-argus",
      role: "owner",
      signOut: async () => undefined,
    }}>
      <AppShell onNav={() => undefined} onAudit={() => undefined} view="referrals">
        <ReferralsPage initialData={previewData} />
      </AppShell>
    </AuthContext.Provider>
  );
}

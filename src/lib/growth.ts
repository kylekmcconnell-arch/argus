export const CREDIT_MILLIS = 1_000;
export const STARTING_CREDIT_MILLIS = 10_000;
export const REFERRAL_BONUS_MILLIS = 2_000;
export const REVENUE_SHARE_COMMISSION_BPS = 2_000;
export const CREDIT_SPLIT_PERCENT = 25;
export const CASH_SPLIT_PERCENT = 75;
export const EARLY_ACCESS_DAILY_LIMIT = 3;
export const REFERRAL_CODE = /^[A-Z0-9]{8,20}$/;
export const PUBLIC_NAME_MAX = 40;

export const ARGUS_PLANS = [
  {
    id: "early_access",
    name: "Early access",
    monthlyUsd: 0,
    investigationCredits: 10,
    seats: 1,
    dailyLimit: EARLY_ACCESS_DAILY_LIMIT,
    description: "One-time test budget for admitted testers. No card required.",
  },
  {
    id: "analyst",
    name: "Analyst",
    monthlyUsd: 99,
    investigationCredits: 25,
    seats: 1,
    dailyLimit: 10,
    extraPack: { credits: 10, usd: 39 },
    description: "For an individual investigator running recurring diligence.",
  },
  {
    id: "team",
    name: "Team",
    monthlyUsd: 299,
    investigationCredits: 100,
    seats: 5,
    dailyLimit: 30,
    extraPack: { credits: 10, usd: 35 },
    description: "Shared workspace, pooled credits, and owner controls.",
  },
] as const;

export type ArgusPlan = (typeof ARGUS_PLANS)[number];
export type AccessStatus = "waitlist" | "admitted" | "declined";

export interface RevenueShareSplit {
  commissionPercent: number;
  creditSplitPercent: number;
  cashSplitPercent: number;
  cashPayoutsActive: boolean;
}

export const DEFAULT_REVENUE_SHARE: RevenueShareSplit = {
  commissionPercent: REVENUE_SHARE_COMMISSION_BPS / 100,
  creditSplitPercent: CREDIT_SPLIT_PERCENT,
  cashSplitPercent: CASH_SPLIT_PERCENT,
  cashPayoutsActive: false,
};

export interface GrowthIdentity {
  userId: string;
  publicName: string;
  code: string;
  status: AccessStatus;
  createdAt: string;
}

export interface LeaderboardSourceRow {
  userId: string;
  publicName: string;
  code: string;
  status: AccessStatus;
  createdAt: string;
  qualifiedReferrals: number;
  paidReferrals: number;
  revshareEarnedCents: number;
  creditEarnedCents: number;
  cashEarnedCents: number;
}

export interface LeaderboardRow {
  rank: number;
  publicName: string;
  code: string;
  access: AccessStatus;
  qualifiedReferrals: number;
  paidReferrals: number;
  revshareEarnedCents: number;
  revsharePercent: number;
  creditEarnedCents: number;
  cashEarnedCents: number;
  isCurrentUser: boolean;
  codeTail?: string;
}

export interface CommissionSplit {
  commissionCents: number;
  creditCents: number;
  cashCents: number;
}

export function creditsFromMillis(millis: number): number {
  return Math.max(0, millis) / CREDIT_MILLIS;
}

export function splitSubscriptionCommission(
  subscriptionRevenueCents: number,
  commissionBps = REVENUE_SHARE_COMMISSION_BPS,
): CommissionSplit {
  const revenue = Math.max(0, Math.floor(subscriptionRevenueCents));
  const bps = Math.min(10_000, Math.max(0, Math.floor(commissionBps)));
  const commissionCents = Math.floor((revenue * bps) / 10_000);
  const creditCents = Math.floor((commissionCents * CREDIT_SPLIT_PERCENT) / 100);
  return {
    commissionCents,
    creditCents,
    cashCents: commissionCents - creditCents,
  };
}

export function cleanPublicName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > PUBLIC_NAME_MAX) return null;
  if (/@|:\/\/|[<>]/.test(name)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9 .'_-]*[A-Za-z0-9]$|^[A-Za-z0-9]{2}$/.test(name)) return null;
  return name;
}

export function publicNameFromEmail(email: string): string {
  const local = email.split("@")[0]?.replace(/[._-]+/g, " ").trim() || "Investigator";
  const cleaned = cleanPublicName(local.slice(0, PUBLIC_NAME_MAX));
  return cleaned || "Investigator";
}

export function rankLeaderboard(
  rows: LeaderboardSourceRow[],
  currentUserId?: string,
): LeaderboardRow[] {
  return [...rows]
    .sort((a, b) => {
      if (b.qualifiedReferrals !== a.qualifiedReferrals) {
        return b.qualifiedReferrals - a.qualifiedReferrals;
      }
      const created = a.createdAt.localeCompare(b.createdAt);
      if (created !== 0) return created;
      return a.code.localeCompare(b.code);
    })
    .map((row, index) => ({
      rank: index + 1,
      publicName: row.publicName,
      code: row.code,
      access: row.status,
      qualifiedReferrals: row.qualifiedReferrals,
      paidReferrals: row.paidReferrals,
      revshareEarnedCents: row.revshareEarnedCents,
      revsharePercent: DEFAULT_REVENUE_SHARE.commissionPercent,
      creditEarnedCents: row.creditEarnedCents,
      cashEarnedCents: row.cashEarnedCents,
      isCurrentUser: Boolean(currentUserId && row.userId === currentUserId),
    }));
}

export function publicLeaderboardPayload(rows: LeaderboardRow[]) {
  return rows.map(({ code, ...row }) => ({
    ...row,
    codeTail: code.slice(-4),
  }));
}

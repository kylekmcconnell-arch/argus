import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serviceCredentials } from "./_auth.js";
import {
  ARGUS_PLANS,
  CREDIT_MILLIS,
  DEFAULT_REVENUE_SHARE,
  REFERRAL_BONUS_MILLIS,
  REFERRAL_CODE,
  STARTING_CREDIT_MILLIS,
  cleanPublicName,
  publicNameFromEmail,
  rankLeaderboard,
  type AccessStatus,
  type GrowthIdentity,
  type LeaderboardRow,
  type LeaderboardSourceRow,
} from "../src/lib/growth.js";

export function adminClient(): SupabaseClient | null {
  const credentials = serviceCredentials();
  if (!credentials) return null;
  return createClient(credentials.url, credentials.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function newReferralCode(): string {
  return randomBytes(6).toString("hex").toUpperCase();
}

function asAccessStatus(value: unknown): AccessStatus {
  return value === "admitted" || value === "declined" || value === "waitlist"
    ? value
    : "waitlist";
}

interface ProfileRow {
  user_id: string;
  organization_id: string | null;
  code: string;
  public_name: string;
  status: string;
  created_at: string;
}

export async function loadProfile(
  client: SupabaseClient,
  userId: string,
): Promise<GrowthIdentity | null> {
  const { data, error } = await client
    .from("referral_profiles")
    .select("user_id,organization_id,code,public_name,status,created_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as ProfileRow;
  return {
    userId: row.user_id,
    publicName: row.public_name,
    code: row.code,
    status: asAccessStatus(row.status),
    createdAt: row.created_at,
  };
}

export async function ensureGrowthProfile(
  client: SupabaseClient,
  input: {
    userId: string;
    email: string;
    organizationId?: string | null;
    publicName?: string | null;
    status: AccessStatus;
  },
): Promise<GrowthIdentity> {
  const publicName = cleanPublicName(input.publicName) || publicNameFromEmail(input.email);
  const existing = await loadProfile(client, input.userId);
  if (existing) {
    const nextStatus = input.status === "admitted" ? "admitted" : existing.status;
    const nextOrg = input.organizationId || null;
    const nextName = cleanPublicName(input.publicName) || existing.publicName;
    if (
      nextStatus !== existing.status
      || (nextOrg && nextStatus === "admitted")
      || (input.publicName && nextName !== existing.publicName)
    ) {
      const { error } = await client.from("referral_profiles").update({
        public_name: nextName,
        status: nextStatus,
        ...(nextStatus === "admitted" && nextOrg ? { organization_id: nextOrg } : {}),
      }).eq("user_id", input.userId);
      if (error) throw error;
      return { ...existing, publicName: nextName, status: nextStatus };
    }
    return existing;
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = newReferralCode();
    const { error } = await client.from("referral_profiles").insert({
      user_id: input.userId,
      organization_id: input.status === "admitted" ? input.organizationId || null : null,
      code: candidate,
      public_name: publicName,
      status: input.status,
    });
    if (!error) break;
    if (attempt === 3) throw error;
  }
  const created = await loadProfile(client, input.userId);
  if (!created) throw new Error("growth profile unavailable");
  return created;
}

export async function ensureStartingCredits(
  client: SupabaseClient,
  userId: string,
  organizationId: string,
): Promise<void> {
  const { error } = await client.from("credit_ledger").upsert(
    {
      organization_id: organizationId,
      user_id: userId,
      amount_millis: STARTING_CREDIT_MILLIS,
      reason: "beta_start",
      idempotency_key: `beta-start:${userId}`,
      metadata: { program: "early_access_2026" },
    },
    { onConflict: "organization_id,idempotency_key", ignoreDuplicates: true },
  );
  if (error) throw error;
}

export async function stageWaitlistSignup(
  client: SupabaseClient,
  email: string,
  publicName: string,
  referralCode: string | null,
): Promise<void> {
  const { error } = await client.from("waitlist_signups").upsert({
    normalized_email: email,
    public_name: publicName,
    referral_code: referralCode,
  }, { onConflict: "normalized_email" });
  if (error) throw error;
}

export async function completeWaitlistSignup(
  client: SupabaseClient,
  userId: string,
  email: string,
): Promise<GrowthIdentity | null> {
  const existing = await loadProfile(client, userId);
  const { data, error } = await client
    .from("waitlist_signups")
    .select("public_name,referral_code")
    .eq("normalized_email", email)
    .maybeSingle();
  if (error) throw error;
  const staged = data as { public_name?: unknown; referral_code?: unknown } | null;
  if (!existing && !staged) return null;
  const profile = await ensureGrowthProfile(client, {
    userId,
    email,
    publicName: typeof staged?.public_name === "string" ? staged.public_name : existing?.publicName || null,
    status: existing?.status === "admitted" ? "admitted" : "waitlist",
    organizationId: null,
  });
  const code = typeof staged?.referral_code === "string" && REFERRAL_CODE.test(staged.referral_code)
    ? staged.referral_code
    : "";
  if (code) {
    const { error: claimError } = await client.rpc("claim_referral", {
      p_referred_user_id: userId,
      p_code: code,
      p_bonus_millis: REFERRAL_BONUS_MILLIS,
    });
    if (claimError && !/self referral/i.test(claimError.message || "")) throw claimError;
  }
  if (staged) {
    await client.from("waitlist_signups").delete().eq("normalized_email", email);
  }
  return profile;
}

async function sourceRows(client: SupabaseClient): Promise<LeaderboardSourceRow[]> {
  const [profilesResult, attributionsResult, commissionsResult] = await Promise.all([
    client
      .from("referral_profiles")
      .select("user_id,code,public_name,status,created_at")
      .in("status", ["waitlist", "admitted"]),
    client
      .from("referral_attributions")
      .select("referrer_user_id,referred_user_id"),
    client
      .from("referral_commissions")
      .select("referrer_user_id,referred_user_id,commission_cents,credit_cents,cash_cents"),
  ]);
  for (const result of [profilesResult, attributionsResult, commissionsResult]) {
    if (result.error) throw result.error;
  }

  const qualified = new Map<string, number>();
  for (const row of attributionsResult.data || []) {
    const referrer = String(row.referrer_user_id || "");
    if (referrer) qualified.set(referrer, (qualified.get(referrer) || 0) + 1);
  }
  const paid = new Map<string, Set<string>>();
  const money = new Map<string, { revshare: number; credit: number; cash: number }>();
  for (const row of commissionsResult.data || []) {
    const referrer = String(row.referrer_user_id || "");
    const referred = String(row.referred_user_id || "");
    if (!referrer) continue;
    if (referred) {
      const set = paid.get(referrer) || new Set<string>();
      set.add(referred);
      paid.set(referrer, set);
    }
    const current = money.get(referrer) || { revshare: 0, credit: 0, cash: 0 };
    current.revshare += Number(row.commission_cents || 0);
    current.credit += Number(row.credit_cents || 0);
    current.cash += Number(row.cash_cents || 0);
    money.set(referrer, current);
  }

  return (profilesResult.data || []).map((row) => {
    const userId = String(row.user_id);
    const totals = money.get(userId) || { revshare: 0, credit: 0, cash: 0 };
    return {
      userId,
      publicName: String(row.public_name || "Investigator"),
      code: String(row.code),
      status: asAccessStatus(row.status),
      createdAt: String(row.created_at),
      qualifiedReferrals: qualified.get(userId) || 0,
      paidReferrals: paid.get(userId)?.size || 0,
      revshareEarnedCents: totals.revshare,
      creditEarnedCents: totals.credit,
      cashEarnedCents: totals.cash,
    };
  });
}

export async function publicLeaderboard(
  client: SupabaseClient,
  currentUserId?: string,
): Promise<LeaderboardRow[]> {
  return rankLeaderboard(await sourceRows(client), currentUserId).slice(0, 100);
}

export async function accountSnapshot(
  client: SupabaseClient,
  userId: string,
  email: string,
  organizationId: string | null,
) {
  const status: AccessStatus = organizationId ? "admitted" : "waitlist";
  const profile = await ensureGrowthProfile(client, {
    userId,
    email,
    organizationId,
    status,
  });
  if (organizationId) await ensureStartingCredits(client, userId, organizationId);

  const leaderboard = await publicLeaderboard(client, userId);
  const self = leaderboard.find((row) => row.isCurrentUser) || null;

  if (!organizationId) {
    return {
      access: "waitlist" as const,
      credit: null,
      referral: {
        code: profile.code,
        publicName: profile.publicName,
        qualified: self?.qualifiedReferrals || 0,
        rank: self?.rank || leaderboard.length + 1,
        bonusPerQualifiedReferral: REFERRAL_BONUS_MILLIS / CREDIT_MILLIS,
        leaderboard,
        commission: { earnedCents: 0, creditCents: 0, cashCents: 0, payableCashCents: 0 },
        revenueShare: DEFAULT_REVENUE_SHARE,
      },
      pricing: {
        currency: "USD",
        creditDefinition: "One standard investigation",
        plans: ARGUS_PLANS,
        checkoutActive: false,
      },
    };
  }

  const [ledgerResult, balanceResult, commissionsResult] = await Promise.all([
    client
      .from("credit_ledger")
      .select("amount_millis,reason,created_at")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(25),
    client
      .from("credit_ledger")
      .select("amount_millis")
      .eq("organization_id", organizationId)
      .eq("user_id", userId),
    client
      .from("referral_commissions")
      .select("commission_cents,credit_cents,cash_cents,cash_status")
      .eq("referrer_user_id", userId),
  ]);
  if (ledgerResult.error) throw ledgerResult.error;
  if (balanceResult.error) throw balanceResult.error;
  if (commissionsResult.error) throw commissionsResult.error;

  const ledger = ledgerResult.data || [];
  const balanceMillis = (balanceResult.data || []).reduce(
    (total, row) => total + Number(row.amount_millis || 0),
    0,
  );
  const commission = (commissionsResult.data || []).reduce(
    (total, row) => ({
      earnedCents: total.earnedCents + Number(row.commission_cents || 0),
      creditCents: total.creditCents + Number(row.credit_cents || 0),
      cashCents: total.cashCents + Number(row.cash_cents || 0),
      payableCashCents:
        total.payableCashCents
        + (row.cash_status === "eligible" ? Number(row.cash_cents || 0) : 0),
    }),
    { earnedCents: 0, creditCents: 0, cashCents: 0, payableCashCents: 0 },
  );

  return {
    access: "member" as const,
    credit: {
      balance: Math.max(0, balanceMillis / CREDIT_MILLIS),
      startingGrant: STARTING_CREDIT_MILLIS / CREDIT_MILLIS,
      dailyLimit: ARGUS_PLANS[0].dailyLimit,
      ledger: ledger.map((row) => ({
        amount: Number(row.amount_millis || 0) / CREDIT_MILLIS,
        reason: row.reason,
        createdAt: row.created_at,
      })),
    },
    referral: {
      code: profile.code,
      publicName: profile.publicName,
      qualified: self?.qualifiedReferrals || 0,
      rank: self?.rank || leaderboard.length + 1,
      bonusPerQualifiedReferral: REFERRAL_BONUS_MILLIS / CREDIT_MILLIS,
      leaderboard,
      commission,
      revenueShare: DEFAULT_REVENUE_SHARE,
    },
    pricing: {
      currency: "USD",
      creditDefinition: "One standard investigation",
      plans: ARGUS_PLANS,
      checkoutActive: false,
    },
  };
}

export async function claimReferralCode(
  client: SupabaseClient,
  userId: string,
  code: string,
): Promise<boolean> {
  const { data, error } = await client.rpc("claim_referral", {
    p_referred_user_id: userId,
    p_code: code,
    p_bonus_millis: REFERRAL_BONUS_MILLIS,
  });
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

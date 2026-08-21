import { randomBytes } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireArgusAuth, serviceCredentials } from "./_auth.js";

export const config = { maxDuration: 20 };

const STARTING_CREDIT_MILLIS = 10_000;
const REFERRAL_BONUS_MILLIS = 2_000;
const CODE = /^[A-Z0-9]{8,20}$/;

const plans = [
  {
    id: "early_access",
    name: "Early access",
    monthlyUsd: 0,
    investigationCredits: 10,
    seats: 1,
    dailyLimit: 3,
    description: "One-time test budget. No card required.",
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

function adminClient(): SupabaseClient | null {
  const credentials = serviceCredentials();
  if (!credentials) return null;
  return createClient(credentials.url, credentials.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function requestBody(req: VercelRequest): Record<string, unknown> | null {
  try {
    const value = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function referralCode(): string {
  return randomBytes(6).toString("hex").toUpperCase();
}

async function ensureProfile(
  client: SupabaseClient,
  userId: string,
  organizationId: string,
): Promise<{ code: string }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = referralCode();
    const { error } = await client.from("referral_profiles").upsert(
      { user_id: userId, organization_id: organizationId, code: candidate },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
    if (!error) break;
    if (attempt === 2) throw error;
  }
  const { data, error } = await client
    .from("referral_profiles")
    .select("code")
    .eq("user_id", userId)
    .single();
  if (error || !data?.code) throw error || new Error("referral profile unavailable");
  return { code: String(data.code) };
}

async function ensureStartingCredits(
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

async function accountSnapshot(
  client: SupabaseClient,
  userId: string,
  organizationId: string,
) {
  const profile = await ensureProfile(client, userId, organizationId);
  await ensureStartingCredits(client, userId, organizationId);

  const [
    ledgerResult,
    ownAttributionsResult,
    profilesResult,
    attributionsResult,
    commissionsResult,
  ] = await Promise.all([
    client
      .from("credit_ledger")
      .select("amount_millis,reason,created_at")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(25),
    client
      .from("referral_attributions")
      .select("referred_user_id")
      .eq("referrer_user_id", userId),
    client
      .from("referral_profiles")
      .select("user_id,code,created_at")
      .eq("organization_id", organizationId),
    client
      .from("referral_attributions")
      .select("referrer_user_id,referred_user_id,qualified_at"),
    client
      .from("referral_commissions")
      .select("commission_cents,credit_cents,cash_cents,cash_status")
      .eq("referrer_user_id", userId),
  ]);
  for (const result of [
    ledgerResult,
    ownAttributionsResult,
    profilesResult,
    attributionsResult,
    commissionsResult,
  ]) {
    if (result.error) throw result.error;
  }

  const ledger = ledgerResult.data || [];
  const balanceMillis = ledger.reduce(
    (total, row) => total + Number(row.amount_millis || 0),
    0,
  );
  const counts = new Map<string, number>();
  for (const row of attributionsResult.data || []) {
    const referrer = String(row.referrer_user_id || "");
    if (referrer) counts.set(referrer, (counts.get(referrer) || 0) + 1);
  }
  const leaderboard = (profilesResult.data || [])
    .map((row) => ({
      code: String(row.code),
      referrals: counts.get(String(row.user_id)) || 0,
      isCurrentUser: row.user_id === userId,
    }))
    .sort((a, b) => b.referrals - a.referrals || a.code.localeCompare(b.code))
    .slice(0, 25)
    .map((row, index) => ({ ...row, rank: index + 1 }));

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
    credit: {
      balance: Math.max(0, balanceMillis / 1000),
      startingGrant: STARTING_CREDIT_MILLIS / 1000,
      ledger: ledger.map((row) => ({
        amount: Number(row.amount_millis || 0) / 1000,
        reason: row.reason,
        createdAt: row.created_at,
      })),
    },
    referral: {
      code: profile.code,
      qualified: ownAttributionsResult.data?.length || 0,
      bonusPerQualifiedReferral: REFERRAL_BONUS_MILLIS / 1000,
      leaderboard,
      commission,
      revenueShare: {
        commissionPercent: 20,
        creditSplitPercent: 25,
        cashSplitPercent: 75,
        cashPayoutsActive: false,
      },
    },
    pricing: {
      currency: "USD",
      creditDefinition: "One standard investigation",
      plans,
      checkoutActive: false,
    },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "private, no-store");
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).setHeader("Allow", "GET, POST").json({ error: "method_not_allowed" });
    return;
  }
  const auth = await requireArgusAuth(req, res, "viewer");
  if (!auth) return;
  const client = adminClient();
  if (!client) {
    res.status(503).json({ error: "growth_storage_unavailable" });
    return;
  }

  try {
    if (req.method === "POST") {
      const body = requestBody(req);
      const code = typeof body?.referralCode === "string"
        ? body.referralCode.trim().toUpperCase()
        : "";
      if (!CODE.test(code)) {
        res.status(400).json({ error: "valid_referral_code_required" });
        return;
      }
      const { data, error } = await client.rpc("claim_referral", {
        p_referred_user_id: auth.userId,
        p_code: code,
        p_bonus_millis: REFERRAL_BONUS_MILLIS,
      });
      if (error) throw error;
      res.status(200).json({
        claimed: Array.isArray(data) && data.length > 0,
        account: await accountSnapshot(client, auth.userId, auth.organizationId),
      });
      return;
    }

    res.status(200).json(await accountSnapshot(client, auth.userId, auth.organizationId));
  } catch (error) {
    console.error("[account-growth] failed", error);
    res.status(503).json({
      error: "growth_account_unavailable",
      message: "Credits and referrals could not be loaded.",
    });
  }
}

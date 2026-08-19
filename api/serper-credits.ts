// Click-only Serper credit probe. GET /api/serper-credits
//
// Live credit/key probes belong behind an explicit, authenticated admin action
// so opening a report (or the Data sources page) can never create unowned spend.
// This handler never calls /search — only account/credits-style endpoints.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth, serviceCredentials, serviceHeaders } from "./_auth.js";
import {
  activeCreditTotal,
  earliestActivePurchase,
  latestPurchase,
  listSerperPurchases,
} from "../server/serperPurchases.js";

export const config = { maxDuration: 15 };

const DASHBOARD_URL = "https://serper.dev/dashboard";
const SERPER_PROBE_URLS = [
  "https://google.serper.dev/credits",
  "https://google.serper.dev/account",
  "https://google.serper.dev/usage",
  "https://google.serper.dev/billing",
] as const;

type RemainingSource = "serper" | "estimated" | "unavailable";

export interface SerperCreditsBody {
  configured: boolean;
  remaining: number | null;
  remainingSource: RemainingSource;
  remainingEstimate: number | null;
  usedSinceLatestPurchase: number | null;
  dashboardUrl: typeof DASHBOARD_URL;
  purchases: ReturnType<typeof listSerperPurchases>;
  error?: string;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

const REMAINING_KEYS = ["remaining", "creditsLeft", "credits_left", "balance", "credits"] as const;

/** Pull a remaining-credits number from unknown Serper JSON. Never invent fields. */
export function parseSerperRemaining(value: unknown, depth = 0): number | null {
  if (depth > 3 || value == null) return null;
  if (typeof value !== "object") return asFiniteNumber(value);
  if (Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of REMAINING_KEYS) {
    if (!(key in record)) continue;
    const direct = asFiniteNumber(record[key]);
    if (direct !== null) return direct;
    const nested = parseSerperRemaining(record[key], depth + 1);
    if (nested !== null) return nested;
  }
  for (const nestedValue of Object.values(record)) {
    if (!nestedValue || typeof nestedValue !== "object" || Array.isArray(nestedValue)) continue;
    const nested = parseSerperRemaining(nestedValue, depth + 1);
    if (nested !== null) return nested;
  }
  return null;
}

async function probeSerperRemaining(apiKey: string): Promise<{ remaining: number | null; error?: string }> {
  let lastError: string | undefined;
  for (const url of SERPER_PROBE_URLS) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { "X-API-KEY": apiKey, accept: "application/json" },
        signal: AbortSignal.timeout(6_000),
      });
      if (!response.ok) {
        lastError = `serper_${response.status}`;
        continue;
      }
      const body: unknown = await response.json().catch(() => null);
      const remaining = parseSerperRemaining(body);
      if (remaining !== null) return { remaining };
      lastError = "serper_unparsed";
    } catch {
      lastError = "serper_unreachable";
    }
  }
  return { remaining: null, error: lastError };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function eventCalls(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

async function succeededSerperCalls(organizationId: string, sinceIso: string | null): Promise<number | null> {
  const credentials = serviceCredentials();
  if (!credentials) return null;
  try {
    const eventUrl = new URL(`${credentials.url}/rest/v1/provider_usage_events`);
    eventUrl.searchParams.set("select", "calls,created_at,status,provider");
    eventUrl.searchParams.set("organization_id", `eq.${organizationId}`);
    eventUrl.searchParams.set("provider", "eq.serper");
    eventUrl.searchParams.set("status", "eq.succeeded");
    if (sinceIso) eventUrl.searchParams.set("created_at", `gte.${sinceIso}`);
    eventUrl.searchParams.set("limit", "1000");
    const response = await fetch(eventUrl.toString(), {
      headers: serviceHeaders(credentials.key),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const value = await response.json() as unknown;
    if (!Array.isArray(value)) return null;
    return value.map(asRecord).reduce((sum, event) => sum + eventCalls(event.calls), 0);
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const auth = await requireArgusAuth(req, res, "viewer");
  if (!auth) return;

  const purchases = listSerperPurchases();
  const configured = Boolean(process.env.SERPER_API_KEY?.trim());
  const latest = latestPurchase();
  const earliestActive = earliestActivePurchase();
  const [usedSinceLatestPurchase, usedSinceActiveWindow] = await Promise.all([
    latest ? succeededSerperCalls(auth.organizationId, latest.purchasedAt) : Promise.resolve(null),
    earliestActive ? succeededSerperCalls(auth.organizationId, earliestActive.purchasedAt) : Promise.resolve(null),
  ]);
  const remainingEstimate = usedSinceActiveWindow === null
    ? null
    : Math.max(0, activeCreditTotal() - usedSinceActiveWindow);

  let remaining: number | null = null;
  let remainingSource: RemainingSource = remainingEstimate === null ? "unavailable" : "estimated";
  let error: string | undefined;

  if (configured) {
    const live = await probeSerperRemaining(process.env.SERPER_API_KEY as string);
    if (live.remaining !== null) {
      remaining = live.remaining;
      remainingSource = "serper";
    } else {
      error = live.error ?? "serper_unavailable";
      remainingSource = remainingEstimate === null ? "unavailable" : "estimated";
    }
  }

  const body: SerperCreditsBody = {
    configured,
    remaining,
    remainingSource,
    remainingEstimate,
    usedSinceLatestPurchase,
    dashboardUrl: DASHBOARD_URL,
    purchases,
    ...(error ? { error } : {}),
  };
  res.status(200).json(body);
}

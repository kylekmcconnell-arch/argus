// Upcoming token unlocks (CryptoRank v3): the "when is the next dump, and how
// big?" answer a buyer cannot easily assemble elsewhere. Dormant until
// CRYPTORANK_API_KEY is set (the API is credit-metered), and bounded to two
// requests per audit: one cached currency-map lookup + one per-currency
// upcoming-events read. Disclosure data only -- it mints a checkable vesting
// fact, never a score floor or a verdict input on its own.
import { env } from "../config";
import { recordCall } from "../cost";
import { cacheGet, cacheSet } from "../cache";

const API_BASE = "https://api.cryptorank.io/v3";
const FETCH_TIMEOUT_MS = 8_000;
const MAP_CACHE_KEY = "cryptorank:currency-map:v1";

interface MapEntry { id: number; slug: string; symbol: string | null; name: string }

export interface UpcomingUnlock {
  /** ISO date (YYYY-MM-DD) of the next scheduled unlock */
  nextUnlockDate: string;
  allocationName: string | null;
  percentOfSupply: number | null;
  unlockValueUsd: number | null;
  percentOfMcap: number | null;
  /** share of total supply already unlocked before this event, when reported */
  cumulativeUnlockedPercent: number | null;
  /** total % of supply unlocking across all events inside the next 90 days */
  next90dPercentOfSupply: number | null;
  sourceUrl: string;
}

export type UnlocksOutcome =
  | { available: true; value: UpcomingUnlock }
  | { available: false; note: string };

const norm = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function boundedJson(url: string, key: string): Promise<unknown | null> {
  try {
    const res = await Promise.race([
      fetch(url, { headers: { "X-Api-Key": key }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS + 500)),
    ]);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const dataArray = (payload: unknown): Record<string, unknown>[] => {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [];
  return rows.filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row));
};

/** Resolve the CryptoRank id by symbol AND name/slug agreement. Symbol alone is
 * ambiguous across listings, so any ambiguity fails closed to no-data. */
function resolveCurrency(entries: MapEntry[], tokenName: string, symbol: string): MapEntry | null {
  const symbolKey = symbol.trim().toLowerCase();
  const nameKey = norm(tokenName);
  const bySymbol = entries.filter((entry) => (entry.symbol ?? "").toLowerCase() === symbolKey);
  const agreeing = bySymbol.filter((entry) => norm(entry.name) === nameKey || norm(entry.slug.replace(/-/g, " ")) === nameKey);
  if (agreeing.length === 1) return agreeing[0];
  if (agreeing.length === 0 && bySymbol.length === 1 && norm(bySymbol[0].name).includes(nameKey)) return bySymbol[0];
  return null;
}

/** Never throws. Dormant (zero requests) until CRYPTORANK_API_KEY is configured. */
export async function collectUpcomingUnlocks(tokenName: string, symbol: string): Promise<UnlocksOutcome> {
  const key = env("CRYPTORANK_API_KEY");
  if (!key) return { available: false, note: "CryptoRank is not configured." };
  if (!tokenName.trim() || !symbol.trim()) return { available: false, note: "No token identity to resolve." };

  // The currency map is large and stable; cache it so repeat audits spend one
  // metered credit instead of one per run.
  let entries: MapEntry[] | null = null;
  const cached = await cacheGet(MAP_CACHE_KEY);
  if (cached) {
    try { entries = JSON.parse(cached) as MapEntry[]; } catch { entries = null; }
  }
  if (!entries) {
    const payload = await boundedJson(`${API_BASE}/currencies/map`, key);
    if (!payload) {
      recordCall("cryptorank", "currency-map", 0, "map_unavailable", "failed");
      return { available: false, note: "CryptoRank currency map was unavailable." };
    }
    entries = dataArray(payload)
      .map((row) => ({
        id: typeof row.id === "number" ? row.id : NaN,
        slug: typeof row.slug === "string" ? row.slug : "",
        symbol: typeof row.symbol === "string" ? row.symbol : null,
        name: typeof row.name === "string" ? row.name : "",
      }))
      .filter((row) => Number.isFinite(row.id) && row.slug && row.name);
    recordCall("cryptorank", "currency-map", 0, `${entries.length} currencies · 1 credit`, "succeeded");
    void cacheSet(MAP_CACHE_KEY, JSON.stringify(entries));
  }

  const currency = resolveCurrency(entries, tokenName, symbol);
  if (!currency) {
    return { available: false, note: `No unambiguous CryptoRank listing for ${symbol} (${tokenName}).` };
  }

  const eventsPayload = await boundedJson(
    `${API_BASE}/currencies/${currency.id}/vesting/events?filter=upcoming&sortBy=time&sortOrder=asc`,
    key,
  );
  if (!eventsPayload) {
    recordCall("cryptorank", "vesting-events", 0, `${currency.slug} · unavailable`, "failed");
    return { available: false, note: "CryptoRank vesting events were unavailable." };
  }
  const events = dataArray(eventsPayload)
    .map((row) => ({
      timeMs: typeof row.time === "number" ? row.time : NaN,
      allocationName: typeof row.allocationName === "string" && row.allocationName.trim() ? row.allocationName.trim() : null,
      percentOfSupply: typeof row.percentOfSupply === "number" && row.percentOfSupply >= 0 ? row.percentOfSupply : null,
      unlockValueUsd: Number.isFinite(Number(row.unlockValue)) && Number(row.unlockValue) > 0 ? Number(row.unlockValue) : null,
      percentOfMcap: typeof row.percentOfMcap === "number" && row.percentOfMcap >= 0 ? row.percentOfMcap : null,
      cumulativeUnlockedPercent: typeof row.cumulativeUnlockedPercent === "number" ? row.cumulativeUnlockedPercent : null,
    }))
    .filter((event) => Number.isFinite(event.timeMs));
  if (!events.length) {
    // A completed read with no upcoming events IS the answer (fully unlocked or
    // untracked schedule), reported as no-data rather than a fabricated zero.
    recordCall("cryptorank", "vesting-events", 0, `${currency.slug} · no_upcoming`, "succeeded");
    return { available: false, note: "CryptoRank tracks no upcoming unlock events for this token." };
  }

  const next = events[0];
  const horizonMs = next.timeMs + 90 * 24 * 60 * 60 * 1000;
  const next90d = events
    .filter((event) => event.timeMs <= horizonMs)
    .reduce((total, event) => total + (event.percentOfSupply ?? 0), 0);
  recordCall("cryptorank", "vesting-events", 0, `${currency.slug} · next_${new Date(next.timeMs).toISOString().slice(0, 10)} · 1 credit`, "succeeded");
  return {
    available: true,
    value: {
      nextUnlockDate: new Date(next.timeMs).toISOString().slice(0, 10),
      allocationName: next.allocationName,
      percentOfSupply: next.percentOfSupply,
      unlockValueUsd: next.unlockValueUsd,
      percentOfMcap: next.percentOfMcap,
      cumulativeUnlockedPercent: next.cumulativeUnlockedPercent,
      next90dPercentOfSupply: next90d > 0 ? Math.round(next90d * 100) / 100 : null,
      sourceUrl: `https://cryptorank.io/price/${currency.slug}/vesting`,
    },
  };
}
